// Vidéo TikTok du jour : de vraies offres du « pays du jour », en moins de
// 30 secondes, au format 1080 x 1920. Puis envoi en BROUILLON dans l'appli
// TikTok du compte branché (API officielle Content Posting, « upload »),
// et sur la chaîne YouTube si elle est branchée (Short, API YouTube Data v3),
// et en Reel sur la page Facebook et le compte Instagram branchés.
//
//   node src/video.mjs            -> fabrique + envoie à TikTok
//   node src/video.mjs --essai    -> fabrique seulement (fichier gardé par GitHub)
//   node src/video.mjs --exemple  -> fabrique avec des offres d'exemple, sans base
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; PAYS (facultatif, ex. CI).
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "sortie");
const args = new Set(process.argv.slice(2));
const ESSAI = args.has("--essai") || args.has("--exemple");
const EXEMPLE = args.has("--exemple");

for (const [f, w] of [["Inter-Bold.otf", "Bold"], ["Inter-ExtraBold.otf", "ExtraBold"], ["Inter-Black.otf", "Black"]]) {
  GlobalFonts.registerFromPath(join(ROOT, "fonts", f), `Inter ${w}`);
}

const W = 1080, H = 1920;
const C = { navy: "#0B1F36", navy2: "#0F2D4A", capri: "#00BFFF", rose: "#DA1884", gris: "#64748B", fond: "#F3F7FB" };

// --------------------------------------------------------------------------
// 4 styles qui tournent d'un jour à l'autre (jamais deux jours de suite le
// même) : accroche, couleurs, transitions, phrases et écran final changent.
// Toujours la charte : bleu Capri, rose, marine. STYLE=0..3 pour forcer.
// --------------------------------------------------------------------------
const THEMES = {
  nuit: { bg: "nuit", txt: "#fff", sub: "#CBD5E1", acc: "grad", lab: C.capri, pill: "#fff" },
  clair: { bg: "clair", txt: C.navy2, sub: C.gris, acc: "grad", lab: C.rose, pill: C.navy2 },
  rose: { bg: "rose", txt: "#fff", sub: "#FFE4F2", acc: "#7FE0FF", lab: "#fff", pill: "#fff" },
  marine: { bg: "marine", txt: "#fff", sub: "#CBD5E1", acc: C.capri, lab: C.rose, pill: "#fff" },
};
const STYLES = [
  { nom: "notification", theme: "clair", effets: ["smoothup", "slideleft", "smoothup", "slideleft", "fade", "smoothup"] },
  { nom: "chiffre", theme: "nuit", effets: ["zoomin", "slideleft", "slideright", "slideleft", "slideright", "fade"] },
  { nom: "urgence", theme: "rose", effets: ["wipeleft", "wipeup", "wipeleft", "wipeup", "wipeleft", "fade"] },
  { nom: "quelqu'un", theme: "marine", effets: ["circleopen", "smoothleft", "smoothleft", "smoothleft", "smoothleft", "circleclose"] },
];
let STYLE = STYLES[(Number.isInteger(+process.env.STYLE) && process.env.STYLE !== "" ? +process.env.STYLE : Math.floor(Date.now() / 864e5) + 1) % STYLES.length] // le 18/11/2026 = notification;
let TH = THEMES[STYLE.theme];
const choisirStyle = (i) => { STYLE = STYLES[i]; TH = THEMES[STYLE.theme]; };

// --------------------------------------------------------------------------
// Données
// --------------------------------------------------------------------------
const PREP = { ML: "au Mali", CI: "en Côte d'Ivoire", SN: "au Sénégal", BF: "au Burkina Faso", GN: "en Guinée", NE: "au Niger", TG: "au Togo", BJ: "au Bénin" };
const TAG = { ML: "mali", CI: "cotedivoire", SN: "senegal", BF: "burkinafaso", GN: "guinee", NE: "niger", TG: "togo", BJ: "benin" };
const CAT = { emploi: "Emploi", stage: "Stage", concours: "Concours", bourse: "Bourse", volontariat: "Volontariat", "ong-international": "ONG" };
const CONTRAT = { cdi: "CDI", cdd: "CDD", stage: "Stage", consultance: "Consultance", freelance: "Freelance", temps_partiel: "Temps partiel", volontariat: "Volontariat" };

