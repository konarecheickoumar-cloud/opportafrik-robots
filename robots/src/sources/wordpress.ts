import { config } from '../config.ts';
import { politeFetch } from '../http.ts';
import { guessCategory, webUrl } from '../enrich.ts';
import { countryAtSlugEnd, countryCode, countryFromSlug, otherCountryInTitle } from '../countries.ts';
import { RULES } from './webpage.ts';
import type { Collector, ContractType, FoundOffer } from '../types.ts';

// Sites WordPress équipés de l'extension « WP Job Manager » (très répandue).
// Les offres sont exposées par l'API REST officielle de WordPress :
//   /wp-json/wp/v2/job-listings
// On lit ce JSON (titre, lien, date, entreprise, lieu, description) sans ouvrir
// chaque page. `feed_url` doit pointer sur cette API.

interface WpJob {
  link?: string;
  status?: string;
  date_gmt?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  class_list?: string[];
  meta?: {
    _company_name?: string;
    _company_website?: string;
    _job_location?: string;
    _remote_position?: number | string;
  };
}

// Entités HTML nommées fréquentes (apostrophes, guillemets, accents) que l'API
// renvoie parfois au lieu des entités numériques (ex. yabara.org : « D&rsquo;ETUDES »).
const NAMED: Record<string, string> = {
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…",
  ndash: "–", mdash: "—", laquo: "«", raquo: "»", deg: "°", euro: "€",
  nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">",
  eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", agrave: "à",
  acirc: "â", ccedil: "ç", iuml: "ï", icirc: "î", ocirc: "ô",
  ugrave: "ù", ucirc: "û", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
};

// L'API renvoie des entités HTML (&#8217;, &rsquo;…) : on les remet en texte lisible.
const decode = (s = ''): string =>
  s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED[name] ?? NAMED[name.toLowerCase()] ?? m)
    .replace(/&amp;/g, '&');

const stripHtml = (s = ''): string => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// « Sur site », « À distance », « Mali »… ne sont pas des villes.
const NON_CITY = /^(sur site|on[-\s]?site|à distance|a distance|remote|t[ée]l[ée]travail|mali|n\/a|-)?$/i;
const REMOTE = /distance|remote|t[ée]l[ée]travail|home.?based/i;

// L'extension marque le type de contrat dans class_list : « job-type-cdi »…
function contractFrom(classes: string[] = []): ContractType | undefined {
  const raw = classes.find((x) => x.startsWith('job-type-'))?.slice('job-type-'.length) ?? '';
  if (/cdi|duree-indeterminee|permanent/.test(raw)) return 'cdi';
  if (/cdd|duree-determinee|fixed/.test(raw)) return 'cdd';
  if (/stage|intern/.test(raw)) return 'stage';
  if (/partiel|part-?time/.test(raw)) return 'temps_partiel';
  if (/freelance|independ/.test(raw)) return 'freelance';
  if (/benevol|volontar|volunteer/.test(raw)) return 'volontariat';
  if (/consultan/.test(raw)) return 'consultance';
  return undefined;
}

// Articles WordPress ordinaires (/wp-json/wp/v2/posts), pour les sites qui
// publient concours, avis et communiqués sous forme d'articles (pas d'offres
// « WP Job Manager »). La catégorie est devinée ensuite à partir du titre.
interface WpPost {
  link?: string;
  status?: string;
  date_gmt?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
}

export function parseWpPosts(data: unknown): FoundOffer[] {
  if (!Array.isArray(data)) throw new Error('Réponse WordPress inattendue (pas une liste JSON)');
  const offers: FoundOffer[] = [];
  for (const p of data as WpPost[]) {
    if (p.status && p.status !== 'publish') continue;
    const link = p.link;
    const title = decode(p.title?.rendered ?? '').trim();
    // « Hello world! » : article d'exemple laissé par WordPress, pas une offre.
    if (!link || !title || /^hello world!?$/i.test(title)) continue;
    offers.push({
      url: link,
      title,
      published_at: p.date_gmt ? `${p.date_gmt}Z` : undefined,
      text: stripHtml(`${p.content?.rendered ?? ''} ${p.excerpt?.rendered ?? ''}`),
    });
  }
  return offers;
}

// Transforme un lot de résultats JSON en offres.
export function parseWpJobs(data: unknown): FoundOffer[] {
  if (!Array.isArray(data)) throw new Error('Réponse WordPress inattendue (pas une liste JSON)');
  const offers: FoundOffer[] = [];
  for (const j of data as WpJob[]) {
    if (j.status && j.status !== 'publish') continue;
    const link = j.link;
    const title = decode(j.title?.rendered ?? '').trim();
    if (!link || !title) continue;
    const loc = (j.meta?._job_location ?? '').trim();
    const remote = REMOTE.test(loc) || Number(j.meta?._remote_position) === 1;
    offers.push({
      url: link,
      title,
      organization_name: decode(j.meta?._company_name ?? '').trim() || undefined,
      organization_website: webUrl(j.meta?._company_website),
      city: NON_CITY.test(loc) ? undefined : loc,
      is_remote: remote || undefined,
      published_at: j.date_gmt ? `${j.date_gmt}Z` : undefined,
      contract_type: contractFrom(j.class_list),
      text: stripHtml(j.content?.rendered),
    });
  }
  return offers;
}

