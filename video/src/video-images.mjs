// Vidéo du jour « avec images » (essai) : 3 vraies offres, chacune avec une
// image du métier, le logo du recruteur, le lieu, le contrat et les jours
// restants ; sous-titres mot à mot ; voix Kokoro ff_siwis 0,95.
// Animation image par image (30 i/s), 1080 x 1920.
//
//   node src/video-images.mjs <dossier_donnees> <dossier_voix> <sortie.mp4>
// <dossier_donnees> contient offres.json (+ photo-i.jpg, logo-i.*) fabriqué
// par src/images-donnees.mjs.
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [DATA, VOIX, SORTIE] = process.argv.slice(2);
const TMP = join(dirname(SORTIE), "tmp-video-images");
mkdirSync(TMP, { recursive: true });
for (const [f, w] of [["Inter-Bold.otf", "Bold"], ["Inter-ExtraBold.otf", "ExtraBold"], ["Inter-Black.otf", "Black"]]) {
  GlobalFonts.registerFromPath(join(ROOT, "fonts", f), `Inter ${w}`);
}
const W = 1080, H = 1920, FPS = 30;
const C = { navy: "#0B1F36", navy2: "#0F2D4A", capri: "#00BFFF", rose: "#DA1884", gris: "#64748B", fond: "#F3F7FB" };
const font = (w, px) => `${px}px "Inter ${w}"`;