// Le secret SUPABASE_URL peut être mal copié (sans https://, espaces, chemin en
// trop, ou seulement l'identifiant) : même rattrapage que les robots de collecte.
function supabaseUrl() {
  let v = (process.env.SUPABASE_URL || "").trim().replace(/^["'<]+|["'>]+$/g, "").trim();
  if (/^[a-z0-9]{15,30}$/.test(v)) v = `https://${v}.supabase.co`;
  else if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  try { v = new URL(v).origin; } catch {}
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(v)) return v;
  const db = process.env.SUPABASE_DB_URL || "";
  const ref = db.match(/postgres\.([a-z0-9]{15,30})[:@]/)?.[1] ?? db.match(/db\.([a-z0-9]{15,30})\.supabase\.co/)?.[1];
  return ref ? `https://${ref}.supabase.co` : v;
}

async function rpc(name, body = {}) {
  const url = supabaseUrl(), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant");
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name} : ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const EX_PAYS = {
  ML: { code: "ML", slug: "mali", nom: "Mali" }, CI: { code: "CI", slug: "cote-d-ivoire", nom: "Côte d'Ivoire" },
  SN: { code: "SN", slug: "senegal", nom: "Sénégal" }, BF: { code: "BF", slug: "burkina-faso", nom: "Burkina Faso" },
  GN: { code: "GN", slug: "guinee", nom: "Guinée" }, NE: { code: "NE", slug: "niger", nom: "Niger" },
  TG: { code: "TG", slug: "togo", nom: "Togo" }, BJ: { code: "BJ", slug: "benin", nom: "Bénin" },
};
const exemple = () => {
  const d = (n) => new Date(Date.now() + n * 86400_000).toISOString();
  return {
    pays: EX_PAYS[process.env.PAYS] ?? EX_PAYS.ML, total: 412,
    offres: [
      { id: null, title: "MATRANS RECRUTE RESPONSABLE CONTROLE TIC ET GEOLOCALISATION H/F", organisation: "MATRANS", ville: "Bamako", categorie: "emploi", contrat: "cdi", limite: d(6) },
      { id: null, title: "Stage en communication digitale", organisation: "Sahélia", ville: "Bamako", categorie: "stage", contrat: "stage", limite: d(9) },
      { id: null, title: "MIANKALA MULTI SERVICES RECRUTE STAGIAIRE CHARGE DE RECOUVREMENT H/F", organisation: "MIANKALA MULTI SERVICES", ville: null, categorie: "stage", contrat: "stage", limite: null },
      { id: null, title: "Assistant(e) administratif et financier", organisation: "UNOPS", ville: "Bamako", categorie: "emploi", contrat: "non_precise", limite: d(3) },
    ],
  };
};

// --------------------------------------------------------------------------
// Dessin
// --------------------------------------------------------------------------
const font = (w, px) => `${px}px "Inter ${w}"`;

function fond(ctx) {
  const blob = (x, y, r, col, fin = "rgba(11,31,54,0)") => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col); g.addColorStop(1, fin);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  };
  if (TH.bg === "clair") {
    ctx.fillStyle = C.fond; ctx.fillRect(0, 0, W, H);
    blob(80, 120, 700, "rgba(0,191,255,0.28)", "rgba(243,247,251,0)");
    blob(1040, 1840, 760, "rgba(218,24,132,0.22)", "rgba(243,247,251,0)");
    ctx.fillStyle = "rgba(15,45,74,0.05)";
    for (let i = 0; i < 12; i++) for (let j = 0; j < 22; j++) { ctx.beginPath(); ctx.arc(60 + i * 90, 60 + j * 90, 4, 0, 7); ctx.fill(); }
  } else if (TH.bg === "rose") {
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, "#E0248F"); g.addColorStop(0.55, "#A3125F"); g.addColorStop(1, "#4A0F3A");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    blob(1000, 300, 700, "rgba(0,191,255,0.35)", "rgba(163,18,95,0)");
    ctx.save(); ctx.globalAlpha = 0.08; ctx.fillStyle = "#fff";
    for (let i = -4; i < 12; i++) { ctx.beginPath(); ctx.moveTo(i * 160, 0); ctx.lineTo(i * 160 + 60, 0); ctx.lineTo(i * 160 + 60 + 700, H); ctx.lineTo(i * 160 + 700, H); ctx.fill(); }
    ctx.restore();
  } else if (TH.bg === "marine") {
    ctx.fillStyle = C.navy2; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,191,255,0.16)"; ctx.beginPath(); ctx.arc(W + 60, 260, 520, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(0,191,255,0.10)"; ctx.beginPath(); ctx.arc(-120, H - 200, 460, 0, 7); ctx.fill();
    ctx.fillStyle = C.rose; ctx.save(); ctx.translate(0, H - 120); ctx.rotate(-0.08); ctx.fillRect(-50, 0, W + 100, 26); ctx.restore();
  } else {
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H);
    blob(120, 260, 900, "rgba(0,191,255,0.55)");
    blob(980, 1720, 950, "rgba(218,24,132,0.55)");
  }
  const bar = ctx.createLinearGradient(0, 0, W, 0);
  bar.addColorStop(0, C.capri); bar.addColorStop(1, C.rose);
  ctx.fillStyle = bar; ctx.fillRect(0, 0, W, 10);
}

function rond(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function lignes(ctx, text, maxW, maxL) {
  const mots = String(text).split(/\s+/); const out = []; let cur = "";
  for (const m of mots) {
    const t = cur ? cur + " " + m : m;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t; else { out.push(cur); cur = m; }
  }
  if (cur) out.push(cur);
  if (out.length > maxL) { out.length = maxL; out[maxL - 1] = out[maxL - 1].replace(/\s*\S*$/, "") + "…"; }
  return out;
}

// Texte centré, avec des morceaux colorés : [["Tu cherches ", "#fff"], ["au Mali", "grad"]].
function centre(ctx, parts, y, px, w = "Black") {
  ctx.font = font(w, px); ctx.textBaseline = "alphabetic";
  const total = parts.reduce((s, [t]) => s + ctx.measureText(t).width, 0);
  let x = (W - total) / 2;
  for (const [t, col] of parts) {
    const tw = ctx.measureText(t).width;
    if (col === "grad") { const g = ctx.createLinearGradient(x, 0, x + tw, 0); g.addColorStop(0, C.capri); g.addColorStop(1, C.rose); ctx.fillStyle = g; }
    else ctx.fillStyle = col;
    ctx.fillText(t, x, y); x += tw;
  }
}

function pastilleSite(ctx, y, px = 40) {
  ctx.font = font("ExtraBold", px);
  const a = "opport", b = "afrik", c = ".com";
  const tw = ctx.measureText(a + b + c).width;
  const w = tw + 2 * px, h = px * 1.9, x = (W - w) / 2;
  const sombre = TH.pill !== "#fff";
  ctx.fillStyle = TH.pill; rond(ctx, x, y, w, h, h / 2); ctx.fill();
  let cx = x + px; const by = y + h / 2 + px * 0.36;
  ctx.fillStyle = sombre ? "#fff" : C.navy2; ctx.fillText(a, cx, by); cx += ctx.measureText(a).width;
  ctx.fillStyle = sombre ? C.capri : C.rose; ctx.fillText(b, cx, by); cx += ctx.measureText(b).width;
  ctx.fillStyle = sombre ? "#fff" : C.navy2; ctx.fillText(c, cx, by);
}

function etoile(ctx, cx, cy, r, col) {
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; ctx.lineTo(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); }
  ctx.closePath(); ctx.fill();
}

// Drapeaux des 8 pays, dessinés (pas d'emoji : ils ne s'affichent pas partout).
function drapeau(ctx, code, x, y, w) {
  const h = Math.round(w * 2 / 3);
  ctx.save(); rond(ctx, x, y, w, h, 14); ctx.clip();
  const v3 = (a, b, c) => { [a, b, c].forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(x + i * w / 3, y, w / 3 + 1, h); }); };
  const h2 = (a, b) => { ctx.fillStyle = a; ctx.fillRect(x, y, w, h / 2); ctx.fillStyle = b; ctx.fillRect(x, y + h / 2, w, h / 2); };
  if (code === "ML") v3("#14B53A", "#FCD116", "#CE1126");
  else if (code === "CI") v3("#F77F00", "#FFFFFF", "#009E60");
  else if (code === "GN") v3("#CE1126", "#FCD116", "#009460");
  else if (code === "SN") { v3("#00853F", "#FDEF42", "#E31B23"); etoile(ctx, x + w / 2, y + h / 2, h * 0.16, "#00853F"); }
  else if (code === "BF") { h2("#EF2B2D", "#009E49"); etoile(ctx, x + w / 2, y + h / 2, h * 0.18, "#FCD116"); }
  else if (code === "NE") { ctx.fillStyle = "#E05206"; ctx.fillRect(x, y, w, h / 3); ctx.fillStyle = "#fff"; ctx.fillRect(x, y + h / 3, w, h / 3); ctx.fillStyle = "#0DB02B"; ctx.fillRect(x, y + 2 * h / 3, w, h / 3 + 1); ctx.fillStyle = "#E05206"; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.12, 0, 7); ctx.fill(); }
  else if (code === "BJ") { ctx.fillStyle = "#008751"; ctx.fillRect(x, y, w * 0.4, h); ctx.fillStyle = "#FCD116"; ctx.fillRect(x + w * 0.4, y, w * 0.6, h / 2); ctx.fillStyle = "#E8112D"; ctx.fillRect(x + w * 0.4, y + h / 2, w * 0.6, h / 2); }
  else if (code === "TG") { for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? "#FFE000" : "#006A4E"; ctx.fillRect(x, y + i * h / 5, w, h / 5 + 1); } ctx.fillStyle = "#D21034"; ctx.fillRect(x, y, w * 0.4, h * 0.6); etoile(ctx, x + w * 0.2, y + h * 0.3, h * 0.17, "#fff"); }
  ctx.restore();
}

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

