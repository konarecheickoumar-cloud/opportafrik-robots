// Envoie un film « Opportafrik Stories » (déjà monté) sur la chaîne YouTube.
// Usage : node src/film.mjs <dossier>  (le dossier contient video.mp4 et youtube.json)
// youtube.json : { title, description, tags[], zone (ex. ML), categoryId,
//   playlist (facultatif : nom de la playlist, créée si besoin),
//   videoId (facultatif : vidéo DÉJÀ envoyée → on la range seulement dans la playlist) }
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (mêmes secrets que la vidéo du jour).
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

// Range une vidéo dans la playlist « nom » de la chaîne (créée si elle n'existe pas).
// Il faut la permission « gérer la chaîne » (rebrancher YouTube dans /admin une fois).
async function playlist(auth, nom, videoId) {
  if (!nom) return "Pas de playlist demandée.";
  const api = "https://www.googleapis.com/youtube/v3";
  let id = null, page = "";
  do {
    const r = await fetch(`${api}/playlists?part=snippet&mine=true&maxResults=50${page ? `&pageToken=${page}` : ""}`, { headers: auth }).then((x) => x.json());
    if (r.error) throw new Error(`liste des playlists : ${r.error.message}`);
    id = r.items?.find((p) => p.snippet?.title === nom)?.id ?? null;
    page = id ? "" : r.nextPageToken ?? "";
  } while (page);
  if (!id) {
    const r = await fetch(`${api}/playlists?part=snippet,status`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { title: nom, description: meta.playlistDescription ?? "", defaultLanguage: "fr" }, status: { privacyStatus: "public" } }),
    }).then((x) => x.json());
    if (!r.id) throw new Error(`création de la playlist refusée : ${r.error?.message ?? JSON.stringify(r).slice(0, 200)} (rebranchez YouTube dans /admin)`);
    id = r.id;
  }
  const deja = await fetch(`${api}/playlistItems?part=snippet&playlistId=${id}&videoId=${videoId}`, { headers: auth }).then((x) => x.json());
  if (deja.items?.length) return `Déjà dans la playlist « ${nom} ».`;
  const body = { snippet: { playlistId: id, resourceId: { kind: "youtube#video", videoId } } };
  if (Number.isInteger(meta.position)) body.snippet.position = meta.position;
  let r = await fetch(`${api}/playlistItems?part=snippet`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error && body.snippet.position !== undefined) {
    delete body.snippet.position; // position plus grande que la playlist : on ajoute à la fin
    r = await fetch(`${api}/playlistItems?part=snippet`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  }
  if (r.error) throw new Error(`ajout à la playlist refusé : ${r.error.message}`);
  return `Rangée dans la playlist « ${nom} » : https://www.youtube.com/playlist?list=${id}`;
}

const dossier = process.argv[2];
if (!dossier) throw new Error("Indiquez le dossier du film (ex. films/25-aicha)");
const meta = JSON.parse(readFileSync(join(dossier, "youtube.json"), "utf8"));
const fichier = join(dossier, "video.mp4");
const zone = meta.zone || "ML";

try {
  const creds = await rpc("youtube_creds");
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh) throw new Error("Chaîne YouTube non branchée dans /admin.");
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.client_id, client_secret: creds.client_secret, grant_type: "refresh_token", refresh_token: creds.refresh }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Connexion YouTube refusée : ${tok.error_description || tok.error}. Rebranchez YouTube dans /admin.`);
  const auth = { Authorization: `Bearer ${tok.access_token}` };
  if (meta.videoId) {
    console.log(await playlist(auth, meta.playlist, meta.videoId));
    process.exit(0);
  }
  const size = statSync(fichier).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      snippet: { title: String(meta.title).slice(0, 100), description: String(meta.description).slice(0, 4900), tags: meta.tags ?? [], categoryId: meta.categoryId || "1", defaultLanguage: "fr", defaultAudioLanguage: "fr" },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false, embeddable: true },
    }),
  });
  const where = init.headers.get("location");
  if (!init.ok || !where) throw new Error(`YouTube a refusé l'envoi : ${init.status} ${(await init.text()).slice(0, 300)}`);
  const up = await fetch(where, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: readFileSync(fichier) });
  const v = await up.json().catch(() => ({}));
  if (!up.ok || !v.id) throw new Error(`Envoi du fichier refusé : ${up.status} ${JSON.stringify(v).slice(0, 300)}`);
  const privacy = v.status?.privacyStatus ?? null;
  await rpc("youtube_log", { p_zone: zone, p_status: "envoyee", p_video_id: v.id, p_privacy: privacy, p_title: meta.title, p_detail: "Film Opportafrik Stories" });
  console.log(`Film envoyé : https://youtu.be/${v.id} (${privacy})`);
  if (meta.playlist) console.log(await playlist(auth, meta.playlist, v.id).catch((e) => `Playlist non remplie : ${e.message ?? e}`));
} catch (e) {
  await rpc("youtube_log", { p_zone: zone, p_status: "erreur", p_video_id: null, p_privacy: null, p_title: meta.title, p_detail: String(e.message ?? e) }).catch(() => {});
  throw e;
}
