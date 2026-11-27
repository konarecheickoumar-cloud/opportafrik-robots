"""Fiche YouTube (youtube.json) d'une leçon. Usage : python3 meta.py <dossier_formation> <NN> <config.json-index> <sortie.json>"""
import json, sys
dos, nn, idx, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
import os
cfg = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "formations.json")))["file"][idx]
C = json.load(open(f"{dos}/course.json")); L = json.load(open(f"{dos}/lecon-{nn:02d}.json"))
chap = json.load(open(f"{dos}/l{nn:02d}.mp4.chapitres.json"))
T = len(C["lessons"]); base = f"https://opportafrik.com/formations/{C['slug']}"
def ts(s): s = int(s); return f"{s // 60}:{s % 60:02d}"
# Chapitres YouTube : au moins 10 s chacun.
cc = []
for s, t in chap:
    if cc and s - cc[-1][0] < 10: continue
    cc.append((s, t))
titre = f"{L['title']} | {cfg['court']}, leçon {nn}/{T}"
if len(titre) > 100: titre = f"{L['title'][:100 - len(cfg['court']) - 20].rstrip()}… | {cfg['court']}, leçon {nn}/{T}"
desc = (f"Leçon {nn} sur {T} de la formation gratuite « {C['title']} », en français, par Opportafrik.\n"
        f"Objectif : {L['goal']}\n\n"
        f"📖 Cours écrit complet, exercice corrigé et quiz de cette leçon :\n{base}/{L['slug']}?src=yt\n\n"
        f"🎓 Examen final (80/100 pour réussir) et certificat avec QR code, vérifiable par les recruteurs :\n{base}?src=yt\n\n"
        f"🔔 Abonne-toi à la chaîne et active la cloche pour ne rater aucune leçon. Toute la formation est dans la playlist « Formation {C['title']} ».\n\n"
        "Au programme :\n" + "\n".join(f"{ts(s)} {t}" for s, t in cc) + "\n\n"
        + (f"Pour qui ? {' ; '.join(C.get('audience', []))}.\n\n" if C.get("audience") else "")
        + "Opportafrik : offres d'emploi, stages, concours, bourses et formations au Mali et en Afrique de l'Ouest → https://opportafrik.com?src=yt\n\n"
        + cfg["hashtags"])
tags = cfg["tags"] + [L["title"][:60], "formation en ligne", "cours en français", "Afrique", "Mali", "Opportafrik"]
while sum(len(t) + 3 for t in tags) > 480: tags.pop(-6)
json.dump({"zone": "ML", "title": titre, "description": desc[:4900], "tags": tags, "categoryId": "27",
           "playlist": f"Formation {C['title']}"[:150], "position": nn - 1,
           "playlistDescription": f"{C['description']} Cours écrit, exercices, examen final et certificat sur {base}"},
          open(out, "w"), ensure_ascii=False, indent=2)
print(titre)
