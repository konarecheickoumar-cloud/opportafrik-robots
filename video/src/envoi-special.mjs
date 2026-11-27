// Envoi EXCEPTIONNEL d'une vidéo déjà montée, tout de suite, hors horaires :
// YouTube (Short), Reel Facebook + Instagram, TikTok (brouillon si l'appli
// le permet) et rangement dans /admin « Vidéo TikTok du jour » (bouton
// « Télécharger la vidéo » + légende).
// Usage : node video/src/envoi-special.mjs <dossier> [canaux]
//   <dossier> contient video.mp4 et envoi.json :
//   { zone, title, description, tags[], categoryId, caption, reel }
//   [canaux] : liste séparée par des virgules (youtube,facebook,instagram,tiktok) ; vide = tous.
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

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
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${name} : ${r.status} ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

const dossier = process.argv[2];
if (!dossier) throw new Error("Indiquez le dossier (ex. films/27-formations)");
const voulus = new Set((process.argv[3] || "youtube,facebook,instagram,tiktok").split(",").map((s) => s.trim()).filter(Boolean));
const meta = JSON.parse(readFileSync(join(dossier, "envoi.json"), "utf8"));
const fichier = join(dossier, "video.mp4");
const zone = meta.zone || "ML";
const erreurs = [];

// 1. Rangement public (sert au téléchargement dans /admin et aux Reels).
async function ranger() {
  const url = supabaseUrl(), key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const nom = `${basename(dossier)}-${Date.now().toString(36)}.mp4`;
  const r = await fetch(`${url}/storage/v1/object/tiktok/${nom}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "video/mp4", "x-upsert": "true" }, body: readFileSync(fichier),
  });
  if (!r.ok) throw new Error(`Rangement refusé : ${r.status} ${(await r.text()).slice(0, 200)}`);
  return `${url}/storage/v1/object/public/tiktok/${nom}`;
}

async function youtube() {
  const creds = await rpc("youtube_creds");
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh) throw new Error("Chaîne YouTube non branchée dans /admin.");
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: "refresh_token", refresh_token: creds.refresh }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Connexion YouTube refusée : ${tok.error_description || tok.error}`);
  const size = statSync(fichier).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
    body: JSON.stringify({
      snippet: { title: String(meta.title).slice(0, 100), description: String(meta.description).slice(0, 4900), tags: meta.tags ?? [], categoryId: meta.categoryId || "22", defaultLanguage: "fr", defaultAudioLanguage: "fr" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true },
    }),
  });
  const where = init.headers.get("location");
  if (!init.ok || !where) throw new Error(`YouTube a refusé l'envoi : ${init.status} ${(await init.text()).slice(0, 300)}`);
  const up = await fetch(where, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: readFileSync(fichier) });
  const v = await up.json().catch(() => ({}));
  if (!up.ok || !v.id) throw new Error(`Envoi du fichier refusé : ${up.status} ${JSON.stringify(v).slice(0, 300)}`);
  await rpc("youtube_log", { p_zone: zone, p_status: "envoyee", p_video_id: v.id, p_privacy: v.status?.privacyStatus ?? null, p_title: meta.title, p_detail: "Envoi exceptionnel" });
  console.log(`YouTube : https://youtu.be/${v.id} (${v.status?.privacyStatus})`);
}

