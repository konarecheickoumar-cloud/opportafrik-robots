import { politeFetch } from '../http.ts';
import type { Collector, FoundOffer } from '../types.ts';

// API officielle des avis de passation de marchés de la Banque mondiale.
interface WbNotice {
  id: string;
  notice_type?: string;
  noticedate?: string;
  submission_deadline_date?: string;
  project_name?: string;
  bid_description?: string;
  contact_organization?: string;
  notice_lang_name?: string;
}

const CATEGORY: Array<[RegExp, string]> = [
  [/expression of interest|manifestation/i, 'manifestation-interet'],
  [/quotation|cotation/i, 'cotation'],
  [/invitation for bids|request for bids|appel d.offres|request for proposals|tender/i, 'appel-offres'],
];

// L'API filtre par NOM de pays (project_ctry_name_exact), pas par code.
const WB_COUNTRY_NAME: Record<string, string> = {
  ML: 'Mali', SN: 'Senegal', CI: "Cote d'Ivoire", BF: 'Burkina Faso', GN: 'Guinea',
  NE: 'Niger', TG: 'Togo', BJ: 'Benin', CM: 'Cameroon', TD: 'Chad', MR: 'Mauritania',
};

export const worldbank: Collector = async (source, ctx) => {
  const base = source.feed_url ?? 'https://search.worldbank.org/api/v2/procnotices';
  const params = new URLSearchParams({ format: 'json', rows: '50', srt: 'noticedate', order: 'desc', os: '0' });
  const name = source.country_code ? WB_COUNTRY_NAME[source.country_code] : undefined;
  if (name) params.set('project_ctry_name_exact', name);
  const res = await politeFetch(`${base}?${params}`);
  const json = (await res.json()) as { procnotices?: WbNotice[] };
  if (!Array.isArray(json.procnotices)) throw new Error('Réponse Banque mondiale inattendue');

  const offers: FoundOffer[] = [];
  for (const n of json.procnotices) {
    const title = n.bid_description?.trim() || n.project_name?.trim();
    if (!n.id || !title) continue;
    const type = n.notice_type ?? '';
    // Les avis d'attribution de contrat ne sont plus des opportunités.
    if (/contract award|attribution/i.test(type)) continue;
    offers.push({
      url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
      title,
      organization_name: n.contact_organization?.trim() || 'Banque mondiale (projet)',
      published_at: n.noticedate ? new Date(n.noticedate).toISOString() : undefined,
      deadline_at: n.submission_deadline_date ? new Date(n.submission_deadline_date).toISOString() : undefined,
      category: CATEGORY.find(([re]) => re.test(type))?.[1] ?? 'appel-offres',
      language: /english/i.test(n.notice_lang_name ?? '') ? 'en' : 'fr',
      text: `${type} ${n.project_name ?? ''}`,
    });
  }
  ctx.log(`Banque mondiale : ${offers.length} avis reçus`);
  return offers;
};
