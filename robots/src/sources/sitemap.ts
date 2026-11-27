import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.ts';
import { RobotsDisallowed, politeFetch } from '../http.ts';
import { countryCode } from '../countries.ts';
import type { Collector, FoundOffer } from '../types.ts';
import { RULES, parseOfferPage } from './webpage.ts';

// Pour les sites sans API lisible mais qui publient un « sitemap » (plan du site
// au format XML, prévu pour Google). On y lit la liste des offres et leur date de
// mise à jour, puis on ouvre seulement les offres récentes jamais vues.

const parser = new XMLParser({ ignoreAttributes: true });
const asArray = <T>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

interface Entry { loc: string; lastmod?: string }

function entriesFrom(xml: string, key: 'sitemap' | 'url'): Entry[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const root = key === 'sitemap' ? doc.sitemapindex : doc.urlset;
  return asArray<Record<string, any>>(root?.[key])
    .map((e) => ({ loc: String(e.loc ?? '').trim(), lastmod: e.lastmod ? String(e.lastmod) : undefined }))
    .filter((e) => e.loc);
}

const time = (e: Entry) => (e.lastmod ? Date.parse(e.lastmod) || 0 : 0);

export const sitemap: Collector = async (source, ctx) => {
  const start = source.feed_url ?? source.base_url;
  const host = new URL(start).host;
  const rule = RULES[host];
  if (!rule) throw new Error(`Pas de règle de lecture pour ${host}`);

  // 1. Premier fichier : soit un index (liste de sitemaps), soit déjà la liste des pages.
  const firstXml = await (await politeFetch(start)).text();
  let urlEntries = entriesFrom(firstXml, 'url');

  if (urlEntries.length === 0) {
    // C'est un index : on choisit les sous-sitemaps d'offres les plus récents.
    let children = entriesFrom(firstXml, 'sitemap');
    if (rule.childSitemap) children = children.filter((c) => rule.childSitemap!.test(c.loc));
    children.sort((a, b) => time(b) - time(a));
    for (const child of children.slice(0, 2)) {
      try {
        urlEntries.push(...entriesFrom(await (await politeFetch(child.loc)).text(), 'url'));
      } catch (e) {
        ctx.log(`  sous-sitemap ignoré (${(e as Error).message}) : ${child.loc}`);
      }
    }
  }

  // 2. On garde les adresses d'offres, récentes (< 60 jours) et jamais vues.
  const maxAge = 60 * 864e5;
  const candidates = urlEntries
    .filter((e) => {
      try { return rule.offerLink.test(new URL(e.loc).pathname); } catch { return false; }
    })
    .filter((e) => !e.lastmod || Date.now() - time(e) < maxAge)
    .filter((e) => !ctx.isKnown(e.loc))
    .sort((a, b) => time(b) - time(a))
    .slice(0, config.maxDetailPages);

  ctx.log(`${source.name} : ${urlEntries.length} adresses dans le sitemap, ${candidates.length} offres récentes à lire`);

  // 3. On ouvre chaque offre et on la lit.
  const offers: FoundOffer[] = [];
  for (const e of candidates) {
    try {
      const offer = parseOfferPage(await (await politeFetch(e.loc)).text(), e.loc, rule);
      if (!offer?.title) continue;
      const code = offer.country_hint ? countryCode(offer.country_hint) : undefined;
      if (source.country_code && offer.country_hint && code !== source.country_code) {
        ctx.log(`  autre pays (${offer.country_hint}) : ${e.loc}`);
        continue;
      }
      if (e.lastmod && !offer.published_at) offer.published_at = new Date(time(e)).toISOString();
      offers.push(offer);
    } catch (err) {
      if (err instanceof RobotsDisallowed) ctx.log(`  ignoré (robots.txt) : ${e.loc}`);
      else ctx.log(`  erreur sur ${e.loc} : ${(err as Error).message}`);
    }
  }
  return offers;
};
