"""Note une leçon envoyée sur YouTube pour l'afficher sur le site.
Usage : python3 noter.py <slug-formation/slug-leçon> <id_youtube> <video.mp4>"""
import json, os, subprocess, sys, datetime
cle, vid, mp4 = sys.argv[1:4]
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../web/lib/formations/videos-cours.json")
d = json.load(open(p))
s = round(float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4])))
d[cle] = {"id": vid, "date": datetime.date.today().isoformat(), "duree": f"PT{s // 60}M{s % 60}S"}
open(p, "w").write("{\n" + ",\n".join(f'  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + "\n}\n")
print(cle, d[cle])