// ---------------------------------------------------------------- textes
const PREP = { ML: "au Mali", CI: "en Côte d'Ivoire", SN: "au Sénégal", BF: "au Burkina Faso", GN: "en Guinée", NE: "au Niger", TG: "au Togo", BJ: "au Bénin" };
const CAT = { emploi: "Emploi", stage: "Stage", concours: "Concours", bourse: "Bourse", volontariat: "Volontariat", "ong-international": "ONG" };
const CONTRAT = { cdi: "CDI", cdd: "CDD", stage: "Stage", consultance: "Consultance", freelance: "Freelance", temps_partiel: "Temps partiel", volontariat: "Volontariat" };
const SIGLES = new Set(["TIC", "ERP", "RH", "ONG", "IT", "SIG", "BTP", "CDI", "CDD", "PNUD", "UNICEF", "OMS", "FAO", "BAD", "UEMOA", "CEDEAO", "PAM", "HCR", "QHSE", "HSE", "IA", "VIH", "SIDA", "DAF", "DG", "DRH", "BCEAO", "UE", "USAID", "GIZ", "SNV", "SAV", "GPS", "PME", "BIT", "UNOPS", "MSF", "SA", "SARL", "SAS"]);
const majuscules = (t) => { const l = t.replace(/[^A-Za-zÀ-ÿ]/g, ""); return l.length > 6 && l === l.toUpperCase(); };
function casse(t, garder = new Set(), force = false) {
  if (!force && !majuscules(t)) return t;
  return t.toLowerCase().split(/(\s+)/).map((m, i) => {
    const up = m.toUpperCase();
    if (SIGLES.has(up.replace(/[^A-Z]/g, "")) || garder.has(up)) return up;
    return i === 0 ? m.charAt(0).toUpperCase() + m.slice(1) : m;
  }).join("");
}
function orgNet(org) {
  if (!org) return org;
  if (!majuscules(org)) return org.trim();
  return org.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\b(De|Du|Des|La|Le|Les|Et|En)\b/g, (m) => m.toLowerCase()).replace(/^(\p{L})/u, (m) => m.toUpperCase())
    .split(" ").map((m) => SIGLES.has(m.toUpperCase()) ? m.toUpperCase() : m).join(" ");
}
function titreNet(title, org) {
  let t = String(title || "").replace(/\s+/g, " ").trim();
  const enMaj = majuscules(t);
  t = t.replace(/^.{0,80}?\brecrut(?:e|ent)\b\s*(?::|-|–)?\s*(?:(?:un|une|des|plusieurs)\b\s*)?/i, (m) => /^(plusieurs)/i.test(m.split(/recrut(?:e|ent)/i)[1]?.trim() || "") ? "Plusieurs " : "");
  t = t.replace(/\s*\(?\b(?:h\s*\/\s*f|f\s*\/\s*h|m\s*\/\s*f)\b\)?/gi, "").replace(/\s+/g, " ").trim();
  const garder = new Set(String(org || "").toUpperCase().split(/\s+/).filter((m) => m.length <= 5));
  t = casse(t || String(title), garder, enMaj);
  return t.charAt(0).toUpperCase() + t.slice(1);
}
const propre = (t) => String(t)
  .replace(/\((?:e|s|es|ne|le|ice|rice)\)/gi, "")
  .replace(/\((?:h\/f|f\/h|m\/f)\)|\b(?:h\/f|f\/h)\b/gi, "")
  .replace(/\bCDI\b/g, "C. D. I.").replace(/\bCDD\b/g, "C. D. D.")
  .replace(/[()«»"“”]/g, " ").replace(/\s*[/|]\s*/g, ", ").replace(/\s+/g, " ").trim();
const jours = (o) => o.limite ? Math.ceil((Date.parse(o.limite) - Date.now()) / 864e5) : null;

// ---------------------------------------------------------------- dessin
function rond(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function lignes(ctx, text, maxW, maxL) {
  const mots = String(text).split(/\s+/); const out = []; let cur = "";
  for (const m of mots) { const t = cur ? cur + " " + m : m; if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = m; } }
  if (cur) out.push(cur);
  if (out.length > maxL) { out.length = maxL; out[maxL - 1] = out[maxL - 1].replace(/\s*\S*$/, "") + "…"; }
  return out;
}
const grad = (ctx, x0, x1) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, C.capri); g.addColorStop(1, C.rose); return g; };
function texteCentre(ctx, t, y, px, col, w = "Black") {
  ctx.font = font(w, px); ctx.textAlign = "center"; const tw = ctx.measureText(t).width;
  ctx.fillStyle = col === "grad" ? grad(ctx, W / 2 - tw / 2, W / 2 + tw / 2) : col; ctx.fillText(t, W / 2, y); ctx.textAlign = "left";
}
// Courbes d'animation
const clamp = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
const back = (x) => { x = clamp(x); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

function fond(ctx, t) {
  const g = ctx.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, "#0E3A63"); g.addColorStop(0.5, C.navy2); g.addColorStop(1, "#1A1240");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const blob = (x, y, r, col) => { const b = ctx.createRadialGradient(x, y, 0, x, y, r); b.addColorStop(0, col); b.addColorStop(1, "rgba(15,45,74,0)"); ctx.fillStyle = b; ctx.fillRect(0, 0, W, H); };
  blob(150 + 60 * Math.sin(t / 3), 300, 800, "rgba(0,191,255,0.38)");
  blob(950 - 60 * Math.sin(t / 4), 1650, 850, "rgba(218,24,132,0.40)");
  // petits points
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 12; i++) for (let j = 0; j < 22; j++) { ctx.beginPath(); ctx.arc(60 + i * 90, 60 + j * 90 + (t * 8) % 90, 3, 0, 7); ctx.fill(); }
}
function pastilleSite(ctx, y, px = 34, clair = true) {
  ctx.font = font("ExtraBold", px);
  const a = "opport", b = "afrik", c = ".com"; const tw = ctx.measureText(a + b + c).width;
  const w = tw + 2 * px, h = px * 1.9, x = (W - w) / 2;
  ctx.fillStyle = clair ? "#fff" : C.navy2; rond(ctx, x, y, w, h, h / 2); ctx.fill();
  let cx = x + px; const by = y + h / 2 + px * 0.36;
  ctx.fillStyle = clair ? C.navy2 : "#fff"; ctx.fillText(a, cx, by); cx += ctx.measureText(a).width;
  ctx.fillStyle = clair ? C.rose : C.capri; ctx.fillText(b, cx, by); cx += ctx.measureText(b).width;
  ctx.fillStyle = clair ? C.navy2 : "#fff"; ctx.fillText(c, cx, by);
  return { x, w, h };
}
function epingle(ctx, x, y, r, col) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(x, y + r * 2.1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, 7); ctx.fill();
}
// Image recadrée pour remplir (object-fit: cover), avec zoom lent.
function photo(ctx, img, x, y, w, h, r, zoom = 1) {
  ctx.save(); rond(ctx, x, y, w, h, r); ctx.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height) * zoom;
    const iw = img.width * s, ih = img.height * s;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  } else { ctx.fillStyle = grad(ctx, x, x + w); ctx.fillRect(x, y, w, h); }
  ctx.restore();
}
function barreProgres(ctx, scenes, iScene, p) {
  const n = scenes.length, gap = 10, x0 = 50, w = (W - 100 - gap * (n - 1)) / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = "rgba(255,255,255,0.25)"; rond(ctx, x0 + i * (w + gap), 40, w, 8, 4); ctx.fill();
    const f = i < iScene ? 1 : i === iScene ? p : 0;
    if (f > 0) { ctx.fillStyle = "#fff"; rond(ctx, x0 + i * (w + gap), 40, Math.max(8, w * f), 8, 4); ctx.fill(); }
  }
}