const GRAPH = "https://graph.facebook.com/v21.0";
async function graph(path, params) {
  const r = await fetch(`${GRAPH}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || `${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
async function reelFacebook(acc, videoUrl, texte) {
  const start = await graph(`${acc.id}/video_reels`, { upload_phase: "start", access_token: acc.token });
  const up = await fetch(`https://rupload.facebook.com/video-upload/v21.0/${start.video_id}`, { method: "POST", headers: { Authorization: `OAuth ${acc.token}`, file_url: videoUrl } });
  const uj = await up.json().catch(() => ({}));
  if (!up.ok || uj.success === false) throw new Error(`envoi du fichier refusé : ${up.status} ${JSON.stringify(uj).slice(0, 200)}`);
  await graph(`${acc.id}/video_reels`, { upload_phase: "finish", video_id: start.video_id, video_state: "PUBLISHED", description: texte, access_token: acc.token });
  return start.video_id;
}
async function reelInstagram(acc, videoUrl, texte) {
  const c = await graph(`${acc.id}/media`, { media_type: "REELS", video_url: videoUrl, caption: texte, share_to_feed: true, access_token: acc.token });
  for (let i = 0; i < 30; i++) {
    await new Promise((ok) => setTimeout(ok, 10_000));
    const st = await fetch(`${GRAPH}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(acc.token)}`).then((r) => r.json());
    if (st.status_code === "FINISHED") return (await graph(`${acc.id}/media_publish`, { creation_id: c.id, access_token: acc.token })).id;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`Instagram n'a pas pu lire la vidéo : ${st.status || st.status_code}`);
  }
  throw new Error("Instagram n'a pas fini de préparer la vidéo en 5 minutes.");
}

async function tiktokBrouillon() {
  const creds = await rpc("tiktok_creds");
  if (!creds?.client_key || !creds?.client_secret || !creds?.refresh || !creds?.enabled) return "TikTok pas branché ou éteint";
  const tok = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: creds.client_key, client_secret: creds.client_secret, grant_type: "refresh_token", refresh_token: creds.refresh }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Connexion TikTok refusée : ${tok.error_description || tok.error}`);
  if (tok.refresh_token) await rpc("tiktok_save_token", { p_refresh: tok.refresh_token, p_refresh_in: tok.refresh_expires_in ?? null });
  const size = statSync(fichier).size;
  const init = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } }),
  }).then((r) => r.json());
  if (init.error?.code !== "ok" || !init.data?.upload_url) throw new Error(`TikTok a refusé l'envoi : ${init.error?.message || init.error?.code}`);
  const up = await fetch(init.data.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` }, body: readFileSync(fichier) });
  if (!up.ok) throw new Error(`Envoi du fichier refusé : ${up.status}`);
  return `brouillon envoyé (${init.data.publish_id})`;
}

let video = null;
try { video = await ranger(); console.log(`Vidéo rangée : ${video}`); } catch (e) { console.log(String(e.message ?? e)); erreurs.push(e); }

if (voulus.has("youtube")) {
  try { await youtube(); } catch (e) {
    console.log(`YouTube : ${e.message ?? e}`); erreurs.push(e);
    await rpc("youtube_log", { p_zone: zone, p_status: "erreur", p_video_id: null, p_privacy: null, p_title: meta.title, p_detail: String(e.message ?? e) }).catch(() => {});
  }
}

if (video && (voulus.has("facebook") || voulus.has("instagram"))) {
  const creds = await rpc("meta_reels_creds").catch(() => null);
  for (const [canal, envoyer, src] of [["facebook", reelFacebook, "fb"], ["instagram", reelInstagram, "ig"]]) {
    if (!voulus.has(canal)) continue;
    const acc = creds?.[canal];
    if (!acc?.id || !acc?.token || !acc?.enabled) { console.log(`Reel ${canal} : pas branché ou éteint.`); continue; }
    const texte = String(meta.reel || meta.caption).replace("opportafrik.com/competences", `opportafrik.com/competences?src=${src}`);
    try {
      const id = await envoyer(acc, video, texte);
      console.log(`Reel ${canal} publié : ${id}`);
      await rpc("reel_log", { p_channel: canal, p_zone: zone, p_offers: 0, p_message: texte, p_ok: true, p_result: `Reel publié (${id}) – envoi exceptionnel` });
    } catch (e) {
      const m = `Reel ${canal} : ${e.message ?? e}`; console.log(m); erreurs.push(new Error(m));
      await rpc("reel_log", { p_channel: canal, p_zone: zone, p_offers: 0, p_message: texte, p_ok: false, p_result: m }).catch(() => {});
    }
  }
}

if (voulus.has("tiktok")) {
  let detail;
  try { detail = await tiktokBrouillon(); } catch (e) { detail = String(e.message ?? e); }
  console.log(`TikTok : ${detail}`);
  await rpc("tiktok_log", { p_zone: zone, p_ids: [], p_status: "essai", p_publish_id: null, p_caption: meta.caption,
    p_detail: `Envoi exceptionnel : à télécharger et publier dans TikTok (${detail}).`, p_video: video }).catch((e) => { console.log(String(e.message ?? e)); erreurs.push(e); });
}

if (erreurs.length) { console.error(erreurs[0]); process.exit(1); }