function carteOffre(ctx, o, n, pays, N = 4) {
  fond(ctx); pastilleSite(ctx, 150);
  ctx.textAlign = "left";
  const etiquette = { notification: `NOUVELLE OFFRE · ${n}/${N}`, chiffre: `N°${n}`, urgence: `OFFRE ${n} SUR ${N}`, "quelqu'un": `OFFRE ${n}` }[STYLE.nom] ?? `OFFRE ${n}`;
  centre(ctx, [[etiquette, TH.lab]], 520, 46, "Black");
  ctx.font = font("Black", 64);
  const titre = lignes(ctx, o.title, 800, 4);
  const chips = [...new Set([CAT[o.categorie], CONTRAT[o.contrat]].filter(Boolean))];
  const x = 90, w = W - 180, y = 580;
  const h = 300 + titre.length * 80 + (chips.length ? 100 : 0) + 140;
  ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#fff"; rond(ctx, x, y, w, h, 44); ctx.fill();
  ctx.shadowColor = "transparent";
  // Liseré de couleur différent selon le style du jour.
  ctx.save(); rond(ctx, x, y, w, h, 44); ctx.clip();
  const lis = { notification: C.capri, chiffre: "grad", urgence: C.rose, "quelqu'un": C.navy2 }[STYLE.nom];
  if (lis === "grad") { const g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, C.capri); g.addColorStop(1, C.rose); ctx.fillStyle = g; } else ctx.fillStyle = lis;
  if (STYLE.nom === "quelqu'un") ctx.fillRect(x, y, 18, h); else ctx.fillRect(x, y, w, 16);
  ctx.restore();
  // « NOUVEAU »
  ctx.save(); ctx.translate(x + w - 40, y - 10); ctx.rotate(0.05);
  ctx.font = font("Black", 30); const nw = ctx.measureText("NOUVEAU").width + 40;
  ctx.fillStyle = C.capri; rond(ctx, -nw, -26, nw, 56, 14); ctx.fill();
  ctx.fillStyle = C.navy; ctx.fillText("NOUVEAU", -nw + 20, 12); ctx.restore();
  // Employeur
  const org = o.organisation || "Recruteur";
  const couleurs = ["#F59E0B", "#16A34A", "#2563EB", "#9333EA", C.rose, "#0891B2"];
  const col = couleurs[[...org].reduce((s, ch) => s + ch.charCodeAt(0), 0) % couleurs.length];
  ctx.fillStyle = col; rond(ctx, x + 60, y + 70, 120, 120, 26); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.font = font("Black", 64); ctx.textAlign = "center";
  ctx.fillText(org.trim()[0].toUpperCase(), x + 120, y + 155); ctx.textAlign = "left";
  ctx.fillStyle = C.navy2; ctx.font = font("Black", 44);
  // Nom long (« MIANKALA MULTI SERVICES ») : deux lignes plus petites au lieu de « … ».
  let lieuY = y + 175;
  if (ctx.measureText(org.toUpperCase()).width <= w - 280) ctx.fillText(org.toUpperCase(), x + 210, y + 122);
  else {
    ctx.font = font("Black", 34);
    const ls = lignes(ctx, org.toUpperCase(), w - 280, 2);
    const y0 = ls.length > 1 ? y + 100 : y + 120;
    ls.forEach((l, i) => ctx.fillText(l, x + 210, y0 + i * 40));
    lieuY = ls.length > 1 ? y + 185 : y + 170;
  }
  ctx.fillStyle = C.gris; ctx.font = font("Bold", 34);
  ctx.fillText([o.ville, pays.nom].filter(Boolean).join(", "), x + 210, lieuY);
  // Titre
  let cy = y + 300;
  ctx.fillStyle = C.navy; ctx.font = font("Black", 64);
  for (const l of titre) { ctx.fillText(l, x + 60, cy); cy += 80; }
  // Étiquettes
  if (chips.length) {
    cy += 10; let cx = x + 60; ctx.font = font("ExtraBold", 32);
    for (const c of chips) {
      const cw = ctx.measureText(c).width + 44;
      ctx.fillStyle = "#E0F6FF"; rond(ctx, cx, cy - 44, cw, 62, 16); ctx.fill();
      ctx.fillStyle = "#0369A1"; ctx.fillText(c, cx + 22, cy); cx += cw + 18;
    }
    cy += 60;
  }
  // Date limite
  const by = cy + 10, bh = 100;
  ctx.fillStyle = "#FDE7F3"; rond(ctx, x + 40, by, w - 80, bh, 22); ctx.fill();
  ctx.font = font("ExtraBold", 38); ctx.fillStyle = "#9D174D";
  if (o.limite) {
    const d = new Date(o.limite);
    const jours = Math.max(1, Math.ceil((d.getTime() - Date.now()) / 86400_000));
    ctx.fillText(`Limite : ${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`, x + 80, by + 64);
    const t = `${jours} jour${jours > 1 ? "s" : ""}`; ctx.font = font("Black", 36);
    const tw = ctx.measureText(t).width + 40;
    ctx.fillStyle = C.rose; rond(ctx, x + w - 80 - tw - 20, by + 20, tw, 60, 14); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(t, x + w - 80 - tw, by + 63);
  } else {
    ctx.fillText("Postulez vite : publiée cette semaine", x + 80, by + 64);
  }
  centre(ctx, [["Détails et lien pour postuler", TH.txt]], Math.max(cy + 260, 1500), 44, "ExtraBold");
  centre(ctx, [["sur ", TH.txt], ["opportafrik.com", TH.acc]], Math.max(cy + 330, 1570), 52, "Black");
}

