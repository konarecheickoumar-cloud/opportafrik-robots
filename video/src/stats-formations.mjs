// Classement des formations par intérêt des visiteurs (lecture seule, même calcul que
// /admin « Formations et certificats ») : lancé par film.yml avec dossier = stats.
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
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const r = await fetch(`${supabaseUrl()}/rest/v1/rpc/admin_formations`, {
  method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}",
});
const t = await r.text();
if (!r.ok) { console.log(r.status, t.slice(0, 500)); process.exit(1); }
const d = JSON.parse(t);
const rows = (d.courses || []).map((c) => ({ slug: c.slug, visiteurs30j: c.visitors, commencees: c.started, terminees: c.finished, examens: c.exams, reussis: c.passed }))
  .sort((a, b) => b.commencees - a.commencees || b.visiteurs30j - a.visiteurs30j);
for (const x of rows) console.log(JSON.stringify(x));
