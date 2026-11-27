// Vidéo du jour « avec images » : récupère les vraies offres du jour, le logo
// du recruteur et une image d'illustration du métier (générée, gratuite, sans
// compte, par image.pollinations.ai ; secours : photo libre Openverse).
//   node src/images-donnees.mjs <dossier_sortie>      (PAYS facultatif, sinon pays du jour)
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
  [/secr[ée]tair|assistant|administra|accueil|r[ée]ception/i, "a smiling African administrative assistant at a reception desk with a computer"],
  [/chauffeur|conducteur|driver/i, "a smiling African man in a white shirt driving a car, hands on the steering wheel"],
  [/comptab|financ|audit|tr[ée]sor|recouvrement|caisse|caissier/i, "a confident African woman accountant working with a calculator and documents at a modern office desk"],
  [/cyber|soc\b|s[ée]curit[ée] informatique/i, "a focused African cybersecurity analyst in front of several monitors in a security operations center"],
  [/d[ée]velopp|informati|r[ée]seau|syst[eè]me|digital|web|data|tic\b|it\b/i, "an African software developer working on code on a computer screen in a modern office"],
  [/commerc|vente|vendeu|marketing|client|business/i, "a smiling African saleswoman talking with a customer in a shop"],
  [/communic|community|journal|m[ée]dia/i, "an African communication officer working on social media on a laptop and smartphone"],
  [/m[ée]dec|infirm|sant[ée]|pharma|sage|m[ée]dical|nutrition/i, "an African nurse in a hospital, smiling, wearing scrubs"],
  [/enseign|professeur|formateur|[ée]ducat|instituteur/i, "an African teacher in front of a classroom blackboard"],
  [/ing[ée]nieur|technicien|[ée]lectric|m[ée]cani|maintenance|btp|g[ée]nie|chantier/i, "an African engineer wearing a safety helmet and vest on a construction site"],
  [/agro|agri|[ée]levage|v[ée]t[ée]rin|environnement/i, "an African agronomist in a green field holding a tablet"],
  [/logisti|magasin|stock|transit|approvision|achat/i, "an African logistics officer checking boxes in a warehouse with a tablet"],
  [/rh\b|ressources humaines|recrut/i, "an African HR officer interviewing a candidate in a bright office"],
  [/juri|avocat|droit|notaire/i, "an African lawyer reading legal documents in an office"],
  [/s[ée]curit|gardien|vigile/i, "a professional African security guard in uniform at the entrance of a building"],
  [/h[ôo]tel|cuisin|restaura|serveu/i, "an African chef in a professional kitchen"],
  [/concours|fonction publique|minist/i, "adult African candidates writing an exam in a large exam hall"],
  [/bourse|universit|master|doctorat|[ée]tudiant/i, "a smiling African student with books on a university campus"],
  [/projet|coordinat|suivi|[ée]valuation|ong|humanitaire|programme/i, "an African project officer in a meeting with a team, notebook and laptop"],
];
const decrire = (o) => (METIERS.find(([re]) => re.test(`${o.title} ${o.categorie}`))?.[1]) ?? "a confident African professional in a modern office in Bamako";

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