export const wordpressJobs: Collector = async (source, ctx) => {
  const base = source.feed_url ?? `${new URL(source.base_url).origin}/wp-json/wp/v2/job-listings`;
  const posts = /\/wp\/v2\/posts/.test(base);
  const sep = base.includes('?') ? '&' : '?';
  const fields = posts ? 'link,status,date_gmt,title,content,excerpt' : 'link,status,date_gmt,title,content,class_list,meta';
  // Plusieurs pages de 50 : on continue tant que la page apporte des offres
  // jamais vues (au plus maxListPages pages, et pas au-delà de la dernière).
  const offers: FoundOffer[] = [];
  let pages = 0;
  for (let page = 1; page <= config.maxListPages; page++) {
    const url = `${base}${sep}per_page=50&page=${page}&orderby=date&order=desc&_fields=${fields}`;
    let res: Response;
    try {
      res = await politeFetch(url, { headers: { Accept: 'application/json' } });
    } catch (e) {
      // Page suivante refusée (ex. pare-feu qui limite les lectures rapprochées) :
      // on garde ce qui a déjà été lu ; les pages suivantes seront lues au prochain passage.
      if (page === 1) throw e;
      ctx.log(`${source.name} : page ${page} non lue (${(e as Error).message.slice(0, 60)})`);
      break;
    }
    const batch = posts ? parseWpPosts(await res.json()) : parseWpJobs(await res.json());
    offers.push(...batch);
    pages = page;
    const total = Number(res.headers.get('x-wp-totalpages') ?? 1);
    // Les offres expirées ne sont jamais enregistrées (donc jamais « connues ») :
    // on s'arrête aussi quand la page atteint des annonces de plus de 45 jours.
    const oldest = batch.at(-1)?.published_at;
    const tooOld = oldest !== undefined && Date.now() - Date.parse(oldest) > 45 * 86400_000;
    if (batch.length === 0 || page >= total || tooOld || batch.every((o) => ctx.isKnown(o.url))) break;
  }
  ctx.log(`${source.name} : ${offers.length} ${posts ? 'articles' : 'offres'} reçus sur ${pages} page(s) (API WordPress)`);
  const rule = RULES[new URL(base).host];
  if (rule?.titleDeadline) return titleDeadline(offers, source.country_code);
  if (!rule?.slugCountry) return offers;
  const kept = keepBySlugCountry(offers, source.country_code, source.default_category);
  ctx.log(`${source.name} : ${kept.length} gardés (pays lu à la fin de l'adresse)`);
  return kept;
};

// Les 8 pays couverts par le site (phases 1 et 2).
export const WEST_AFRICA = new Set(['ML', 'SN', 'CI', 'BF', 'GN', 'NE', 'TG', 'BJ']);
// Rubriques ouvertes à tous les pays (bourses, formations en ligne) : une annonce
// sans pays dans l'adresse est gardée et rangée dans « Toute l'Afrique ».
const OPEN_TO_ALL = new Set(['bourse', 'formation']);

// Jobrapide range chaque annonce dans une rubrique écrite dans l'adresse :
// /offres/<rubrique>/<titre>-<ville>-<pays>/ → notre catégorie.
const PATH_CATEGORY: Record<string, string> = {
  'bourses-etude': 'bourse', formations: 'formation', concours: 'concours',
  stage: 'stage', volontaire: 'volontariat', 'avis-appel-offres': 'appel-offres',
};

function categoryInPath(o: FoundOffer): string | undefined {
  let seg: string | undefined;
  try { seg = new URL(o.url).pathname.split('/').filter(Boolean)[1]; } catch { return undefined; }
  const cat = seg ? PATH_CATEGORY[seg] : undefined;
  // Appels d'offres : le titre dit parfois mieux (cotation, manifestation d'intérêt).
  return cat === 'appel-offres' ? guessCategory(o.title, '', 'appel-offres') : cat;
}

// Agrégateur tous pays (Jobrapide) : le pays termine l'adresse (…-dakar-senegal/).
// Source d'un pays → on ne garde que ce pays. Source multi-pays → on garde les
// 8 pays du site, chaque offre dans son pays et dans la rubrique lue dans l'adresse ;
// les bourses et formations sans pays (ouvertes à tous) vont dans « Toute l'Afrique ».
export function keepBySlugCountry(offers: FoundOffer[], country: string | null, category: string | null): FoundOffer[] {
  return offers.flatMap((o) => {
    const c = countryAtSlugEnd(o.url);
    if (country) return c === country ? [o] : [];
    const cat = categoryInPath(o);
    const found = cat ? { ...o, category: cat } : o;
    if (c) return WEST_AFRICA.has(c) ? [{ ...found, country_code: c }] : [];
    const open = cat ?? category;
    return open && OPEN_TO_ALL.has(open) ? [{ ...found, country_code: null }] : [];
  });
}

// « Un chauffeur-10/11/2026 (02 postes) » → titre « Un chauffeur (02 postes) »,
// date limite 10/11/2026. Une offre marquée « (Gabon) », ou qui cite un autre pays
// dans son titre (« … Somalie 2026 »), est écartée.
export function titleDeadline(offers: FoundOffer[], country: string | null): FoundOffer[] {
  return offers.flatMap((o) => {
    const other = [...o.title.matchAll(/\(([^)]+)\)/g)].map((m) => countryCode(m[1]) ?? countryFromSlug(m[1])).find((c) => c && c !== country);
    if (other || (country && otherCountryInTitle(o.title, country))) return [];
    const m = o.title.match(/\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (!m) return [o];
    const [, d, mo, y] = m;
    return [{
      ...o,
      title: o.title.replace(m[0], '').replace(/\s+/g, ' ').trim(),
      deadline_at: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T23:59:00Z`,
    }];
  });
}
