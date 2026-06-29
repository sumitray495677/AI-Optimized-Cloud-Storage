// server/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const mime = require('mime-types');

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ---------------- Helper: move file into folder named after tag (without '#') ----------------
function moveFileToTagFolder(srcPath, tag) {
  if (!srcPath || !tag) return srcPath;
  try {
    const cleanTag = String(tag).replace(/^#/, '').replace(/[\/\\]/g, '').trim() || 'Unknown';
    const destDir = path.join(uploadDir, cleanTag);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const base = path.basename(srcPath);
    let destPath = path.join(destDir, base);

    // avoid overwrite by appending timestamp when necessary
    if (fs.existsSync(destPath)) {
      const ts = Date.now();
      destPath = path.join(destDir, `${ts}-${base}`);
    }

    fs.renameSync(srcPath, destPath);
    return destPath;
  } catch (e) {
    console.warn('moveFileToTagFolder failed:', e && e.message ? e.message : e);
    return srcPath;
  }
}

// ---------------- Multer storage ----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ---------------- Database ----------------
const db = new Database(path.join(__dirname, 'files.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT,
  filepath TEXT,
  mimetype TEXT,
  size INTEGER,
  uploaded_at TEXT,
  ai_status TEXT DEFAULT 'queued',
  ai_tags TEXT,
  ai_summary TEXT,
  ocr_text TEXT,
  processed_at TEXT
);
`);

// ---------------- App ----------------
const app = express();
app.use(cors());
app.use(express.json());
// serve uploads so PDF iframe can load and folder urls are accessible
app.use('/uploads', express.static(uploadDir, { dotfiles: 'ignore' }));

// ---------------- Text extraction helpers ----------------
async function extractText(fp) {
  const ext = (path.extname(fp) || '').toLowerCase();
  try {
    if (ext === '.pdf') {
      const data = fs.readFileSync(fp);
      const parsed = await pdfParse(data);
      return parsed?.text || '';
    }
    if (ext === '.docx') {
      const r = await mammoth.extractRawText({ path: fp });
      return r?.value || '';
    }
    if (/\.(txt|md)$/i.test(ext)) {
      return fs.readFileSync(fp, 'utf8');
    }
  } catch (e) {
    console.warn('extractText error:', e && e.message ? e.message : e);
  }
  return '';
}

function conciseSummary(text) {
  if (!text) return 'No preview available';
  const firstPara = (text.split(/\n+/).map(s => s.trim()).filter(Boolean)[0]) || '';
  if (!firstPara) return text.slice(0, 240);
  const sents = firstPara.split(/(?<=[.?!])\s+/);
  if (sents.length === 1) return sents[0].slice(0, 300);
  return (sents[0] + ' ' + (sents[1] || '')).slice(0, 400);
}

// ---------------- ML call helper ----------------
async function callML(payload) {
  try {
    const res = await axios.post('http://127.0.0.1:5001/analyze', payload, { timeout: 30000 });
    return res.data;
  } catch (e) {
    console.warn('callML failed:', e && e.message ? e.message : e);
    return null;
  }
}

function naiveCategoryFromFilename(name) {
  const fn = (name || '').toLowerCase();
  if (fn.includes('resume')) return 'Resume';
  if (fn.includes('cover')) return 'Cover_letter';
  if (fn.includes('invoice')) return 'Invoice';
  if (fn.includes('certificate')) return 'Certificates';
  if (fn.includes('form')) return 'Forms';
  if (fn.includes('assignment')) return 'Assignment';
  return 'Unknown';
}

// ---------------- Upload route ----------------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ ok: false, error: 'no file' });

  const info = db.prepare(`
    INSERT INTO files (filename, filepath, mimetype, size, uploaded_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(f.originalname, f.path, f.mimetype, f.size);

  const insertedId = info.lastInsertRowid;
  res.json({ ok: true, id: insertedId, filename: f.originalname });

  // background processing: tag + move + update DB
  try {
    db.prepare(`UPDATE files SET ai_status='processing' WHERE id=?`).run(insertedId);

    const text = await extractText(f.path);
    const payload = { filename: f.originalname, text: text || '', filepath: f.path };
    const ml = await callML(payload);

    const category = (ml && ml.tags && ml.tags[0]) ? ml.tags[0] : (ml && ml.category) ? ml.category : naiveCategoryFromFilename(f.originalname);
    const tag = `#${String(category).replace(/\s+/g, '_')}`;
    const summary = (ml && ml.summary) ? ml.summary : conciseSummary(text);

    // move file into tag folder and update DB filepath
    const newPath = moveFileToTagFolder(f.path, tag);

    db.prepare(`
      UPDATE files
      SET filepath = ?, ai_tags = ?, ai_summary = ?, ocr_text = ?, ai_status = 'done', processed_at = datetime('now')
      WHERE id = ?
    `).run(newPath, JSON.stringify([tag]), summary, text, insertedId);

    console.log('ML processed:', insertedId, f.originalname, '->', tag, 'moved to', newPath);
  } catch (err) {
    console.error('background processing error:', err && (err.stack || err.message || err));
    db.prepare(`UPDATE files SET ai_status='failed', processed_at = datetime('now') WHERE id = ?`).run(insertedId);
  }
});

// ---------------- List files ----------------
app.get('/api/files', (req, res) => {
  const rows = db.prepare(`SELECT * FROM files ORDER BY uploaded_at DESC`).all();
  rows.forEach(r => {
    try { r.ai_tags = r.ai_tags ? JSON.parse(r.ai_tags) : []; } catch { r.ai_tags = []; }
  });
  res.json(rows);
});

// ---------------- Update tags manually ----------------
app.post('/api/files/:id/tags', (req, res) => {
  const { tags } = req.body;
  db.prepare(`UPDATE files SET ai_tags = ?, processed_at = datetime('now') WHERE id = ?`).run(JSON.stringify(tags || []), req.params.id);
  res.json({ ok: true });
});

// ---------------- Delete (remove file + row) ----------------
app.delete('/api/files/:id', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  try { if (row.filepath && fs.existsSync(row.filepath)) fs.unlinkSync(row.filepath); } catch (e) { console.warn('unlink failed', e && e.message ? e.message : e); }

  db.prepare('DELETE FROM files WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------------- Download raw file ----------------
app.get('/api/files/:id/download', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (!row.filepath || !fs.existsSync(row.filepath)) return res.status(404).json({ error: 'file missing' });
  return res.sendFile(path.resolve(row.filepath));
});

// ---------------- Preview metadata endpoint ----------------
app.get('/api/files/:id/preview', async (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fp = row.filepath;
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'file missing' });

  const ext = path.extname(fp).toLowerCase();
  try {
    if (ext === '.docx') {
      // convert to HTML for preview
      const { value: html } = await mammoth.convertToHtml({ path: fp });
      return res.json({ kind: 'html', html: `<div style="font-family: system-ui, Arial, sans-serif; line-height:1.4;">${html}</div>` });
    }
    if (ext === '.pdf') {
      const fileOnDisk = path.basename(fp);
      const url = `/uploads/${encodeURIComponent(fileOnDisk)}`;
      return res.json({ kind: 'pdf', url });
    }
    // fallback: text preview (from ocr_text or file content)
    const txt = row.ocr_text || (fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '');
    return res.json({ kind: 'text', text: String(txt).slice(0, 5000) });
  } catch (err) {
    console.warn('preview error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'preview failed' });
  }
});

// ---------------- Serve file bytes for iframe (inline) ----------------
app.get('/files/:id/raw', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!row) return res.status(404).send('not found');
  const fp = row.filepath;
  if (!fp || !fs.existsSync(fp)) return res.status(404).send('file not found');
  const contentType = mime.lookup(fp) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', 'inline; filename="' + (row.filename || path.basename(fp)) + '"');
  res.sendFile(path.resolve(fp));
});

// ---------------- NEW: folder endpoint ----------------
app.get('/api/files/:id/folder', (req, res) => {
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM files WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const fp = row.filepath || '';
  // folder path on disk
  const folderPath = fp ? path.dirname(fp) : '';
  // folder name (last segment)
  const folderName = folderPath ? path.basename(folderPath) : '';
  // If folder is inside uploads, expose a web-url under /uploads/<folderName>/
  let folderUrl = null;
  if (folderName) {
    // if file is directly under uploads root (no folder), folderName might be the uploads filename; in that case folderUrl should be uploads root
    if (path.dirname(fp) === uploadDir) {
      folderUrl = '/uploads/';
    } else {
      folderUrl = `/uploads/${encodeURIComponent(folderName)}/`;
    }
  }
  res.json({ folderName, folderPath, folderUrl });
});

// ---------------- Start ----------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend server running on port ${PORT}`));
