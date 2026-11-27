import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';
import { config } from '../config.ts';
import { politeFetch } from '../http.ts';
import { parseDate } from '../enrich.ts';
import { countryAtSlugEnd } from '../countries.ts';
import type { Collector, FoundOffer } from '../types.ts';
import { RULES } from './webpage.ts';

// Flux RSS ou Atom : la méthode la plus simple et la plus légère pour les sites.
export const rss: Collector = async (source, ctx) => {
  if (!source.feed_url) throw new Error('Adresse du flux RSS manquante');
  const rule = RULES[new URL(source.feed_url).host];
  // Flux WordPress : pages suivantes par &paged=N, tant qu'elles apportent du neuf.
  const pages = Math.min(rule?.pages ?? 1, config.maxListPages);
  const offers: FoundOffer[] = [];
  for (let page = 1; page <= pages; page++) {
    const url = new URL(source.feed_url);
    if (page > 1) url.searchParams.set('paged', String(page));
    // La recherche WordPress de Jobrapide répond lentement (≈ 20 s) : délai élargi.
    const xml = await (await politeFetch(url.toString(), { signal: AbortSignal.timeout(60_000) })).text();
    const doc = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const items: any[] = [doc?.rss?.channel?.item ?? doc?.feed?.entry ?? []].flat();
    const batch: FoundOffer[] = items.map((i) => ({
      url: typeof i.link === 'string' ? i.link : i.link?.['@_href'] ?? i.guid,
      // cheerio décode les entités HTML du titre (&#8217; → ’).
      title: cheerio.load(String(i.title?.['#text'] ?? i.title ?? '')).text().trim().replace(rule?.titlePrefix ?? /^$/, '').trim(),
      published_at: parseDate(String(i.pubDate ?? i.published ?? i.updated ?? '')),
      text: cheerio.load(String(i['content:encoded'] ?? i.description ?? i.summary ?? i.content ?? '')).text(),
    })).filter((o) => o.url && o.title);
    offers.push(...batch);
    if (batch.length === 0 || batch.every((o) => ctx.isKnown(o.url))) break;
  }
  // Flux tous pays (Jobrapide) : le pays termine l'adresse, on garde celui de la source.
  const kept = rule?.slugCountry && source.country_code
    ? offers.filter((o) => countryAtSlugEnd(o.url) === source.country_code)
    : offers;
  ctx.log(`${source.name} : ${offers.length} éléments dans le flux, ${kept.length} gardés`);
  return kept;
};
