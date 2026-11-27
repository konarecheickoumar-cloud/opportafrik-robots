// Vidéo « avec images » (essai) : récupère les vraies offres du jour, le logo
// du recruteur et une image d'illustration du métier (générée, gratuite, sans
// compte, par image.pollinations.ai ; secours : photo libre Openverse).
//   node src/images-donnees.mjs <dossier_sortie>      (PAYS=ML par défaut)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] || "sortie-images";
mkdirSync(OUT, { recursive: true });

function supabaseUrl() {
  let v = (process.env.SUPABASE_URL || "").trim().replace(/^["'<]+|["'>]+$/g, "").trim();
  if (/^[a-z0-9]{15,30}$/.test(v)) v = `https://${v}.supabase.co`;
  else if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
  try { v = new URL(v).origin; } catch {}
  return v;
}
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
async function rpc(name, body = {}) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/${name}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text(); if (!r.ok) throw new Error(`${name} : ${r.status} ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

// Métier -> description de l'image (en anglais pour le générateur).
const METIERS = [
  [/chauffeur|conducteur|driver/i, "a smiling young African man in a white shirt driving a car, hands on the steering wheel"],
  [/comptab|financ|audit|tr[ée]sor|recouvrement|caisse|caissier/i, "a confident young African woman accountant working with a calculator and documents at a modern office desk"],
  [/d[ée]velopp|informati|r[ée]seau|syst[eè]me|digital|web|data|tic\b|it\b/i, "a young African software developer working on code on a computer screen in a modern office"],
  [/commerc|vente|vendeu|marketing|client/i, "a smiling young African saleswoman talking with a customer in a shop"],
  [/communic|community|journal|m[ée]dia/i, "a young African communication officer working on social media on a laptop and smartphone"],
  [/m[ée]dec|infirm|sant[ée]|pharma|sage|m[ée]dical|nutrition/i, "a young African nurse in a hospital, smiling, wearing scrubs"],
  [/enseign|professeur|formateur|[ée]ducat|instituteur/i, "a young African teacher in front of a classroom blackboard"],
  [/ing[ée]nieur|technicien|[ée]lectric|m[ée]cani|maintenance|btp|g[ée]nie|chantier/i, "a young African engineer wearing a safety helmet and vest on a construction site"],
  [/agro|agri|[ée]levage|v[ée]t[ée]rin|environnement/i, "a young African agronomist in a green field holding a tablet"],
  [/logisti|magasin|stock|transit|approvision|achat/i, "a young African logistics officer checking boxes in a warehouse with a tablet"],
  [/secr[ée]tair|assistant|administra|accueil|r[ée]ception/i, "a smiling young African administrative assistant at a reception desk with a computer"],
  [/rh\b|ressources humaines|recrut/i, "a young African HR officer interviewing a candidate in a bright office"],
  [/juri|avocat|droit|notaire/i, "a young African lawyer reading legal documents in an office"],
  [/s[ée]curit|gardien|vigile/i, "a professional African security guard in uniform at the entrance of a building"],
  [/h[ôo]tel|cuisin|restaura|serveu/i, "a young African chef in a professional kitchen"],
  [/concours|fonction publique|minist/i, "young African candidates writing an exam in a large exam hall"],
  [/bourse|universit|master|doctorat|[ée]tudiant/i, "a smiling young African student with books on a university campus"],
  [/projet|coordinat|suivi|[ée]valuation|ong|humanitaire|programme/i, "a young African project officer in a meeting with a team, notebook and laptop"],
];
const decrire = (o) => (METIERS.find(([re]) => re.test(`${o.title} ${o.categorie}`))?.[1]) ?? "a confident young African professional in a modern office in Bamako";

async function telecharger(url, fichier, min = 8000) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "opportafrik-video/1.0" } });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b.length >= min && /image\//.test(r.headers.get("content-type") || "image/")) { writeFileSync(fichier, b); return true; }
      console.log(`  essai ${i + 1} : ${r.status} ${b.length} o`);
    } catch (e) { console.log(`  essai ${i + 1} : ${e.message}`); }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function image(o, i) {
  const desc = decrire(o);
  const prompt = `${desc}, West Africa, natural light, realistic professional photo, sharp, joyful, no text, no watermark`;
  const fichier = join(OUT, `photo-${i}.jpg`);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=720&nologo=true&seed=${27 + i}&model=flux`;
  console.log(`Image ${i} : ${desc}`);
  if (await telecharger(url, fichier)) return { fichier: `photo-${i}.jpg`, source: "pollinations", prompt };
  // Secours : photo libre (usage commercial autorisé) sur Openverse.
  try {
    const q = desc.split(" ").slice(2, 6).join(" ");
    const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license_type=commercial&page_size=5`);
    const j = await r.json();
    for (const it of j.results ?? []) {
      if (await telecharger(it.url, fichier)) return { fichier: `photo-${i}.jpg`, source: "openverse", credit: `${it.creator ?? ""} (${it.license} ${it.license_version ?? ""})`, lien: it.foreign_landing_url };
    }
  } catch (e) { console.log("  openverse : " + e.message); }
  return null;
}

const pays = process.env.PAYS || "ML";
const data = await rpc("tiktok_video_data", { p_zone: pays });
console.log(`${data.pays.nom} : ${data.total} offres ouvertes, ${data.offres.length} choisies`);
const ids = data.offres.map((o) => o.id).join(",");
let extra = [];
if (ids) {
  const r = await fetch(`${supabaseUrl()}/rest/v1/opportunities?id=in.(${ids})&select=id,summary,organization:organizations(name,logo_url)`, { headers: H });
  extra = r.ok ? await r.json() : [];
}
for (const [i, o] of data.offres.entries()) {
  const e = extra.find((x) => x.id === o.id);
  o.resume = e?.summary?.slice(0, 400) ?? null;
  o.logo = null;
  if (e?.organization?.logo_url) {
    const ext = (e.organization.logo_url.match(/\.(png|jpe?g|webp|svg)(\?|$)/i)?.[1] ?? "png").toLowerCase();
    if (await telecharger(e.organization.logo_url, join(OUT, `logo-${i}.${ext}`), 300)) o.logo = `logo-${i}.${ext}`;
  }
  o.photo = await image(o, i);
}
writeFileSync(join(OUT, "offres.json"), JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, null, 2));
