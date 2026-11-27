// Dessine les diapos d'une leçon (1920×1080 PNG) avec Chromium (Playwright).
// Usage : node diapos.mjs <lecon-NN.json> <dossier_png> "<nom court de la formation>"
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [src, out, court] = process.argv.slice(2);
const L = JSON.parse(readFileSync(src, "utf8"));
mkdirSync(out, { recursive: true });
const F = resolve(dirname(fileURLToPath(import.meta.url)), "../fonts");
const css = `
@font-face{font-family:I;src:url(file://${F}/Inter-Bold.otf);font-weight:700}
@font-face{font-family:I;src:url(file://${F}/Inter-ExtraBold.otf);font-weight:800}
@font-face{font-family:I;src:url(file://${F}/Inter-Black.otf);font-weight:900}
*{box-sizing:border-box;margin:0;padding:0}
body{width:1920px;height:1080px;background:#0F2D4A;color:#F3F7FB;font-family:I,sans-serif;font-weight:700;overflow:hidden;position:relative}
.top{position:absolute;top:0;left:0;right:0;height:84px;display:flex;align-items:center;justify-content:space-between;padding:0 80px;background:#0B2238;color:#8FB3D1;font-size:28px}
.top b{color:#00BFFF;font-weight:900;letter-spacing:.5px}
.bar{position:absolute;top:84px;left:0;height:6px;background:linear-gradient(90deg,#00BFFF,#DA1884)}
h1{position:absolute;top:130px;left:110px;right:110px;font-size:58px;font-weight:900;color:#00BFFF;line-height:1.15}
.c{position:absolute;top:250px;left:110px;right:110px;bottom:120px;display:flex;flex-direction:column;justify-content:center;font-size:44px;line-height:1.42}
.c p{margin:0 0 22px}
ul,ol{margin-left:56px}
li{margin:0 0 20px;padding-left:10px}
ul li::marker{color:#DA1884;font-size:1.1em}
ol li::marker{color:#00BFFF;font-weight:900}
b{color:#FFD166}
.box{border-radius:28px;padding:36px 48px;background:#123B5E;border:4px solid #00BFFF}
.box.tip{border-color:#2ECC9A;background:#0F3A44}
.box.warn{border-color:#DA1884;background:#3A1A3A}
.lab{display:inline-block;font-size:30px;font-weight:900;text-transform:uppercase;letter-spacing:1px;padding:8px 22px;border-radius:40px;background:#00BFFF;color:#0F2D4A;margin-bottom:22px}
.tip .lab{background:#2ECC9A}.warn .lab{background:#DA1884;color:#fff}
.box h3,.quiz h3{font-size:46px;font-weight:900;margin-bottom:18px;color:#fff}
table{border-collapse:collapse;width:100%;font-size:34px;line-height:1.3}
th{background:#00BFFF;color:#0F2D4A;font-weight:900;text-align:left;padding:16px 20px}
td{padding:14px 20px;border-bottom:2px solid #2A4F72;vertical-align:top}
tr:nth-child(even) td{background:#123B5E}
.quiz .lab{background:#DA1884;color:#fff}
.ch{list-style:none;margin:10px 0 0}
.ch li{display:flex;gap:24px;align-items:flex-start;padding:16px 24px;border-radius:20px;background:#123B5E;margin-bottom:16px;font-size:40px}
.ch span{flex:none;width:58px;height:58px;border-radius:50%;background:#0B2238;color:#00BFFF;display:flex;align-items:center;justify-content:center;font-weight:900}
.ch li.ok{background:#11624D;outline:4px solid #2ECC9A}.ch li.ok span{background:#2ECC9A;color:#0F2D4A}
.ch li.no{opacity:.45}
.exp{margin-top:18px;font-size:36px;color:#CFE3F3}
.foot{position:absolute;bottom:0;left:0;right:0;height:84px;display:flex;align-items:center;justify-content:space-between;padding:0 80px;color:#8FB3D1;font-size:28px}
.foot b{color:#00BFFF;font-weight:900}
.t{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:0 140px}
.t .k{font-size:38px;color:#8FB3D1;margin-bottom:26px}
.t .n{display:inline-block;align-self:flex-start;font-size:36px;font-weight:900;background:#DA1884;color:#fff;padding:10px 30px;border-radius:40px;margin-bottom:34px}
.t h2{font-size:86px;font-weight:900;line-height:1.1;color:#fff;margin-bottom:40px}
.t .g{font-size:40px;line-height:1.4;color:#CFE3F3;border-left:8px solid #00BFFF;padding-left:30px}
`;
const head = (s) => `<div class="top"><span><b>Opportafrik</b> · ${court}</span><span>Leçon ${L.n} sur ${L.total}</span></div><div class="bar" style="width:${Math.round(100 * (s + 1) / L.slides.length)}%"></div>`;
const foot = `<div class="foot"><span>${L.title}</span><b>opportafrik.com</b></div>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
for (const [i, s] of L.slides.entries()) {
  const body = s.kind === "titre"
    ? `<div class="top"><span><b>Opportafrik</b> · Formation en vidéo</span><span>opportafrik.com</span></div><div class="t"><div class="k">${esc(s.cours)}</div><div class="n">Leçon ${s.n} sur ${s.total}</div><h2>${esc(s.titre)}</h2><div class="g">Objectif : ${esc(s.goal)}</div></div>`
    : `${head(i)}<h1>${esc(s.section)}</h1><div class="c">${s.corps}</div>${foot}`;
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><body>${body}</body>`, { waitUntil: "load" });
  await p.evaluate(() => document.fonts.ready);
  // Réduit la taille du texte si le contenu déborde.
  await p.evaluate(() => {
    const c = document.querySelector(".c"); if (!c) return;
    let f = 44; while ((c.scrollHeight > c.clientHeight + 2) && f > 26) { f -= 2; c.style.fontSize = f + "px"; c.querySelectorAll("table").forEach((t) => (t.style.fontSize = Math.round(f * 0.78) + "px")); c.querySelectorAll(".ch li").forEach((t) => (t.style.fontSize = Math.round(f * 0.9) + "px")); }
  });
  await p.screenshot({ path: `${out}/${String(i).padStart(3, "0")}.png` });
}
await b.close();
console.log(L.slides.length, "diapos");
