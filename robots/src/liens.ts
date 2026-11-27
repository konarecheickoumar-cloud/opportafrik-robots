import { createClient } from '@supabase/supabase-js';
import { config } from './config.ts';
import { linkStatus, siteOf } from './http.ts';

// Robot « liens morts » : retire du site les offres dont la page d'origine a disparu.
//   npm run liens            → une fois par jour (entre 6 h et 8 h UTC), sinon ne fait rien
//   npm run liens -- --forcer → tout de suite
//   npm run liens -- --essai  → affiche ce qui serait retiré, sans rien changer
// Règle prudente : seule une page « introuvable » (404/410) compte, et il faut deux
// vérifications ratées de suite (deux jours différents) pour retirer l'offre.

const MAX_OFFERS = 250;       // offres vérifiées par passage
const MAX_PER_SITE = 25;      // le robot attend 4 s entre deux pages d'un même site
const TIME_LIMIT_MS = 150_000; // le passage s'arrête après 2 min 30
const GONE = new Set([404, 410]);

type Row = { id: string; title: string; link_fail_count: number; opportunity_links: { url: string }[] };

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--forcer');
  const dry = args.includes('--essai');
  const hour = new Date().getUTCHours();
  if (!force && !dry && (hour < 6 || hour >= 8)) {
    console.log('Liens : vérification faite une fois par jour (6 h-8 h UTC), rien à faire maintenant.');
    return;
  }
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.log('Liens : pas de base, rien à vérifier.');
    return;
  }
  const db = createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
  const { data, error } = await db
    .from('opportunities')
    .select('id, title, link_fail_count, opportunity_links!inner(url)')
    .eq('status', 'publiee')
    .order('link_checked_at', { ascending: true, nullsFirst: true })
    .limit(MAX_OFFERS * 2);
  if (error) {
    // Base pas encore à jour (migration 072) : on ne bloque pas les autres robots.
    console.log('Liens : lecture impossible', error.message);
    return;
  }

  // Un même site au plus MAX_PER_SITE fois ; les sites sont visités en parallèle.
  const bySite = new Map<string, Row[]>();
  let kept = 0;
  for (const r of (data ?? []) as Row[]) {
    const url = r.opportunity_links[0]?.url;
    if (!url || kept >= MAX_OFFERS) continue;
    let site: string;
    try { site = siteOf(new URL(url).host); } catch { continue; }
    const list = bySite.get(site) ?? [];
    if (list.length >= MAX_PER_SITE) continue;
    list.push(r);
    bySite.set(site, list);
    kept++;
  }

  const start = Date.now();
  let checked = 0, gone = 0, removed = 0;
  await Promise.all([...bySite.values()].map(async (rows) => {
    for (const r of rows) {
      if (Date.now() - start > TIME_LIMIT_MS) return;
      const results = await Promise.all(r.opportunity_links.slice(0, 2).map((l) => linkStatus(l.url)));
      checked++;
      // Inconnu (site injoignable, bloqué, erreur serveur) : on ne conclut rien.
      const known = results.filter((x) => x.status !== 0 && x.status !== 'interdit' && !(typeof x.status === 'number' && x.status >= 500));
      if (!known.length) {
        if (!dry) await db.from('opportunities').update({ link_checked_at: new Date().toISOString() }).eq('id', r.id);
        continue;
      }
      const dead = known.every((x) => GONE.has(x.status as number));
      const fails = dead ? r.link_fail_count + 1 : 0;
      if (dead) gone++;
      const archive = fails >= 2;
      if (archive) removed++;
      if (dry) {
        if (dead) console.log(`${archive ? 'RETIRÉE' : 'introuvable (1re fois)'} : ${r.title} — ${r.opportunity_links[0].url}`);
        continue;
      }
      await db.from('opportunities').update({
        link_checked_at: new Date().toISOString(),
        link_fail_count: fails,
        ...(archive ? { status: 'archivee' } : {}),
      }).eq('id', r.id);
      if (archive) console.log(`Retirée (page d'origine disparue) : ${r.title}`);
    }
  }));
  console.log(`Liens : ${checked} offre(s) vérifiée(s), ${gone} page(s) introuvable(s), ${removed} offre(s) retirée(s).`);
}

main().catch((e) => console.log('Liens : vérification impossible', e?.message ?? e));