// Jours restants avant la date limite la plus proche (null si aucune).
function joursMin(offres) {
  const j = offres.filter((o) => o.limite).map((o) => Math.ceil((Date.parse(o.limite) - Date.now()) / 864e5)).filter((x) => x >= 1);
  return j.length ? Math.min(...j) : null;
}
const nbRecruteurs = (data) => new Set(data.offres.map((o) => (o.organisation || "").toLowerCase()).filter(Boolean)).size;
const lieu = (data) => data.offres.find((o) => o.ville)?.ville || data.pays.nom;

function accroche(ctx, data) {
  const pays = data.pays, p = PREP[pays.code] ?? `en ${pays.nom}`, N = data.offres.length;
  fond(ctx);
  if (STYLE.nom === "notification") {
    centre(ctx, [["Ce matin,", TH.txt]], 470, 110, "Black");
    centre(ctx, [[p, TH.acc]], 590, 96, "Black");
    // Deux notifications empilées, comme sur un téléphone.
    const carte = (y, dx, a, o, grand) => {
      ctx.save(); ctx.globalAlpha = a;
      ctx.shadowColor = "rgba(15,45,74,0.25)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
      ctx.fillStyle = "#fff"; rond(ctx, 70 + dx, y, W - 140 - 2 * dx, grand ? 300 : 120, 40); ctx.fill(); ctx.shadowColor = "transparent";
      if (grand) {
        const g = ctx.createLinearGradient(110, y + 40, 210, y + 140); g.addColorStop(0, C.capri); g.addColorStop(1, C.rose);
        ctx.fillStyle = g; rond(ctx, 110, y + 40, 100, 100, 26); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(160, y + 90, 26, 0, 7); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillStyle = C.gris; ctx.font = font("Bold", 30); ctx.fillText("OPPORTAFRIK · maintenant", 240, y + 80);
        ctx.fillStyle = C.navy2; ctx.font = font("Black", 42); ctx.fillText(lignes(ctx, `Nouvelle offre à ${lieu(data)}`, W - 340, 1)[0], 240, y + 132);
        ctx.fillStyle = C.navy2; ctx.font = font("Bold", 36);
        lignes(ctx, [o.organisation, o.title].filter(Boolean).join(" : "), W - 260, 2).forEach((l, i) => ctx.fillText(l, 110, y + 205 + i * 46));
      }
      ctx.restore();
    };
    carte(1050, 40, 0.55, null, false);
    carte(980, 20, 0.8, null, false);
    carte(720, 0, 1, data.offres[0], true);
    const R = nbRecruteurs(data);
    centre(ctx, [[R > 1 ? `${R} recruteurs` : `${N} nouvelles offres`, TH.txt]], 1370, 100, "Black");
    centre(ctx, [[R > 1 ? "cherchent quelqu'un." : "ce matin.", TH.txt]], 1480, 76, "Black");
    centre(ctx, [["Et si c'était toi ?", TH.acc]], 1640, 84, "Black");
  } else if (STYLE.nom === "chiffre") {
    centre(ctx, [[String(data.total), TH.acc]], 860, 340, "Black");
    centre(ctx, [["offres ouvertes", TH.txt]], 1010, 96, "Black");
    centre(ctx, [[p, TH.txt]], 1120, 80, "ExtraBold");
    drapeau(ctx, pays.code, (W - 180) / 2, 1200, 180);
    centre(ctx, [["Voici les nouvelles du jour", C.capri]], 1500, 56, "ExtraBold");
  } else if (STYLE.nom === "urgence") {
    const j = joursMin(data.offres);
    centre(ctx, [["Plus que", TH.txt]], 560, 100, "Black");
    const big = j === 1 ? "24 H" : `${j} JOURS`; ctx.font = font("Black", 230);
    centre(ctx, [[big, "#fff"]], 840, Math.min(230, Math.floor(230 * (W - 160) / ctx.measureText(big).width)), "Black");
    ctx.fillStyle = TH.acc; rond(ctx, 200, 900, W - 400, 16, 8); ctx.fill();
    centre(ctx, [["pour postuler", TH.txt]], 1060, 96, "Black");
    centre(ctx, [["à ces offres ", TH.txt], [p, TH.acc]], 1170, 64, "ExtraBold");
    drapeau(ctx, pays.code, (W - 220) / 2, 1290, 220);
  } else {
    ctx.fillStyle = C.capri; ctx.font = font("Black", 420); ctx.textAlign = "left"; ctx.fillText("“", 70, 640);
    centre(ctx, [["Tu connais", TH.txt]], 720, 110, "Black");
    centre(ctx, [["quelqu'un", TH.acc]], 850, 120, "Black");
    centre(ctx, [["qui cherche", TH.txt]], 980, 110, "Black");
    centre(ctx, [["du travail", TH.txt]], 1110, 110, "Black");
    centre(ctx, [[p + " ?", C.rose]], 1240, 96, "Black");
    drapeau(ctx, pays.code, (W - 200) / 2, 1350, 200);
  }
}

function chiffre(ctx, pays, total) {
  fond(ctx);
  centre(ctx, [[String(total), TH.acc]], 900, 300, "Black");
  centre(ctx, [["offres ouvertes", TH.txt]], 1050, 90, "Black");
  centre(ctx, [[`en ce moment ${PREP[pays.code] ?? ""}`, TH.txt]], 1160, 64, "ExtraBold");
  centre(ctx, [["Gratuit · sans inscription", TH.lab === "#fff" ? "#7FE0FF" : C.capri]], 1330, 56, "ExtraBold");
  centre(ctx, [["Emplois · stages · concours · bourses", TH.sub]], 1420, 44, "Bold");
}

function final(ctx) {
  fond(ctx);
  if (STYLE.nom === "notification") {
    centre(ctx, [["Une offre", TH.txt]], 640, 120, "Black");
    centre(ctx, [["te plaît ?", TH.acc]], 780, 120, "Black");
    centre(ctx, [["Tous les détails sur", TH.txt]], 1000, 60, "ExtraBold");
    pastilleSite(ctx, 1080, 66);
  } else if (STYLE.nom === "chiffre") {
    centre(ctx, [["De nouvelles offres", TH.txt]], 640, 96, "Black");
    centre(ctx, [["chaque matin", TH.acc]], 770, 110, "Black");
    ctx.font = font("Black", 64); const tw = ctx.measureText("ABONNE-TOI").width + 100;
    ctx.fillStyle = C.rose; rond(ctx, (W - tw) / 2, 900, tw, 130, 65); ctx.fill();
    centre(ctx, [["ABONNE-TOI", "#fff"]], 988, 64, "Black");
    pastilleSite(ctx, 1150, 60);
  } else if (STYLE.nom === "urgence") {
    centre(ctx, [["Ne laisse pas", TH.txt]], 640, 110, "Black");
    centre(ctx, [["passer ta chance.", TH.acc]], 780, 96, "Black");
    pastilleSite(ctx, 1000, 66);
  } else {
    centre(ctx, [["ENVOIE-LUI", TH.txt]], 640, 120, "Black");
    centre(ctx, [["CETTE VIDÉO", TH.acc]], 780, 110, "Black");
    centre(ctx, [["Les offres sont sur", TH.txt]], 1000, 60, "ExtraBold");
    pastilleSite(ctx, 1080, 66);
  }
  centre(ctx, [["Lien dans la bio", TH.txt]], 1520, 56, "ExtraBold");
}

