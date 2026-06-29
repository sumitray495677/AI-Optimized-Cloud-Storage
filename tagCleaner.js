// server/tagCleaner.js
// Content-first tag cleaner for DOCX/PDF: resume detector + keyword mapping
// Usage: const { deriveTags } = require('./tagCleaner'); const tags = deriveTags(filename, text);

const DEFAULT_OPTS = {
  minTokenLen: 3,
  maxTags: 6,
  contentWeight: 5,   // weight for matches found in document text
  filenameWeight: 1,  // weight for matches found in filename
  resumeBoost: 40     // large boost if resume detector fires
};

// token -> canonical tag map (expandable)
const TOKEN_MAP = {
  pan: 'PAN',
  pancard: 'PAN',
  aadhar: 'Aadhaar',
  aadhaar: 'Aadhaar',
  passport: 'Passport',
  passportscan: 'Passport',
  photo: 'Photo',
  jpg: 'Photo',
  jpeg: 'Photo',
  png: 'Photo',
  assignment: 'Assignment',
  homework: 'Assignment',
  invoice: 'Invoice',
  receipt: 'Receipt',
  bill: 'Receipt',
  resume: 'Resume',
  cv: 'Resume',
  curriculumvitae: 'Resume',
  certificate: 'Certificate',
  marksheet: 'Marksheet',
  bank: 'Bank Statement',
  bankstatement: 'Bank Statement',
  payslip: 'Payslip',
  offer: 'Offer Letter',
  salary: 'Payslip',
  transcript: 'Transcript',
  contract: 'Contract',
  appointment: 'Appointment Letter'
};

// small list of low-value stopwords (extend if needed)
const STOPWORDS = new Set([
  'the','and','for','with','this','that','from','your','you','file','document','page','pages','scan'
]);

function cleanToken(tok) {
  return tok.replace(/[^a-z0-9]/gi, '').trim().toLowerCase();
}

// resume detection: looks for keywords/section headers typical of resumes
function isLikelyResume(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.toLowerCase();

  // quick checks: explicit words
  const resumeIndicators = [
    'curriculum vitae', 'curriculumvitae', 'resume', 'cv',
    'objective', 'work experience', 'professional experience',
    'education', 'skills', 'contact', 'summary', 'experience',
    'technical skills', 'projects', 'achievements', 'certifications'
  ];
  for (const k of resumeIndicators) {
    if (t.includes(k)) return true;
  }

  // look for sections followed by short lines (heuristic)
  const sectionPatterns = ['education', 'experience', 'skills', 'projects', 'certifications', 'summary'];
  for (const sec of sectionPatterns) {
    const idx = t.indexOf(sec);
    if (idx >= 0) {
      // ensure it's not part of a longer word and that it appears as a header-ish (newline before/after)
      const after = t.slice(idx, idx + sec.length + 40);
      if (after.match(/education[:\n\r ]|experience[:\n\r ]|skills[:\n\r ]/)) return true;
    }
  }

  // check presence of email and phone patterns (common on resumes)
  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
  const phone = /(\+?\d{1,3}[-.\s]?)?(\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/;
  if (email.test(t) && phone.test(t)) return true;

  return false;
}

// derive tags from filename + text content
function deriveTags(filename = '', content = '', opts = {}) {
  opts = Object.assign({}, DEFAULT_OPTS, opts);
  const wContent = opts.contentWeight, wFile = opts.filenameWeight;
  const scores = Object.create(null);

  const FILENAME_BLACKLIST = new Set(['pdf','doc','docx','untitled','file','document']);

  function addScore(tag, s) {
    if (!tag) return;
    const key = String(tag);
    scores[key] = (scores[key] || 0) + s;
  }

  // tokens found inside content (for verification)
  const contentLower = String(content || '').toLowerCase().replace(/[_\-\(\),;:]/g, ' ');
  const contentTokens = new Set((contentLower.match(/\w+/g) || []).map(t => t.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean));

  // content tokens -> strong weight
  const words = contentLower.split(/\s+/).map(t => t.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean);
  for (const w of words) {
    if (w.length < opts.minTokenLen) continue;
    if (/^\d{4,}$/.test(w)) continue;
    if (STOPWORDS.has(w)) continue;
    if (FILENAME_BLACKLIST.has(w)) continue;

    const mapped = TOKEN_MAP[w] || null;
    if (mapped) addScore(mapped, wContent * 3); // stronger weight for content canonical hits
    else addScore(w, wContent);
  }

  // filename tokens -> very light weight and skip blacklist
  const name = String(filename || '').toLowerCase().replace(/[_\-\(\),;:]/g, ' ');
  const nameTokens = name.split(/\s+/).map(t => t.replace(/[^a-z0-9]/gi,'')).filter(Boolean);
  for (const t of nameTokens) {
    if (t.length < opts.minTokenLen) continue;
    if (/^\d{4,}$/.test(t)) continue;
    if (STOPWORDS.has(t)) continue;
    if (FILENAME_BLACKLIST.has(t)) continue;
    const mapped = TOKEN_MAP[t] || null;
    if (mapped) addScore(mapped, wFile); else addScore(t, wFile);
  }

  // resume detector boost
  if (isLikelyResume(content)) addScore('Resume', opts.resumeBoost);

  // prune numeric/small
  for (const k of Object.keys(scores)) {
    if (/^\d+$/.test(k)) delete scores[k];
    if (k.length < 2) delete scores[k];
  }

  // sort
  const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]).map(e=>e[0]);

  // final: prefer tags that appear in content OR are canonical mapped tags
  const final = [];
  const seen = new Set();
  for (const tok of sorted) {
    const canonical = TOKEN_MAP[tok.toLowerCase()] || tok;
    const pretty = canonical.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    const key = pretty.toLowerCase();
    if (seen.has(key)) continue;

    // allow if:
    //  - canonical tag (present in TOKEN_MAP) OR
    //  - token appears in contentTokens
    const rawLower = String(tok).toLowerCase();
    const isCanonical = Object.values(TOKEN_MAP).map(v=>v.toLowerCase()).includes(rawLower) || Object.keys(TOKEN_MAP).includes(rawLower);
    if (!isCanonical && !contentTokens.has(rawLower)) {
      // skip tokens that only came from filename or aren't in content
      continue;
    }

    // also skip if pretty is just the filename stem
    const filenameStem = (nameTokens.join(' ') || '').toLowerCase();
    if (filenameStem && filenameStem.includes(rawLower) && !isCanonical && contentTokens.has(rawLower) === false) {
      continue;
    }

    seen.add(key);
    final.push(pretty);
    if (final.length >= opts.maxTags) break;
  }

  // fallback: if nothing valid from content, try canonical matches present in filename only
  if (final.length === 0) {
    for (const t of nameTokens) {
      const mapped = TOKEN_MAP[t] || null;
      if (mapped) {
        const pretty = mapped.split(' ').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
        if (!seen.has(pretty.toLowerCase())) {
          final.push(pretty);
          seen.add(pretty.toLowerCase());
        }
        if (final.length >= opts.maxTags) break;
      }
    }
  }

  return final;
}


module.exports = { deriveTags, isLikelyResume };
