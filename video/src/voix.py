"""Voix off de la vidéo TikTok (Kokoro, voix féminine française ff_siwis).

Débit posé (vitesse 0,95) : c'est la voix lente et claire des vidéos
animées que le propriétaire a choisie pour toutes les vidéos.

Usage : python3 src/voix.py <dossier_modeles> <textes.json> <dossier_sortie>
Écrit 0.wav, 1.wav… (un par écran) et affiche leurs durées en JSON.
"""
import json
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

modeles, textes, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
k = Kokoro(f"{modeles}/kokoro-v1.0.onnx", f"{modeles}/voices-v1.0.bin")
durees = []
for i, t in enumerate(json.load(open(textes, encoding="utf-8"))):
    samples, sr = k.create(t, voice="ff_siwis", speed=0.95, lang="fr-fr")
    sf.write(f"{sortie}/{i}.wav", samples, sr)
    durees.append(round(len(samples) / sr, 2))
print(json.dumps(durees))