// --------------------------------------------------------------------------
// Montage : une image par écran, léger zoom, transitions, son muet.
// --------------------------------------------------------------------------
function png(nom, draw) {
  const cv = createCanvas(W, H); const ctx = cv.getContext("2d");
  draw(ctx); const f = join(OUT, nom); writeFileSync(f, cv.toBuffer("image/png")); return f;
}

function montage(images, durees, sortie, voix = null) {
  const FPS = 30, T = 0.4;
  const inputs = [], filt = [];
  images.forEach((f, i) => {
    inputs.push("-i", f); // une seule image : zoompan en tire exactement n images
    const n = Math.round(durees[i] * FPS);
    filt.push(`[${i}:v]scale=1188:2112,zoompan=z='min(1+0.0018*on,1.1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${i}]`);
  });
  const effets = STYLE.effets;
  let prev = "v0", t = durees[0] - T;
  for (let i = 1; i < images.length; i++) {
    const out = i === images.length - 1 ? "vout" : `x${i}`;
    filt.push(`[${prev}][v${i}]xfade=transition=${effets[(i - 1) % effets.length]}:duration=${T}:offset=${t.toFixed(2)}[${out}]`);
    prev = out; t += durees[i] - T;
  }
  const total = durees.reduce((a, b) => a + b, 0) - T * (images.length - 1);
  // Son : silence de fond + la voix de chaque écran, calée sur son début.
  const n = images.length;
  inputs.push("-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo");
  let amap = `${n}:a`;
  if (voix) {
    const parts = [`[${n}:a]anull[s0]`]; let debut = 0;
    voix.forEach((f, i) => {
      inputs.push("-i", f);
      const ms = Math.round((debut + (i === 0 ? 0.15 : T + 0.1)) * 1000);
      parts.push(`[${n + 1 + i}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${ms}|${ms},volume=1.6[a${i}]`);
      debut += durees[i] - T;
    });
    parts.push(`[s0]${voix.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voix.length + 1}:normalize=0:duration=first[aout]`);
    filt.push(...parts); amap = "[aout]";
  }
  if (process.env.DEBUG) console.error(JSON.stringify(inputs.length), filt.slice(-12).join("\n"));
  execFileSync("ffmpeg", ["-nostdin", "-y", "-loglevel", process.env.DEBUG ? "info" : "error", ...inputs,
    "-filter_complex", filt.join(";"), "-map", "[vout]", "-map", amap,
    "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", sortie], { stdio: "inherit" });
  return total;
}

function legende(data) {
  const orgs = [...new Set(data.offres.map((o) => o.organisation).filter(Boolean))].slice(0, 3);
  const p = PREP[data.pays.code] ?? "";
  const qui = orgs.length ? `${orgs.join(", ")}${orgs.length > 1 ? " et d'autres recrutent" : " recrute"} cette semaine.` : "De nouvelles offres cette semaine.";
  const j = joursMin(data.offres);
  const accrocheTexte = {
    notification: `📲 Ce matin ${p}, de nouvelles offres viennent de tomber. Et si l'une d'elles était pour toi ?`,
    chiffre: `${data.total} offres ouvertes ${p} en ce moment 😮 Voici celles du jour.`,
    urgence: j ? `⏳ Plus que ${j} jour${j > 1 ? "s" : ""} pour postuler à ces offres ${p}.` : `⏳ Ces offres ${p} n'attendront pas.`,
    "quelqu'un": `Tu connais quelqu'un qui cherche du travail ${p} ? 👇`,
  }[STYLE.nom];
  return `${accrocheTexte} ${qui} ${data.total} offres ouvertes, gratuites, sur opportafrik.com (lien dans la bio). Envoie à un ami qui cherche 📲\n\n#emploi${TAG[data.pays.code] ?? ""} #${TAG[data.pays.code] ?? "afrique"} #${TAG[data.pays.code] ?? "afrique"}tiktok #recrutement #opportafrik`;
}

