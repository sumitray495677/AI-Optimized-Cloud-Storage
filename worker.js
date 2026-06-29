// server/worker.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const axios = require('axios');
const pdfParseImport = require('pdf-parse');
const pdfParse = pdfParseImport.default ?? pdfParseImport;
const mammoth = require('mammoth');

const db = new Database(path.join(__dirname, 'files.db'));
const uploadDir = path.join(__dirname, 'uploads');

// ---------------- Helper: move file into tag folder ----------------
function moveFileToTagFolder(srcPath, tag) {
  if (!srcPath || !tag) return srcPath;
  try {
    const cleanTag = String(tag).replace(/^#/, '').replace(/[\/\\]/g, '').trim() || 'Unknown';
    const destDir = path.join(uploadDir, cleanTag);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const base = path.basename(srcPath);
    let destPath = path.join(destDir, base);

    if (fs.existsSync(destPath)) {
      destPath = path.join(destDir, `${Date.now()}-${base}`);
    }

    fs.renameSync(srcPath, destPath);
    return destPath;
  } catch (e) {
    console.warn('moveFileToTagFolder failed:', e && e.message ? e.message : e);
    return srcPath;
  }
}

// ---------------- Text extraction ----------------
async function extractText(fp) {
  try {
    const ext = (path.extname(fp) || '').toLowerCase();
    if (ext === '.pdf') {
      const buf = fs.readFileSync(fp);
      const parsed = await pdfParse(buf);
      return parsed?.text || '';
    }
    if (ext === '.docx') {
      const out = await mammoth.extractRawText({ path: fp });
      return out?.value || '';
    }
    if (/\.(txt|md)$/i.test(ext)) {
      return fs.readFileSync(fp, 'utf8');
    }
  } catch (e) {
    console.warn('extractText failed:', e && e.message ? e.message : e);
  }
  return '';
}

// ---------------- ML call ----------------
async function callML(text, filename) {
  try {
    const res = await axios.post('http://127.0.0.1:5001/analyze', { filename, text }, { timeout: 20000 });
    return res.data;
  } catch (e) {
    console.warn('callML failed:', e && e.message ? e.message : e);
    return null;
  }
}

// ---------------- Process one file ----------------
async function processFile(row) {
  const id = row.id;
  const filePath = row.filepath;

  db.prepare(`UPDATE files SET ai_status='processing' WHERE id=?`).run(id);

  try {
    const text = await extractText(filePath);
    const ml = await callML(text, row.filename);

    const category = (ml && ml.tags && ml.tags[0]) ? ml.tags[0] : (ml && ml.category) ? ml.category : 'Unknown';
    const tag = `#${String(category).replace(/\s+/g, '_')}`;
    const summary = (ml && ml.summary) ? ml.summary : (text ? text.split(/\n+/).map(s=>s.trim()).filter(Boolean)[0] || '' : '');

    // move file into tag folder (updates disk path)
    const newPath = moveFileToTagFolder(filePath, tag);

    // update DB with new filepath and tags
    db.prepare(`
      UPDATE files
      SET filepath = ?, ai_tags = ?, ai_summary = ?, ocr_text = ?, ai_status = 'done', processed_at = datetime('now')
      WHERE id = ?
    `).run(newPath, JSON.stringify([tag]), summary, text, id);

    console.log(`✔ DONE ID:${id} -> ${tag} (moved to ${newPath})`);
  } catch (err) {
    console.error('processFile error:', err && (err.stack || err.message || err));
    db.prepare(`UPDATE files SET ai_status='failed', processed_at = datetime('now') WHERE id = ?`).run(id);
  }
}

// ---------------- Poll loop ----------------
async function pollOnce() {
  const row = db.prepare(`SELECT * FROM files WHERE ai_status='queued' ORDER BY uploaded_at LIMIT 1`).get();
  if (row) await processFile(row);
}

console.log('Worker started — polling for queued files');
setInterval(() => {
  pollOnce().catch(e => console.error('pollOnce error', e && e.message ? e.message : e));
}, 3000);

// run an initial poll immediately
pollOnce().catch(e => console.error('initial pollOnce error', e && e.message ? e.message : e));
