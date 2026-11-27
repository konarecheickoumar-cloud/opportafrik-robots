"""Voix off d'une leçon (Kokoro, ff_siwis, vitesse 0,95 : voix choisie pour toutes les vidéos).
Usage : python3 voix.py <dossier_modeles> <lecon-NN.json> <dossier_wav>
Écrit 000.wav, 001.wav… (une par diapo) et durees.json."""
import json, re, sys, os
import soundfile as sf
from kokoro_onnx import Kokoro

def dire(t):
    t = re.sub(r"\*\*(.+?)\*\*", r"\1", t)
    t = re.sub(r"(\d)[   ](?=\d{3}\b)", r"\1", t)          # 60 000 → 60000
    t = re.sub(r"(\d)[   ](?=\d{3}\b)", r"\1", t)
    rep = [(r"\bFCFA\b", "francs CFA"), (r"\bF CFA\b", "francs CFA"), (r"%", " pour cent"), (r"€", " euros"), (r"\$", " dollars"),
           (r"\bn°\s*", "numéro "), (r"\b1er\b", "premier"), (r"\b1re\b", "première"), (r"\bSYSCOHADA\b", "Syscohada"), (r"\bOHADA\b", "Ohada"),
           (r"\bUEMOA\b", "Uémoa"), (r"\bCEDEAO\b", "Cédéao"), (r"\betc\.", "et cetera."), (r"→", ", "), (r"≥", " supérieur ou égal à "), (r"≤", " inférieur ou égal à "),
           (r"\s/\s", " sur "), (r"\be\.g\.", "par exemple"), (r"\bex\.\s", "par exemple "), (r"\bp\. ?ex\.", "par exemple"), (r"[«»“”]", ""), (r"\s+", " ")]
    for a, b in rep: t = re.sub(a, b, t)
    return t.strip()

mod, src, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
k = Kokoro(f"{mod}/kokoro-v1.0.onnx", f"{mod}/voices-v1.0.bin")
L = json.load(open(src, encoding="utf-8"))
d = []
for i, s in enumerate(L["slides"]):
    a, sr = k.create(dire(s["voix"]), voice="ff_siwis", speed=0.95, lang="fr-fr")
    sf.write(f"{out}/{i:03d}.wav", a, sr)
    d.append(round(len(a) / sr, 3))
json.dump(d, open(f"{out}/durees.json", "w"))
print(round(sum(d)), "s de voix")