// --------------------------------------------------------------------------
// Voix off (Kokoro, voix ff_siwis validée par le propriétaire). Phrases
// courtes ; « Opporte Afrique point com » se prononce mieux que le nom écrit.
// --------------------------------------------------------------------------
const propre = (t) => String(t)
  .replace(/\((?:e|s|es|ne|le|ice|rice)\)/gi, "")
  .replace(/\((?:h\/f|f\/h|m\/f)\)|\b(?:h\/f|f\/h)\b/gi, "")
  .replace(/\bCDI\b/g, "C. D. I.").replace(/\bCDD\b/g, "C. D. D.")
  .replace(/[()«»"“”]/g, " ").replace(/\s*[/|]\s*/g, ", ").replace(/\s+/g, " ").trim();

const MOIS_L = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Une phrase différente pour chaque offre, sans répéter « recrute » ni le
// nom de l'entreprise deux fois (le titre est déjà nettoyé, voir titreNet).
function texteOffre(o, i) {
  const t = propre(o.title), org = o.organisation ? propre(o.organisation) : null, v = o.ville ? propre(o.ville) : null;
  let s;
  if (!org) s = [`${t}${v ? `, à ${v}` : ""}.`, `Ensuite : ${t}${v ? `, à ${v}` : ""}.`, `Autre offre : ${t}.`, `Et pour finir : ${t}.`][i % 4];
  else s = [`${t}, chez ${org}${v ? `, à ${v}` : ""}.`, `Ensuite, ${org} cherche : ${t}.`, `${t}${v ? `, à ${v}` : ""}. C'est chez ${org}.`, `Et pour finir : ${t}, avec ${org}.`][i % 4];
  if (o.limite) {
    const d = new Date(o.limite), j = Math.ceil((d.getTime() - Date.now()) / 864e5);
    if (j >= 1 && j <= 10) s += ` ${["Date limite : ", "À envoyer avant le ", "Clôture le ", "Dernier délai : "][i % 4]}${d.getUTCDate()} ${MOIS_L[d.getUTCMonth()]}.`;
  }
  return s;
}

function textesVoix(data) {
  const p = PREP[data.pays.code] ?? "", N = data.offres.length, T = data.total;
  const site = "Oppor Afrique, point com";
  const intro = {
    notification: nbRecruteurs(data) > 1 ? `Ce matin, ${p}, ${nbRecruteurs(data)} recruteurs cherchent quelqu'un. Et si c'était toi ?` : `Ce matin, ${p}, ${N} nouvelles offres viennent de tomber. Et si l'une d'elles était pour toi ?`,
    chiffre: `${T} offres ouvertes ${p}. Voici les nouvelles du jour.`,
    urgence: joursMin(data.offres) === 1 ? `Il ne reste qu'un jour pour postuler à ces offres ${p}.` : `Plus que ${joursMin(data.offres)} jours pour postuler à ces offres ${p}.`,
    "quelqu'un": `Tu connais quelqu'un qui cherche du travail ${p} ? Écoute bien.`,
  }[STYLE.nom];
  const k = STYLES.indexOf(STYLE);
  const out = [intro, ...data.offres.map((o, i) => texteOffre(o, i + k))];
  if (STYLE.nom !== "chiffre") out.push({ notification: `Et ce n'est pas tout : ${T} offres ${p}, gratuites.`, urgence: `En tout, ${T} offres sont ouvertes ${p}.`, "quelqu'un": `${T} offres ${p}, toutes gratuites.` }[STYLE.nom]);
  out.push({
    notification: `Tous les détails sont sur ${site}. Lien dans la bio !`,
    chiffre: `De nouvelles offres chaque matin. Abonne-toi, et postule sur ${site}.`,
    urgence: `Ne laisse pas passer ta chance. Le lien est dans la bio !`,
    "quelqu'un": `Envoie-lui cette vidéo. Les offres sont sur ${site}.`,
  }[STYLE.nom]);
  return out;
}

function voixOff(data) {
  const dir = process.env.VOIX;
  if (!dir) return null;
  const f = join(OUT, "textes.json");
  writeFileSync(f, JSON.stringify(textesVoix(data)));
  const d = JSON.parse(execFileSync("python3", [join(ROOT, "src", "voix.py"), dir, f, OUT], { encoding: "utf8" }).trim().split("\n").pop());
  return { fichiers: d.map((_, i) => join(OUT, `${i}.wav`)), durees: d };
}

// --------------------------------------------------------------------------
// Envoi à TikTok (brouillon dans la boîte de réception de l'appli).
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
// La vidéo est aussi rangée dans le dossier public « tiktok » de la base,
// pour la télécharger depuis /admin. Les vidéos de plus de 10 jours partent.
// --------------------------------------------------------------------------
async function ranger(fichier) {
  const url = supabaseUrl(), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: key, Authorization: `Bearer ${key}` };
  const nom = basename(fichier).replace(/\.mp4$/, `-${Date.now().toString(36)}.mp4`);
  const r = await fetch(`${url}/storage/v1/object/tiktok/${nom}`, {
    method: "POST", headers: { ...h, "Content-Type": "video/mp4", "x-upsert": "true" }, body: readFileSync(fichier),
  });
  if (!r.ok) throw new Error(`Rangement de la vidéo refusé : ${r.status} ${(await r.text()).slice(0, 200)}`);
  try {
    const liste = await fetch(`${url}/storage/v1/object/list/tiktok`, {
      method: "POST", headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 200, sortBy: { column: "created_at", order: "asc" } }),
    }).then((x) => x.json());
    const vieux = (Array.isArray(liste) ? liste : []).filter((o) => o.created_at && Date.now() - Date.parse(o.created_at) > 10 * 864e5).map((o) => o.name);
    if (vieux.length) await fetch(`${url}/storage/v1/object/tiktok`, {
      method: "DELETE", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: vieux }),
    });
  } catch (e) { console.log(`Ménage des vieilles vidéos impossible : ${e.message ?? e}`); }
  return `${url}/storage/v1/object/public/tiktok/${nom}`;
}

async function jeton() {
  const creds = await rpc("tiktok_creds");
  if (!creds?.client_key || !creds?.client_secret || !creds?.refresh) throw new Error("TikTok n'est pas encore branché dans /admin.");
  if (!creds.enabled) throw new Error("TikTok est éteint dans /admin.");
  const tok = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: creds.client_key, client_secret: creds.client_secret, grant_type: "refresh_token", refresh_token: creds.refresh }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Connexion TikTok refusée : ${tok.error_description || tok.error || JSON.stringify(tok).slice(0, 200)}. Rebranchez TikTok dans /admin.`);
  if (tok.refresh_token) await rpc("tiktok_save_token", { p_refresh: tok.refresh_token, p_refresh_in: tok.refresh_expires_in ?? null });
  return tok.access_token;
}

async function tiktok(fichier) {
  const token = await jeton();
  const size = statSync(fichier).size;
  const init = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } }),
  }).then((r) => r.json());
  if (init.error?.code !== "ok" || !init.data?.upload_url) throw new Error(`TikTok a refusé l'envoi : ${init.error?.message || init.error?.code || JSON.stringify(init).slice(0, 200)}`);
  const up = await fetch(init.data.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: readFileSync(fichier),
  });
  if (!up.ok) throw new Error(`Envoi du fichier refusé : ${up.status} ${(await up.text()).slice(0, 200)}`);
  return { pid: init.data.publish_id, token };
}

// Où en est la vidéo chez TikTok ? On demande toutes les 5 s, 3 min maximum,
// jusqu'à ce qu'elle soit dans la boîte de réception (ou refusée).
async function suivre(token, pid) {
  let dernier = null;
  for (let i = 0; i < 36; i++) {
    const r = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ publish_id: pid }),
    }).then((x) => x.json()).catch((e) => ({ error: { code: "reseau", message: String(e) } }));
    const st = r.data?.status || r.error?.code;
    if (JSON.stringify(r) !== JSON.stringify(dernier)) console.log(`Statut TikTok : ${JSON.stringify(r)}`);
    dernier = r;
    if (["SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"].includes(st) || (r.error && r.error.code !== "ok")) return r;
    await new Promise((ok) => setTimeout(ok, 5000));
  }
  return dernier;
}

// Seulement vérifier une vidéo déjà envoyée : node src/video.mjs --statut <publish_id>
async function statutSeul(pid) {
  const tok = await jeton();
  const r = await suivre(tok, pid);
  console.log(`Résultat : ${r?.data?.status || r?.error?.code} ${r?.data?.fail_reason || ""}`);
}

