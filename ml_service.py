# server/ml_service.py
"""
ML microservice using zero-shot classification (facebook/bart-large-mnli)
for robust tags + LexRank extractive summaries.

Endpoints:
  POST /analyze
    JSON body: { "filename": "...", "text": "full extracted text" }
    Response: { "tags": ["Tag1","Tag2","Tag3"], "summary": "1-2 sentence summary", "scores": { "Tag1": 0.98, ... } }

Notes:
- This uses the HuggingFace transformers pipeline (downloads model on first run).
- It averages scores across chunks for long documents to be robust on long texts.
"""
from flask import Flask, request, jsonify
from transformers import pipeline
from sumy.parsers.plaintext import PlaintextParser
from sumy.nlp.tokenizers import Tokenizer
from sumy.summarizers.lex_rank import LexRankSummarizer
import threading
import math

app = Flask(__name__)

# Zero-shot model (BART-MNLI)
_MODEL_NAME = "facebook/bart-large-mnli"
_model = None
_model_lock = threading.Lock()
def get_model():
    global _model
    with _model_lock:
        if _model is None:
            # device = -1 => CPU
            _model = pipeline("zero-shot-classification", model=_MODEL_NAME, device=-1)
        return _model

# Candidate labels (edit/extend)
LABELS = [
    "Resume", "CV", "Assignment", "Invoice", "Receipt", "PAN", "Aadhaar",
    "Passport", "Photo", "Bank Statement", "Certificate", "Payslip",
    "Offer Letter", "Transcript", "Contract", "Project Report", "Presentation"
]

# Summarizer (extractive)
def summarize_text(text, max_sentences=2):
    if not text or not text.strip():
        return ""
    parser = PlaintextParser.from_string(text, Tokenizer("english"))
    summarizer = LexRankSummarizer()
    sentences = summarizer(parser.document, max_sentences)
    out = " ".join([str(s) for s in sentences])
    if not out.strip():
        t = " ".join(text.split())
        return (t[:300].strip() + "...") if len(t) > 300 else t
    return out

# Zero-shot scoring for long documents:
# split into chunks (by words) and average the confidences for each label
def score_labels_over_chunks(text, labels, chunk_words=400):
    model = get_model()
    words = text.split()
    if not words:
        # fallback: classify filename alone
        return model(text if text else "", labels)
    n = len(words)
    chunks = []
    for i in range(0, n, chunk_words):
        chunk = " ".join(words[i : min(i + chunk_words, n)])
        chunks.append(chunk)
    # accumulate scores per label
    accumulated = {label: 0.0 for label in labels}
    count = 0
    for ch in chunks:
        try:
            out = model(ch, labels, multi_class=False)  # single-label style scores
            # out has 'labels' and 'scores'
            for lbl, sc in zip(out["labels"], out["scores"]):
                accumulated[lbl] += float(sc)
            count += 1
        except Exception:
            # if any chunk fails, skip it
            continue
    if count == 0:
        # final fallback: empty scores
        return {"labels": [], "scores": []}
    # average
    averaged = {k: (v / count) for k, v in accumulated.items()}
    # sort labels by score desc
    sorted_labels = sorted(averaged.items(), key=lambda x: x[1], reverse=True)
    out_labels = [k for k, _ in sorted_labels]
    out_scores = [v for _, v in sorted_labels]
    return {"labels": out_labels, "scores": out_scores, "map": averaged}

@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json(force=True)
    filename = data.get("filename", "") or ""
    text = data.get("text", "") or ""

    # Choose text for classification (prefer content; if too short, use filename)
    content_for_labeling = text if len(text.strip()) > 40 else filename

    # Run zero-shot classification (robust to long inputs)
    try:
        res = score_labels_over_chunks(content_for_labeling, LABELS, chunk_words=400)
        labels_sorted = res.get("labels", [])[:3]
        scores_sorted = res.get("scores", [])[:3]
        score_map = res.get("map", {})
    except Exception as e:
        # graceful fallback: return empty
        labels_sorted = []
        scores_sorted = []
        score_map = {}
    
    # Summarize extractively (on cleaned text if available)
    try:
        summary = summarize_text(text, max_sentences=2) if text else ""
    except Exception:
        summary = ""

    # final safety: if classifier produced only filename-like tokens, try to prefer Resume if resume indicators exist
    if not labels_sorted and text and any(k in text.lower() for k in ["resume", "cv", "education", "experience", "skills"]):
        labels_sorted = ["Resume"]

    return jsonify({
        "tags": labels_sorted,
        "scores": score_map,
        "summary": summary
    })

if __name__ == "__main__":
    # dev server
    app.run(host="127.0.0.1", port=5001)
