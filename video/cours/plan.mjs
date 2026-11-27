// Découpe une formation du site en diapos + texte lu (voix off) pour les cours vidéo YouTube.
// Usage : node --experimental-strip-types plan.mjs <fichier.ts> <EXPORT> <dossier_sortie>
// Écrit <sortie>/course.json et <sortie>/lecon-NN.json ({ slides: [{ html, voix, chapitre? }] }).
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [file, name, out] = process.argv.slice(2);
const c = (await import(resolve(file)))[name];
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/course.json`, JSON.stringify(c));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Petit balisage : **gras** → surligné ; $…$ (LaTeX) laissé tel quel en texte simple.
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const mots = (s) => String(s).split(/\s+/).filter(Boolean).length;
const phrases = (s) => String(s).match(/[^.!?…]+[.!?…]+["»)]*\s*|[^.!?…]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [s];
// Regroupe des morceaux pour ne pas dépasser max mots par diapo.
function paquets(items, max, cout = mots) {
  const res = []; let cur = [], n = 0;
  for (const it of items) {
    const k = cout(it);
    if (cur.length && n + k > max) { res.push(cur); cur = []; n = 0; }
    cur.push(it); n += k;
  }
  if (cur.length) res.push(cur);
  if (res.length < 2) return res;
  // Rééquilibre : pas de dernière diapo avec un seul petit morceau.
  const total = items.reduce((a, it) => a + cout(it), 0), cible = total / res.length;
  const eq = []; cur = []; n = 0;
  for (const it of items) {
    const k = cout(it);
    if (cur.length && n + k / 2 > cible && eq.length < res.length - 1) { eq.push(cur); cur = []; n = 0; }
    cur.push(it); n += k;
  }
  if (cur.length) eq.push(cur);
  return eq.every((g) => g.reduce((a, it) => a + cout(it), 0) <= max * 1.25) ? eq : res;
}
const LIM = 62;

c.lessons.forEach((l, i) => {
  const N = i + 1, T = c.lessons.length;
  const slides = [];
  let section = l.title;
  const add = (corps, voix, chapitre) => slides.push({ section, corps, voix, chapitre });

  slides.push({ kind: "titre", n: N, total: T, cours: c.title, titre: l.title, goal: l.goal,
    voix: `Formation : ${c.title}. Leçon ${N} sur ${T} : ${l.title}. À la fin de cette leçon, vous saurez : ${l.goal}`, chapitre: `Leçon ${N} : ${l.title}` });

  for (const b of l.blocks) {
    if ("h" in b) { section = b.h; slides.push({ pending: b.h }); continue; }
    const chap = () => { const p = slides.at(-1); if (p?.pending) { slides.pop(); return p.pending; } return undefined; };
    if ("p" in b) {
      for (const g of paquets(phrases(b.p), LIM)) add(`<p>${fmt(g.join(" "))}</p>`, g.join(" "), chap());
    } else if ("list" in b) {
      const tag = b.ordered ? "ol" : "ul";
      let k = 0;
      for (const g of paquets(b.list, LIM)) {
        add(`<${tag} start="${k + 1}">${g.map((x) => `<li>${fmt(x)}</li>`).join("")}</${tag}>`, g.join(" "), chap());
        k += g.length;
      }
    } else if ("example" in b) {
      const gs = paquets(b.text, LIM - 8);
      gs.forEach((g, j) => add(`<div class="box ex"><div class="lab">Cas pratique${gs.length > 1 ? ` (${j + 1}/${gs.length})` : ""}</div><h3>${fmt(b.example)}</h3>${g.map((x) => `<p>${fmt(x)}</p>`).join("")}</div>`,
        (j === 0 ? `Cas pratique : ${b.example}. ` : "") + g.join(" "), chap()));
    } else if ("tip" in b) {
      add(`<div class="box tip"><div class="lab">À retenir</div><p>${fmt(b.tip)}</p></div>`, `À retenir : ${b.tip}`, chap());
    } else if ("warn" in b) {
      add(`<div class="box warn"><div class="lab">Erreur fréquente</div><p>${fmt(b.warn)}</p></div>`, `Attention, erreur fréquente : ${b.warn}`, chap());
    } else if ("table" in b) {
      const [head, ...rows] = b.table;
      const gs = paquets(rows, 70, (r) => mots(r.join(" ")) + 4);
      gs.forEach((g) => add(`<table><tr>${head.map((x) => `<th>${fmt(x)}</th>`).join("")}</tr>${g.map((r) => `<tr>${r.map((x) => `<td>${fmt(x)}</td>`).join("")}</tr>`).join("")}</table>`,
        g.map((r) => r.map((x, j) => (j === 0 ? x : `${head[j]} : ${x}`)).join(" ; ")).join(". ") + ".", chap()));
    } else if ("img" in b) {
      add(`<p class="cap">${fmt(b.caption || b.alt)}</p>`, b.caption || b.alt, chap());
    }
  }
  // Retire un sous-titre resté seul (rare).
  for (let j = slides.length - 1; j >= 0; j--) if (slides[j].pending) slides.splice(j, 1);

  section = `Exercice : ${l.exercise.title}`;
  paquets(l.exercise.prompt, LIM).forEach((g, j) => add(`<div class="box ex"><div class="lab">Exercice</div>${g.map((x) => `<p>${fmt(x)}</p>`).join("")}</div>`,
    (j === 0 ? `Passons à l'exercice : ${l.exercise.title}. ` : "") + g.join(" ") + (j === 0 ? "" : ""), j === 0 ? `Exercice : ${l.exercise.title}` : undefined));
  slides.at(-1).voix += " Mettez la vidéo sur pause et essayez de répondre avant de voir le corrigé.";
  section = "Corrigé";
  paquets(l.exercise.solution, LIM).forEach((g, j) => add(`<div class="box tip"><div class="lab">Corrigé</div>${g.map((x) => `<p>${fmt(x)}</p>`).join("")}</div>`,
    (j === 0 ? "Voici le corrigé. " : "") + g.join(" "), j === 0 ? "Corrigé" : undefined));

  section = "Quiz";
  l.quiz.forEach((q, j) => {
    const L = "ABCDEF";
    add(`<div class="quiz"><div class="lab">Question ${j + 1} sur ${l.quiz.length}</div><h3>${fmt(q.q)}</h3><ol class="ch">${q.choices.map((x, k) => `<li><span>${L[k]}</span>${fmt(x)}</li>`).join("")}</ol></div>`,
      `${j === 0 ? "Testez-vous avec ce quiz. " : ""}Question ${j + 1} : ${q.q} ${q.choices.map((x, k) => `Réponse ${L[k]} : ${x}.`).join(" ")}`, j === 0 ? "Quiz" : undefined);
    add(`<div class="quiz"><div class="lab">Question ${j + 1} sur ${l.quiz.length} · réponse</div><h3>${fmt(q.q)}</h3><ol class="ch">${q.choices.map((x, k) => `<li class="${k === q.answer ? "ok" : "no"}"><span>${L[k]}</span>${fmt(x)}</li>`).join("")}</ol><p class="exp">${fmt(q.explain)}</p></div>`,
      `La bonne réponse est la ${L[q.answer]} : ${q.choices[q.answer]}. ${q.explain}`);
  });
  writeFileSync(`${out}/lecon-${String(N).padStart(2, "0")}.json`, JSON.stringify({ n: N, total: T, slug: l.slug, title: l.title, goal: l.goal, slides }, null, 1));
  console.log(N, l.slug, slides.length, "diapos", slides.reduce((a, s) => a + mots(s.voix), 0), "mots lus");
});