// --------------------------------------------------------------------------
// Envoi sur la chaîne YouTube (Short), si elle est branchée dans /admin.
// Tant que Google n'a pas vérifié l'appli, YouTube la garde en « Privé ».
// --------------------------------------------------------------------------
const DRAPEAU = { ML: "🇲🇱", CI: "🇨🇮", SN: "🇸🇳", BF: "🇧🇫", GN: "🇬🇳", NE: "🇳🇪", TG: "🇹🇬", BJ: "🇧🇯" };

function youtubeTextes(data, caption) {
  const p = PREP[data.pays.code] ?? "";
  const d = new Date();
  const jour = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const title = `Ils recrutent ${p} ${DRAPEAU[data.pays.code] ?? ""} Offres du ${jour} #Shorts`.replace(/\s+/g, " ").slice(0, 100);
  const lien = `https://opportafrik.com/${data.pays.slug}?src=yt`;
  const offres = data.offres.map((o) => `• ${o.organisation ? propreTexte(o.organisation) + " : " : ""}${propreTexte(o.title)}${o.ville ? ` (${propreTexte(o.ville)})` : ""}`).join("\n");
  const description = `${caption.replace(" (lien dans la bio)", "").split("\n\n")[0]}\n\n${offres}\n\n👉 Toutes les offres ${p}, gratuites : ${lien}\n\nEmplois, stages, concours et bourses dans 8 pays : Mali, Côte d'Ivoire, Sénégal, Burkina Faso, Guinée, Niger, Togo, Bénin.\n\n#emploi${TAG[data.pays.code] ?? ""} #recrutement #opportafrik`;
  const tags = ["emploi", `emploi ${data.pays.nom}`, "recrutement", "offre d'emploi", "stage", "concours", data.pays.nom, "Afrique", "Opportafrik"];
  return { title, description: description.slice(0, 4900), tags };
}
const propreTexte = (t) => String(t).replace(/[<>]/g, "").replace(/\s+/g, " ").trim();

async function youtube(fichier, data, caption) {
  const creds = await rpc("youtube_creds");
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh || !creds?.enabled) return null; // pas branché ou éteint
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: "refresh_token", refresh_token: creds.refresh }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Connexion YouTube refusée : ${tok.error_description || tok.error || JSON.stringify(tok).slice(0, 200)}. Rebranchez YouTube dans /admin.`);
  const { title, description, tags } = youtubeTextes(data, caption);
  const size = statSync(fichier).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      snippet: { title, description, tags, categoryId: "22", defaultLanguage: "fr", defaultAudioLanguage: "fr" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true },
    }),
  });
  const where = init.headers.get("location");
  if (!init.ok || !where) throw new Error(`YouTube a refusé l'envoi : ${init.status} ${(await init.text()).slice(0, 300)}`);
  const up = await fetch(where, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: readFileSync(fichier) });
  const v = await up.json().catch(() => ({}));
  if (!up.ok || !v.id) throw new Error(`Envoi du fichier à YouTube refusé : ${up.status} ${JSON.stringify(v).slice(0, 300)}`);
  let privacy = v.status?.privacyStatus ?? null;
  try {
    const chk = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${v.id}`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    privacy = chk.items?.[0]?.status?.privacyStatus ?? privacy;
  } catch { /* facultatif */ }
  return { id: v.id, privacy, title };
}

// --------------------------------------------------------------------------
// Reels Facebook et Instagram : la même vidéo part aussi en Reel sur la page
// Facebook et le compte Instagram déjà branchés dans /admin « Partage
// automatique » (même jeton, mêmes autorisations pages_manage_posts et
// instagram_content_publish). Les Reels sont montrés par Facebook et
// Instagram à des gens qui ne suivent PAS encore la page : c'est le moyen
// gratuit de toucher de nouveaux chercheurs d'emploi.
// --------------------------------------------------------------------------
const GRAPH = "https://graph.facebook.com/v21.0";

function reelTexte(data, caption, src) {
  const lien = `https://opportafrik.com/${data.pays.slug}?src=${src}`;
  return caption.replace(" (lien dans la bio)", "").replace("opportafrik.com", lien)
    + "\n\n👉 Abonnez-vous pour recevoir les nouvelles offres chaque jour.";
}

async function graph(path, params, method = "POST") {
  const r = await fetch(`${GRAPH}/${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(params) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function reelFacebook(acc, videoUrl, texte) {
  const start = await graph(`${acc.id}/video_reels`, { upload_phase: "start", access_token: acc.token });
  const up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${start.video_id}`, {
    method: "POST", headers: { Authorization: `OAuth ${acc.token}`, file_url: videoUrl },
  });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || uj.success === false) throw new Error(`envoi du fichier refusé : ${up.status} ${JSON.stringify(uj).slice(0, 200)}`);
  await graph(`${acc.id}/video_reels`, {
    upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description: texte, access_token: acc.token,
  });
  return start.video_id;
}

async function reelInstagram(acc, videoUrl, texte) {
  const c = await graph(`${acc.id}/media`, {
    media_type: "REELS", video_url: videoUrl, caption: texte, share_to_feed: true, access_token: acc.token,
  });
  // Instagram prépare la vidéo (souvent 20 s à 1 min) avant de pouvoir la publier.
  for (let i = 0; i < 30; i++) {
    await new Promise((ok) => setTimeout(ok, 10_000));
    const st = await fetch(`${GRAPH}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(acc.token)}`).then((r) => r.json());
    if (st.status_code === "FINISHED") return (await graph(`${acc.id}/media_publish`, { creation_id: c.id, access_token: acc.token })).id;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`Instagram n'a pas pu lire la vidéo : ${st.status || st.status_code}`);
  }
  throw new Error("Instagram n'a pas fini de préparer la vidéo en 5 minutes.");
}

async function reels(videoUrl, data, caption, ids) {
  const creds = await rpc("meta_reels_creds").catch(() => null);
  const erreurs = [];
  for (const [canal, envoyer, src] of [["facebook", reelFacebook, "fb"], ["instagram", reelInstagram, "ig"]]) {
    const acc = creds?.[canal];
    if (!acc?.id || !acc?.token || !acc?.enabled) { console.log(`Reel ${canal} : pas branché ou éteint.`); continue; }
    const texte = reelTexte(data, caption, src);
    try {
      const id = await envoyer(acc, videoUrl, texte);
      console.log(`Reel ${canal} publié : ${id}`);
      await rpc("reel_log", { p_channel: canal, p_zone: data.pays.code, p_offers: ids.length, p_message: texte, p_ok: true, p_result: `Reel publié (${id})` });
    } catch (e) {
      const m = `Reel ${canal} : ${e.message ?? e}`;
      console.log(m);
      await rpc("reel_log", { p_channel: canal, p_zone: data.pays.code, p_offers: ids.length, p_message: texte, p_ok: false, p_result: m }).catch(() => {});
      erreurs.push(new Error(m));
    }
  }
  return erreurs;
}

