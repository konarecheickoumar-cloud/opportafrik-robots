import { config } from '../config.ts';
import { ISO3 } from '../countries.ts';
import { politeFetch } from '../http.ts';
import type { Collector, FoundOffer } from '../types.ts';

// API officielle ReliefWeb (ONU / OCHA) : https://apidoc.reliefweb.int
// Il faut un « appname » demandé gratuitement à ReliefWeb.
interface RwJob {
  fields: {
    title: string;
    url_alias?: string;
    url?: string;
    source?: Array<{ name: string; shortname?: string }>;
    city?: Array<{ name: string }>;
    date?: { created?: string; closing?: string };
    type?: Array<{ name: string }>;
    body?: string;
    language?: Array<{ code: string }>;
  };
}

export const reliefweb: Collector = async (source, ctx) => {
  if (!config.reliefwebAppname) throw new Error('RELIEFWEB_APPNAME manquant : demandez un appname à ReliefWeb');
  const iso3 = source.country_code ? ISO3[source.country_code] : undefined;
  const body = {
    ...(iso3 ? { filter: { field: 'country.iso3', value: iso3 } } : {}),
    sort: ['date.created:desc'],
    limit: 50,
    fields: { include: ['title', 'url_alias', 'url', 'source.name', 'source.shortname', 'city.name', 'date.created', 'date.closing', 'type.name', 'body', 'language.code'] },
  };
  const url = `${source.feed_url ?? 'https://api.reliefweb.int/v2/jobs'}?appname=${encodeURIComponent(config.reliefwebAppname)}`;
  const res = await politeFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as { data?: RwJob[] };
  if (!Array.isArray(json.data)) throw new Error('Réponse ReliefWeb inattendue');

  const offers: FoundOffer[] = [];
  for (const { fields: f } of json.data) {
    const link = f.url_alias || f.url;
    if (!link || !f.title) continue;
    const type = f.type?.[0]?.name?.toLowerCase() ?? '';
    offers.push({
      url: link,
      title: f.title,
      organization_name: f.source?.[0]?.name,
      city: f.city?.[0]?.name,
      published_at: f.date?.created,
      deadline_at: f.date?.closing,
      contract_type: type.includes('consult') ? 'consultance' : type.includes('intern') ? 'stage' : type.includes('volunt') ? 'volontariat' : undefined,
      language: f.language?.[0]?.code === 'en' ? 'en' : 'fr',
      text: f.body ?? '',
    });
  }
  ctx.log(`ReliefWeb : ${offers.length} offres reçues`);
  return offers;
};
