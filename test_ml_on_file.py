# server/test_ml_on_file.py
import json, sys
from pathlib import Path
import PyPDF2
import requests

p = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"C:\Users\Lenovo\Desktop\Major_project _dataset\RESUME_1.pdf")
if not p.exists():
    print("FILE NOT FOUND:", p); sys.exit(1)

text = ""
with p.open("rb") as f:
    reader = PyPDF2.PdfReader(f)
    for pg in reader.pages:
        t = pg.extract_text()
        if t: text += t + "\n"

resp = requests.post("http://127.0.0.1:5002/predict", json={"filename": p.name, "text": text}, timeout=120)
print("ML service status:", resp.status_code)
print(json.dumps(resp.json(), indent=2, ensure_ascii=False))