// --------------------------------------------------------------------------
// Les titres collectés répètent souvent l'employeur et « RECRUTE », en
// MAJUSCULES : « MATRANS RECRUTE RESPONSABLE CONTROLE TIC H/F ». On garde
// seulement le poste, en minuscules lisibles : « Responsable contrôle TIC ».
// --------------------------------------------------------------------------
const SIGLES = new Set(["TIC", "ERP", "RH", "ONG", "IT", "SIG", "BTP", "CDI", "CDD", "PNUD", "UNICEF", "OMS", "FAO", "BAD", "UEMOA", "CEDEAO", "PAM", "HCR", "QHSE", "HSE", "IA", "VIH", "SIDA", "DAF", "DG", "DRH", "BCEAO", "UE", "USAID", "GIZ", "SNV", "SAV", "GPS", "PME", "BIT", "UNOPS", "MSF"]);
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

// --------------------------------------------------------------------------
async function main() {
  const iStatut = process.argv.indexOf("--statut");
  if (iStatut > 0) return statutSeul(process.argv[iStatut + 1]);
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const data = EXEMPLE ? exemple() : await rpc("tiktok_video_data", { p_zone: process.env.PAYS || null });
  const zone = data.pays.code;
  data.offres = (data.offres ?? []).map((o) => ({ ...o, organisation: orgNet(o.organisation), title: titreNet(o.title, o.organisation) }));
  // Style « urgence » seulement s'il y a une date limite proche ; sinon le suivant.
  if (STYLE.nom === "urgence" && !(joursMin(data.offres) <= 10)) choisirStyle((STYLES.indexOf(STYLE) + 1) % STYLES.length);
  console.log(`Style du jour : ${STYLE.nom} (${STYLE.theme})`);
  if (!data.offres?.length) {
    console.log(`Aucune nouvelle offre pour ${data.pays.nom} : pas de vidéo aujourd'hui.`);
    if (!EXEMPLE) await rpc("tiktok_log", { p_zone: zone, p_ids: [], p_status: "rien", p_publish_id: null, p_caption: null, p_detail: `Aucune nouvelle offre (${data.pays.nom})` });
    return;
  }
  const images = [png("0.png", (c) => accroche(c, data))];
  data.offres.forEach((o, i) => images.push(png(`${i + 1}.png`, (c) => carteOffre(c, o, i + 1, data.pays, data.offres.length))));
  if (STYLE.nom !== "chiffre") images.push(png("8.png", (c) => chiffre(c, data.pays, data.total)));
  images.push(png("9.png", (c) => final(c)));
  let durees = [3, ...data.offres.map(() => 4.2), ...(STYLE.nom !== "chiffre" ? [3] : []), 3.6];
  const voix = voixOff(data);
  // Avec la voix : chaque écran dure le temps de sa phrase (+ une respiration).
  if (voix) durees = durees.map((d, i) => Math.max(i === 0 ? 2.6 : 3, +(voix.durees[i] + 0.8).toFixed(2)));
  const fichier = join(OUT, `opportafrik-${data.pays.slug}-${new Date().toISOString().slice(0, 10)}.mp4`);
  const total = montage(images, durees, fichier, voix?.fichiers ?? null);
  const caption = legende(data);
  writeFileSync(join(OUT, "legende.txt"), caption);
  console.log(`Vidéo prête : ${fichier} (${total.toFixed(1)} s, ${(statSync(fichier).size / 1e6).toFixed(1)} Mo)\n\n${caption}`);

  const ids = data.offres.map((o) => o.id).filter(Boolean);
  if (EXEMPLE) return;
  let video = null;
  try { video = await ranger(fichier); console.log(`Vidéo à télécharger : ${video}`); }
  catch (e) { console.log(String(e.message ?? e)); }
  if (ESSAI) {
    await rpc("tiktok_log", { p_zone: zone, p_ids: ids, p_status: "essai", p_publish_id: null, p_caption: caption, p_detail: "Essai : pas envoyée à TikTok.", p_video: video });
    return;
  }
  const erreurs = [];
  // TikTok (si branché et allumé) ; sinon la vidéo reste à télécharger dans /admin.
  const tt = await rpc("tiktok_creds").catch(() => null);
  if (tt?.client_key && tt?.client_secret && tt?.refresh && tt?.enabled) {
    try {
      const { pid, token } = await tiktok(fichier);
      console.log(`Envoyée à TikTok : ${pid}`);
      const r = await suivre(token, pid);
      const st = r?.data?.status || r?.error?.code || "inconnu";
      if (st === "FAILED") throw new Error(`TikTok a refusé la vidéo : ${r.data.fail_reason || "raison inconnue"}`);
      await rpc("tiktok_log", { p_zone: zone, p_ids: ids, p_status: "envoyee", p_publish_id: pid, p_caption: caption,
        p_detail: st === "SEND_TO_USER_INBOX" ? null : `Statut TikTok : ${st}`, p_video: video });
      console.log(`Brouillon TikTok : ${st}`);
    } catch (e) {
      await rpc("tiktok_log", { p_zone: zone, p_ids: ids, p_status: "erreur", p_publish_id: null, p_caption: caption, p_detail: String(e.message ?? e), p_video: video });
      erreurs.push(e);
    }
  } else {
    await rpc("tiktok_log", { p_zone: zone, p_ids: ids, p_status: "essai", p_publish_id: null, p_caption: caption, p_detail: "TikTok pas branché ou éteint : vidéo à télécharger.", p_video: video });
  }
  // YouTube (si branché et allumé).
  try {
    const y = await youtube(fichier, data, caption);
    if (y) {
      console.log(`Envoyée sur YouTube : https://youtu.be/${y.id} (${y.privacy})`);
      await rpc("youtube_log", { p_zone: zone, p_status: "envoyee", p_video_id: y.id, p_privacy: y.privacy, p_title: y.title, p_detail: null, p_ids: ids });
    } else console.log("YouTube pas branché ou éteint.");
  } catch (e) {
    console.log(String(e.message ?? e));
    await rpc("youtube_log", { p_zone: zone, p_status: "erreur", p_video_id: null, p_privacy: null, p_title: null, p_detail: String(e.message ?? e) }).catch(() => {});
    erreurs.push(e);
  }
  // Reels Facebook et Instagram (si la page est branchée dans « Partage automatique »).
  if (video) erreurs.push(...await reels(video, data, caption, ids));
  else console.log("Reels : vidéo non rangée, pas d'envoi.");
  if (erreurs.length) throw erreurs[0];
}

main().catch((e) => { console.error(e); process.exit(1); });
