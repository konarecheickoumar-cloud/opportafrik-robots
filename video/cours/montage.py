"""Monte la vidéo d'une leçon : diapos + voix, puis diapo de fin (abonne-toi + examen sur le site).
Usage : python3 montage.py <lecon-NN.json> <dossier_png> <dossier_wav> <sortie.mp4> "<nom formation>" <modeles_kokoro>
Écrit aussi <sortie>.chapitres.json ([[secondes, titre], …])."""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
src, png, wav, out, nom, mod = sys.argv[1:7]
L = json.load(open(src, encoding="utf-8"))
d = json.load(open(f"{wav}/durees.json"))
F = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../fonts/")
t = tempfile.mkdtemp()
AV, AP = 0.45, 0.85   # silence avant / après chaque diapo

# Diapo de fin
W, H = 1920, 1080; bg = (15, 45, 74); blanc = (243, 247, 251); bleu = (0, 191, 255); rose = (218, 24, 132); gris = (143, 179, 209); boite = (18, 59, 94)
im = Image.new("RGB", (W, H), bg); g = ImageDraw.Draw(im)
f = lambda s, w="Bold": ImageFont.truetype(F + f"Inter-{w}.otf", s)
def c(y, s, fo, col): w = g.textlength(s, font=fo); g.text(((W - w) / 2, y), s, font=fo, fill=col)
c(110, f"Fin de la leçon {L['n']} sur {L['total']}", f(40), gris)
c(180, "Merci d’avoir suivi cette leçon !", f(78, "ExtraBold"), blanc)
g.rounded_rectangle((260, 330, 1660, 560), radius=28, fill=boite, outline=rose, width=4)
g.rounded_rectangle((330, 395, 630, 495), radius=50, fill=rose)
w = g.textlength("S’ABONNER", font=f(40, "ExtraBold")); g.text((480 - w / 2, 423), "S’ABONNER", font=f(40, "ExtraBold"), fill="white")
g.text((680, 370), "Abonne-toi à la chaîne", font=f(46), fill=blanc)
g.text((680, 430), "@opportafrik et active la cloche", font=f(46), fill=blanc)
g.text((680, 492), "pour ne rater aucune leçon", font=f(36), fill=gris)
g.rounded_rectangle((260, 600, 1660, 880), radius=28, fill=boite, outline=bleu, width=4)
c(630, "Cours écrit, exercices et examen final", f(46), blanc)
c(700, "pour obtenir ton certificat sur", f(46), blanc)
c(775, "opportafrik.com", f(80, "Black"), bleu)
c(960, f"Opportafrik · {nom}", f(30), gris)
im.save(f"{t}/fin.png")
fin_txt = ("Merci d'avoir suivi cette leçon ! Abonne-toi à la chaîne Opportafrik, et active la cloche, pour être averti à chaque nouvelle leçon. "
           "Ensuite, va sur opportafrik point com. Tu y retrouves le cours écrit, les exercices, et l'examen final, pour obtenir ton certificat.")
if not os.path.exists(f"{wav}/fin.wav"):
    import soundfile as sf
    from kokoro_onnx import Kokoro
    a, sr = Kokoro(f"{mod}/kokoro-v1.0.onnx", f"{mod}/voices-v1.0.bin").create(fin_txt, voice="ff_siwis", speed=0.95, lang="fr-fr")
    sf.write(f"{wav}/fin.wav", a, sr); dfin = len(a) / sr
else:
    import soundfile as sf
    dfin = sf.info(f"{wav}/fin.wav").duration

items = [(f"{png}/{i:03d}.png", f"{wav}/{i:03d}.wav", d[i]) for i in range(len(L["slides"]))] + [(f"{t}/fin.png", f"{wav}/fin.wav", dfin)]
segs, chap, pos = [], [], 0.0
for i, (im_, a, du) in enumerate(items):
    dur = round(AV + du + AP, 3)
    if i < len(L["slides"]) and L["slides"][i].get("chapitre"): chap.append([pos, L["slides"][i]["chapitre"]])
    if i == len(L["slides"]): chap.append([pos, "Examen final et certificat sur opportafrik.com"])
    o = f"{t}/s{i:03d}.ts"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-loop", "1", "-framerate", "25", "-i", im_, "-i", a, "-filter_complex",
                    f"[1:a]adelay={int(AV*1000)},apad,aresample=44100,aformat=channel_layouts=mono[a]", "-map", "0:v", "-map", "[a]", "-t", str(dur),
                    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "22", "-pix_fmt", "yuv420p", "-r", "25",
                    "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "1", "-f", "mpegts", o], check=True)
    segs.append(o); pos += dur
open(f"{t}/l.txt", "w").write("".join(f"file '{s}'\n" for s in segs))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", f"{t}/l.txt", "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart", out], check=True)
json.dump(chap, open(out + ".chapitres.json", "w"), ensure_ascii=False)
print(out, round(pos, 1), "s")
