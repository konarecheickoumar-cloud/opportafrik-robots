import { createClient } from '@supabase/supabase-js';
import { config } from './config.ts';

// IndexNow : après chaque passage des robots, on prévient Bing (et Yandex, Seznam,
// Naver…) des nouvelles offres. Bing alimente aussi la recherche de ChatGPT et de
// Copilot. Gratuit, sans compte : la clé ci-dessous est publiée sur le site
// (web/public/<clé>.txt) pour prouver que le site nous appartient.
//   npm run indexnow            → offres ajoutées ces 3 dernières heures
//   npm run indexnow -- --tout  → toutes les pages du plan du site (une seule fois)

const KEY = '25e241ed28f39b9f6445ebac1231ead8';
const SITE = 'https://www.opportafrik.com';
const HOURS = 3;

type Row = { slug: string; country_slug: string | null; created_at: string };

async function main() {
  const all = process.argv.includes('--tout');
  let urls: string[];
  if (all) {
    const xml = await (await fetch(`${SITE}/sitemap.xml`)).text();
    urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  } else {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      console.log('IndexNow : pas de base (mode essai), rien à envoyer.');
      return;
    }
    const db = createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('sitemap_offers');
    if (error) throw error;
    const since = Date.now() - HOURS * 3600_000;
    urls = (data as Row[])
      .filter((o) => Date.parse(o.created_at) >= since)
      .map((o) => `${SITE}/${o.country_slug ?? 'afrique'}/offre/${o.slug}`);
  }
  urls = [...new Set(urls)].slice(0, 10_000);
  if (!urls.length) {
    console.log('IndexNow : aucune nouvelle page.');
    return;
  }
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: 'www.opportafrik.com', key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList: urls }),
  });
  // 200 ou 202 = reçu. Une erreur ici ne doit pas faire échouer les robots.
  console.log(`IndexNow : ${urls.length} adresse(s) envoyée(s), réponse ${res.status} ${await res.text().catch(() => '')}`.trim());
}

main().catch((e) => console.log('IndexNow : envoi impossible', e?.message ?? e));