// Sous-titres : 3-4 mots à la fois, le mot dit est surligné en bleu Capri.
function sousTitres(ctx, mots, t) {
  if (!mots.length) return;
  let k = mots.findIndex((m) => t < m.fin); if (k < 0) k = mots.length - 1;
  if (t < mots[0].debut - 0.05) return;
  const g0 = mots[k].groupe; const groupe = mots.filter((m) => m.groupe === g0);
  ctx.font = font("Black", 62);
  const esp = 18, larg = groupe.map((m) => ctx.measureText(m.mot).width);
  // une ou deux lignes
  const total = larg.reduce((s, x) => s + x, 0) + esp * (groupe.length - 1);
  let rangs = [groupe.map((_, i) => i)];
  if (total > 880) { const mid = Math.ceil(groupe.length / 2); rangs = [groupe.slice(0, mid).map((_, i) => i), groupe.slice(mid).map((_, i) => i + mid)]; }
  const y0 = 1500 - (rangs.length - 1) * 40;
  rangs.forEach((rg, ri) => {
    const tw = rg.reduce((s, i) => s + larg[i], 0) + esp * (rg.length - 1);
    let x = (W - tw) / 2 - 30; const y = y0 + ri * 84;
    for (const i of rg) {
      const m = groupe[i], actif = m === mots[k];
      if (actif) { ctx.fillStyle = C.capri; rond(ctx, x - 12, y - 58, larg[i] + 24, 78, 16); ctx.fill(); }
      ctx.lineWidth = 10; ctx.strokeStyle = actif ? "rgba(0,0,0,0)" : "rgba(11,31,54,0.85)"; ctx.lineJoin = "round";
      if (!actif) ctx.strokeText(m.mot, x, y);
      ctx.fillStyle = actif ? C.navy : "#fff"; ctx.fillText(m.mot, x, y);
      x += larg[i] + esp;
    }
  });
}