// Pas de photo « au hasard » d'Internet (personnes réelles, droits) : seulement
// des images générées. Limite gratuite : une image à la fois, pause entre deux.
async function image(o, i) {
  const desc = decrire(o);
  const prompt = `${desc}, one adult ${i % 2 ? "woman" : "man"} aged 30, facing the camera, smiling, wearing professional clothes, West Africa, natural light, realistic professional photo, sharp, joyful, no text, no watermark`;
  const fichier = join(OUT, `photo-${i}.jpg`);
  console.log(`Image ${i} : ${desc}`);
  for (let essai = 0; essai < 4; essai++) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=800&nologo=true&seed=${27 + i + essai * 100}&model=flux&referrer=opportafrik`;
    if (await telecharger(url, fichier)) { await new Promise((r) => setTimeout(r, 20_000)); return { fichier: `photo-${i}.jpg`, source: "pollinations", prompt }; }
    await new Promise((r) => setTimeout(r, 30_000));
  }
  return null;
}

// Choix des offres : un MÉLANGE de niveaux (demande du propriétaire, 27/11) :
// 1 poste « moyen » très demandé (assistant, comptable, chauffeur, commercial,
// technicien…), 1 poste confirmé (responsable, chargé, ingénieur…) et
// au plus 1 stage. Jamais 3 débutants ou 3 stagiaires.
// Pays : PAYS si donné, sinon le « pays du jour » (rotation de la base).
const data = await rpc("tiktok_video_data", { p_zone: process.env.PAYS || null }); // pays + total
const pays = data.pays.code;
const depuis = new Date(Date.now() - 10 * 864e5).toISOString(), limite2j = new Date(Date.now() + 2 * 864e5).toISOString();
const q = new URLSearchParams({
  select: "id,title,organization_name,city,category,contract_type,deadline_at,slug,created_at",
  country_code: `eq.${pays}`, status: "eq.publiee", category: "in.(emploi,stage,concours)",
  created_at: `gt.${depuis}`, or: `(deadline_at.is.null,deadline_at.gte.${limite2j})`, order: "created_at.desc", limit: "300",
});
const cands = await (await fetch(`${supabaseUrl()}/rest/v1/opportunities?${q}`, { headers: H })).json();
const dejaR = await fetch(`${supabaseUrl()}/rest/v1/broadcasts?channel=eq.tiktok&select=opportunity_id&limit=5000`, { headers: H });
const deja = new Set(dejaR.ok ? (await dejaR.json()).map((x) => x.opportunity_id) : []);
const sans = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const niveau = (o) => {
  const t = sans(o.title);
  if (o.category === "stage" || /stagiaire|\bstage\b|junior|debutant|apprenti/.test(t)) return "debutant";
  if (/directeur|directrice|\bdg\b|head of|chef de (projet|mission|service|departement)|senior/.test(t)) return "haut";
  if (/responsable|charge|chargee|ingenieur|coordinat|superviseu|specialiste|gestionnaire|analyste|controleur|auditeur|manager|officer|chef /.test(t)) return "confirme";
  if (/assistant|secretaire|comptable|chauffeur|commercia|agent|caissier|caissiere|technicien|vendeu|receptionniste|magasinier|infirmier|enseignant|animat|operat|electricien|conseill|livreur|cuisinier|serveu|hotesse|infographiste|community/.test(t)) return "moyen";
  return o.category === "concours" ? "moyen" : "confirme";
};
const note = (o) => (o.deadline_at ? 2 : 0) + (o.city ? 1 : 0) + (o.organization_name ? 2 : 0);
const pool = cands.filter((o) => !deja.has(o.id) && o.title.length <= 90).map((o, k) => ({ o, k, n: niveau(o) }))
  .sort((a, b) => note(b.o) - note(a.o) || a.k - b.k);
const choix = [];
const prendre = (n) => { const c = pool.find((x) => x.n === n && !choix.includes(x) && !choix.some((y) => y.o.organization_name && y.o.organization_name === x.o.organization_name)); if (c) choix.push(c); };
prendre("moyen"); prendre("confirme"); prendre("debutant");
for (const n of ["moyen", "confirme", "haut"]) if (choix.length < 3) prendre(n);
console.log("Niveaux choisis : " + choix.map((c) => c.n).join(", "));
data.offres = choix.map(({ o }) => ({ id: o.id, title: o.title, organisation: o.organization_name?.trim() || null, ville: o.city, categorie: o.category, contrat: o.contract_type, limite: o.deadline_at, slug: o.slug, niveau: niveau(o) }));
console.log(`${data.pays.nom} : ${data.total} offres ouvertes, ${cands.length} récentes, ${data.offres.length} choisies`);
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
