# server/train_and_run_ml.py
import pickle
from pathlib import Path
from flask import Flask, request, jsonify
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

import PyPDF2
import docx

# put your dataset folder path here (raw string to avoid unicode escape)
DATA_DIR = Path(r"C:\Users\Lenovo\Desktop\Major_project _dataset")

# build label map from filename prefixes
label_map = {}
for p in DATA_DIR.glob("*"):
    name = p.name.lower()
    if name.startswith("resume"): label_map[p.name] = "Resume"
    elif name.startswith("cover_letter"): label_map[p.name] = "Cover_letter"
    elif name.startswith("certificate"): label_map[p.name] = "Certificates"
    elif name.startswith("forms"): label_map[p.name] = "Forms"
    elif name.startswith("assignment"): label_map[p.name] = "Assignment"
    elif name.startswith("invoices"): label_map[p.name] = "Invoice"
    elif name.startswith("ticket") or name.startswith("online"): label_map[p.name] = "Online_ticket"

def extract_text(path: Path):
    ext = path.suffix.lower()
    if ext == ".pdf":
        try:
            text = ""
            with open(path, "rb") as f:
                reader = PyPDF2.PdfReader(f)
                for page in reader.pages:
                    t = page.extract_text() or ""
                    text += t + "\n"
            return text
        except:
            return ""
    if ext == ".docx":
        try:
            doc = docx.Document(path)
            return " ".join(p.text for p in doc.paragraphs)
        except:
            return ""
    return ""

texts, labels = [], []
for fname, cat in label_map.items():
    p = DATA_DIR / fname
    t = extract_text(p)
    if t.strip():
        texts.append(t)
        labels.append(cat)
    else:
        print(f"[WARN] No text extracted from {fname}")

print(f"Loaded {len(texts)} training samples.")

if len(texts) < 2:
    raise SystemExit("Not enough training samples with text. Add text PDFs/DOCX or enable OCR.")

vect = TfidfVectorizer(max_features=5000, ngram_range=(1,2))
X = vect.fit_transform(texts)
clf = LogisticRegression(max_iter=1000)
clf.fit(X, labels)

Path("model").mkdir(exist_ok=True)
with open("model/vectorizer.pkl","wb") as f: pickle.dump(vect,f)
with open("model/model.pkl","wb") as f: pickle.dump(clf,f)

app = Flask("tiny_ml_service")

@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json() or {}
    txt = data.get("text","")
    Xq = vect.transform([txt])
    pred = clf.predict(Xq)[0]
    probs = clf.predict_proba(Xq)[0].tolist()
    return jsonify({"category": pred, "scores": dict(zip(clf.classes_, probs))})

print("🔥 ML Service running at: http://127.0.0.1:5002/predict")
app.run(port=5002)