// ---------------------------------------------------------------- scènes
function sceneAccroche(ctx, t, d, S) {
  const { ville, photos, n } = S;
  // étiquette lieu
  const a = easeOut(t / 0.4);
  ctx.globalAlpha = a;
  ctx.font = font("Black", 40); const lab = `${ville.toUpperCase()} · NOUVELLES OFFRES`; const lw = ctx.measureText(lab).width;
  epingle(ctx, (W - lw) / 2 - 34, 268, 16, C.rose);
  ctx.fillStyle = "#FF5FB4"; ctx.textAlign = "left"; ctx.fillText(lab, (W - lw) / 2, 290);
  ctx.globalAlpha = 1;
  const s1 = back((t - 0.1) / 0.5), s2 = back((t - 0.3) / 0.5);
  ctx.save(); ctx.translate(W / 2, 430); ctx.scale(s1, s1); texteCentre(ctx, "ILS RECRUTENT", 0, 118, "#fff"); ctx.restore();
  ctx.save(); ctx.translate(W / 2, 560); ctx.scale(s2, s2); texteCentre(ctx, "AUJOURD'HUI", 0, 118, "grad"); ctx.restore();
  // 3 photos en éventail
  const pos = [[-300, -0.10], [0, 0], [300, 0.10]];
  photos.slice(0, 3).forEach((img, i) => {
    const p = back((t - 0.5 - i * 0.18) / 0.5); if (p <= 0) return;
    const [dx, rot] = pos[i];
    ctx.save(); ctx.translate(W / 2 + dx, 900 + (i === 1 ? -20 : 20)); ctx.rotate(rot); ctx.scale(p, p);
    ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = "#fff"; rond(ctx, -150, -200, 300, 400, 28); ctx.fill(); ctx.shadowColor = "transparent";
    photo(ctx, img, -138, -188, 276, 376, 20, 1 + 0.04 * Math.sin(t));
    ctx.restore();
  });
  // bouton pulsant
  const p = easeOut((t - 1.2) / 0.4);
  if (p > 0) {
    const pul = 1 + 0.05 * Math.sin(t * 7);
    ctx.save(); ctx.globalAlpha = p; ctx.translate(W / 2, 1230); ctx.scale(pul, pul);
    ctx.font = font("Black", 44); const tx = `${n} offres à voir`; const tw = ctx.measureText(tx).width + 90;
    ctx.fillStyle = C.rose; rond(ctx, -tw / 2, -50, tw, 100, 50); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.fillText(tx, 0, 16); ctx.textAlign = "left"; ctx.restore();
  }
}

function sceneOffre(ctx, t, d, S) {
  const { o, i, n, img, logo, pays } = S;
  texteCentre(ctx, `OFFRE ${i + 1} / ${n}`, 250, 46, C.capri);
  // photo
  const pe = easeOut(t / 0.45);
  const x = 90, w = W - 180, y = 300, h = 600;
  ctx.save(); ctx.globalAlpha = pe; ctx.translate(0, (1 - pe) * 80);
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  ctx.fillStyle = C.navy; rond(ctx, x, y, w, h, 40); ctx.fill(); ctx.shadowColor = "transparent";
  photo(ctx, img, x, y, w, h, 40, 1.02 + 0.08 * (t / d));
  ctx.restore();
  // carte d'information qui monte
  const ce = back((t - 0.25) / 0.5); if (ce <= 0) return;
  const org = o.organisation || "Recruteur";
  ctx.font = font("Black", 54); const titre = lignes(ctx, o.titreNet, w - 100, 3);
  const cy = 820 + (1 - ce) * 300, ch = 250 + titre.length * 66 + 90;
  ctx.save(); ctx.globalAlpha = clamp(ce);
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#fff"; rond(ctx, x + 20, cy, w - 40, ch, 36); ctx.fill(); ctx.shadowColor = "transparent";
  // NOUVEAU
  ctx.font = font("Black", 28); const nw = ctx.measureText("NOUVEAU").width + 36;
  ctx.fillStyle = C.capri; rond(ctx, x + w - 40 - nw, cy - 24, nw, 50, 14); ctx.fill();
  ctx.fillStyle = C.navy; ctx.fillText("NOUVEAU", x + w - 40 - nw + 18, cy + 10);
  // logo (place vide si aucun logo : jamais d'initiales)
  const lx = x + 60, ly = cy + 50;
  ctx.fillStyle = C.fond; rond(ctx, lx, ly, 120, 120, 24); ctx.fill();
  ctx.strokeStyle = "#E2E8F0"; ctx.lineWidth = 3; rond(ctx, lx, ly, 120, 120, 24); ctx.stroke();
  if (logo) {
    const s = Math.min(100 / logo.width, 100 / logo.height);
    ctx.drawImage(logo, lx + 60 - logo.width * s / 2, ly + 60 - logo.height * s / 2, logo.width * s, logo.height * s);
  }
  ctx.fillStyle = C.navy2; ctx.font = font("ExtraBold", 38);
  const ol = lignes(ctx, org, w - 280, 2);
  ol.forEach((l, k) => ctx.fillText(l, lx + 150, ly + (ol.length > 1 ? 40 : 55) + k * 44));
  const ligneLieu = ly + (ol.length > 1 ? 128 : 108);
  epingle(ctx, lx + 162, ligneLieu - 14, 11, C.rose);
  ctx.fillStyle = C.gris; ctx.font = font("Bold", 32); ctx.fillText([o.ville, pays.nom].filter(Boolean).join(", "), lx + 184, ligneLieu);
  // titre
  let ty = cy + 250;
  ctx.fillStyle = C.navy; ctx.font = font("Black", 54);
  for (const l of titre) { ctx.fillText(l, x + 60, ty); ty += 66; }
  // étiquettes + jours restants
  const chips = [...new Set([CONTRAT[o.contrat], CAT[o.categorie]].filter(Boolean))].slice(0, 2);
  let cx = x + 60; ctx.font = font("ExtraBold", 30);
  for (const c of chips) {
    const cw = ctx.measureText(c).width + 40;
    ctx.fillStyle = "#E0F6FF"; rond(ctx, cx, ty - 14, cw, 56, 14); ctx.fill();
    ctx.fillStyle = "#0369A1"; ctx.fillText(c, cx + 20, ty + 25); cx += cw + 14;
  }
  const j = jours(o);
  const badge = j && j >= 1 ? `Encore ${j} jour${j > 1 ? "s" : ""}` : "Publiée cette semaine";
  const pul = j && j <= 7 ? 1 + 0.06 * Math.max(0, Math.sin(t * 6)) : 1;
  ctx.font = font("Black", 30); const bw = ctx.measureText(badge).width + 40;
  ctx.save(); ctx.translate(x + w - 60 - bw / 2, ty + 14); ctx.scale(pul, pul);
  ctx.fillStyle = j && j <= 7 ? C.rose : "#FDE7F3"; rond(ctx, -bw / 2, -28, bw, 56, 14); ctx.fill();
  ctx.fillStyle = j && j <= 7 ? "#fff" : "#9D174D"; ctx.textAlign = "center"; ctx.fillText(badge, 0, 11); ctx.textAlign = "left";
  ctx.restore();
  ctx.restore();
}

function scenePlus(ctx, t, d, S) {
  const a = easeOut(t / 0.4);
  ctx.globalAlpha = a; texteCentre(ctx, "ET CE N'EST PAS TOUT…", 420, 52, "#FF5FB4"); ctx.globalAlpha = 1;
  const k = Math.round(S.total * easeOut((t - 0.3) / 1.2));
  const s = back((t - 0.3) / 0.5);
  ctx.save(); ctx.translate(W / 2, 720); ctx.scale(s, s); texteCentre(ctx, `+${k}`, 0, 250, "grad"); ctx.restore();
  ctx.globalAlpha = easeOut((t - 0.8) / 0.4);
  texteCentre(ctx, "offres ouvertes", 860, 72, "#fff");
  texteCentre(ctx, S.prep, 950, 72, "#fff");
  texteCentre(ctx, "Emplois · Stages · Concours · Bourses", 1050, 38, "#CBD5E1", "Bold");
  ctx.globalAlpha = 1;
  const p = back((t - 1.2) / 0.5);
  if (p > 0) { ctx.save(); ctx.translate(W / 2, 1210); ctx.scale(p, p); ctx.translate(-W / 2, -1210); pastilleSite(ctx, 1160, 52); ctx.restore(); }
}

function sceneFin(ctx, t, d, S) {
  const s = back(t / 0.5);
  ctx.save(); ctx.translate(W / 2, 400); ctx.scale(s, s);
  if (S.icone) { ctx.save(); rond(ctx, -110, -110, 220, 220, 50); ctx.clip(); ctx.drawImage(S.icone, -110, -110, 220, 220); ctx.restore(); }
  ctx.restore();
  ctx.globalAlpha = easeOut((t - 0.3) / 0.4);
  texteCentre(ctx, "Postule gratuitement sur", 640, 60, "#fff");
  ctx.globalAlpha = 1;
  const p = back((t - 0.5) / 0.5);
  if (p > 0) { ctx.save(); ctx.translate(W / 2, 780); ctx.scale(p * (1 + 0.03 * Math.sin(t * 5)), p * (1 + 0.03 * Math.sin(t * 5))); ctx.translate(-W / 2, -780); pastilleSite(ctx, 715, 66); ctx.restore(); }
  const q = easeOut((t - 0.9) / 0.4);
  if (q > 0) {
    ctx.globalAlpha = q;
    ctx.font = font("Black", 36); const tx = "Emplois · Stages · Concours · Bourses · Formations"; const tw = ctx.measureText(tx).width + 50;
    ctx.fillStyle = C.rose; rond(ctx, (W - tw) / 2, 920, tw, 74, 37); ctx.fill();
    texteCentre(ctx, tx, 970, 36, "#fff");
    texteCentre(ctx, "Envoie cette vidéo à un ami", 1110, 52, "#fff", "ExtraBold");
    texteCentre(ctx, "qui cherche du travail", 1180, 52, C.capri, "ExtraBold");
    ctx.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------- programme
const data = JSON.parse(readFileSync(join(DATA, "offres.json"), "utf8"));
const offres = data.offres.slice(0, 3).map((o) => ({ ...o, organisation: orgNet(o.organisation), titreNet: titreNet(o.title, o.organisation) }));
const ville = (offres.filter((o) => o.ville).map((o) => o.ville).sort((a, b) => offres.filter((o) => o.ville === b).length - offres.filter((o) => o.ville === a).length)[0]) || data.pays.nom;
const prep = PREP[data.pays.code] ?? `en ${data.pays.nom}`;
const charger = async (f) => { try { return f && existsSync(join(DATA, f)) ? await loadImage(readFileSync(join(DATA, f))) : null; } catch { return null; } };
const photos = await Promise.all(offres.map((o) => charger(o.photo?.fichier)));
const logos = await Promise.all(offres.map((o) => charger(o.logo)));
const iconeF = join(ROOT, "fonts", "..", "icone.png");
const icone = existsSync(process.env.ICONE || "") ? await loadImage(readFileSync(process.env.ICONE)) : existsSync(iconeF) ? await loadImage(readFileSync(iconeF)) : null;

// Voix (dit) et sous-titres (écrit) de chaque scène.
const SITE = "Oppor Afrique, point com";
const ordinal = ["D'abord", "Ensuite", "Et enfin"];
const scenes = [
  { draw: sceneAccroche, S: { ville, photos, n: offres.length },
    dit: `${ville} : regarde vite ces offres qui viennent de tomber.`,
    ecrit: `${ville} : regarde vite ces offres qui viennent de tomber.` },
  ...offres.map((o, i) => {
    const j = jours(o);
    const fin = j && j >= 1 && j <= 10 ? (j === 1 ? " Attention, il ne reste qu'un jour !" : ` Il reste ${j} jours pour postuler.`) : " Postule vite.";
    const lieu = o.ville ? `, à ${o.ville}` : "";
    const qui = o.organisation ? `${o.organisation} recrute` : "Offre";
    return { draw: sceneOffre, S: { o, i, n: offres.length, img: photos[i], logo: logos[i], pays: data.pays },
      dit: `${ordinal[i]}, ${o.organisation ? propre(o.organisation) + " recrute" : "une offre"} : ${propre(o.titreNet)}${lieu}.${fin}`,
      ecrit: `${qui} : ${o.titreNet}${lieu}.${fin}` };
  }),
  { draw: scenePlus, S: { total: data.total, prep },
    dit: `Et ce n'est pas tout : ${data.total} offres t'attendent ${prep}, sur ${SITE}.`,
    ecrit: `Et ce n'est pas tout : ${data.total} offres t'attendent ${prep}, sur opportafrik.com` },
  { draw: sceneFin, S: { icone },
    dit: `Postule gratuitement. Et envoie cette vidéo à un ami qui cherche du travail.`,
    ecrit: `Postule gratuitement. Et envoie cette vidéo à un ami qui cherche du travail.` },
];

// Voix Kokoro
writeFileSync(join(TMP, "textes.json"), JSON.stringify(scenes.map((s) => s.dit)));
const durVoix = JSON.parse(execFileSync("python3", [join(ROOT, "src", "voix.py"), VOIX, join(TMP, "textes.json"), TMP], { encoding: "utf8" }).trim().split("\n").pop());
const AVANT = 0.25, APRES = 0.45;
let debut = 0;
scenes.forEach((s, i) => {
  s.debut = debut; s.voix = durVoix[i]; s.duree = +(AVANT + durVoix[i] + APRES).toFixed(2); debut += s.duree;
  // minutage des mots écrits, au prorata de leur longueur
  const mots = s.ecrit.split(/\s+/).filter((m) => m && m !== ":");
  const poids = mots.map((m) => m.replace(/[^\p{L}\p{N}]/gu, "").length + 2.5);
  const tot = poids.reduce((a, b) => a + b, 0); let c = AVANT;
  let g = 0, dansG = 0;
  s.mots = mots.map((m, k) => {
    const dd = s.voix * poids[k] / tot; const r = { mot: m, debut: c, fin: c + dd, groupe: g }; c += dd;
    dansG++; if (dansG >= 4 || /[.,!?…]$/.test(m) && dansG >= 2) { g++; dansG = 0; }
    return r;
  });
});
const TOTAL = debut;
console.log(`Durée : ${TOTAL.toFixed(1)} s`, scenes.map((s) => s.duree));

// Son : voix posées bout à bout
const ffIn = [], parts = [];
scenes.forEach((s, i) => { ffIn.push("-i", join(TMP, `${i}.wav`)); const ms = Math.round((s.debut + AVANT) * 1000); parts.push(`[${i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=1.5[a${i}]`); });
parts.push(`${scenes.map((_, i) => `[a${i}]`).join("")}amix=inputs=${scenes.length}:normalize=0,apad=whole_dur=${TOTAL.toFixed(2)}[aout]`);
const audio = join(TMP, "voix.m4a");
execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", ...ffIn, "-filter_complex", parts.join(";"), "-map", "[aout]", "-t", TOTAL.toFixed(2), "-c:a", "aac", "-b:a", "128k", audio]);

// Image par image -> ffmpeg
const ff = spawn("ffmpeg", ["-nostdin", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${W}x${H}`, "-r", String(FPS), "-i", "-",
  "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
  "-c:a", "copy", "-shortest", "-movflags", "+faststart", SORTIE], { stdio: ["pipe", "inherit", "inherit"] });
const canvas = createCanvas(W, H), ctx = canvas.getContext("2d");
const N = Math.ceil(TOTAL * FPS);
const ecrire = (buf) => new Promise((r) => (ff.stdin.write(buf) ? r() : ff.stdin.once("drain", r)));
for (let f = 0; f < N; f++) {
  const T = f / FPS;
  let si = scenes.findIndex((s) => T < s.debut + s.duree); if (si < 0) si = scenes.length - 1;
  const s = scenes[si], t = T - s.debut;
  ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  fond(ctx, T);
  barreProgres(ctx, scenes, si, clamp(t / s.duree));
  if (si !== 0 && si !== scenes.length - 1) pastilleSite(ctx, 90, 30);
  ctx.save(); s.draw(ctx, t, s.duree, s.S); ctx.restore();
  ctx.globalAlpha = 1;
  if (si !== scenes.length - 1) sousTitres(ctx, s.mots, t);
  // petit flash blanc au changement de scène
  if (t < 0.12 && si > 0) { ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - t / 0.12)})`; ctx.fillRect(0, 0, W, H); }
  await ecrire(Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer));
  if (f % 150 === 0) process.stdout.write(`${f}/${N} `);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
const legende = `📍 ${ville} : ${offres.length} offres qui viennent de tomber 👇\n${offres.map((o) => `• ${o.titreNet}${o.organisation ? ` (${o.organisation})` : ""}`).join("\n")}\n\n+${data.total} offres ouvertes ${prep}, gratuites, sur opportafrik.com (lien dans la bio). Envoie à un ami qui cherche 📲\n\n#emploi${data.pays.slug?.replace(/-/g, "") ?? ""} #${data.pays.slug?.replace(/-/g, "") ?? "afrique"}tiktok #recrutement #${ville.toLowerCase().replace(/[^a-z]/g, "")} #opportafrik`;
writeFileSync(SORTIE.replace(/\.mp4$/, "-legende.txt"), legende);
console.log(`\nVidéo prête : ${SORTIE}\n\n${legende}`);
