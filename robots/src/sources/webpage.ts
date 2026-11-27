import * as cheerio from 'cheerio';
import { config } from '../config.ts';
import { RobotsDisallowed, politeFetch } from '../http.ts';
import { findDeadline, norm, parseDate, webUrl } from '../enrich.ts';
import { countryCode, countryFromSlug } from '../countries.ts';
import { titleDeadline } from './wordpress.ts';
import type { Collector, ContractType, FoundOffer } from '../types.ts';

// Lecture de pages web, quand le site n'a ni API ni flux RSS :
// 1. on ouvre la page qui liste les offres et on repère les liens d'offres ;
// 2. on ouvre seulement les offres jamais vues (au plus MAX_DETAIL_PAGES par passage) ;
// 3. on lit d'abord les données structurées « JobPosting » (faites pour Google),
//    sinon le titre de la page et quelques indices dans le texte.

export interface SiteRule {
  offerLink: RegExp;       // à quoi ressemble l'adresse d'une offre
  organization?: string;   // sélecteur CSS du nom de l'employeur, si connu
  orgFromTitle?: boolean;   // déduire l'employeur du titre de l'onglet « Poste | Employeur | Site »
  ignore?: RegExp;         // liens à ne jamais suivre
  childSitemap?: RegExp;   // dans un index de sitemaps, ne garder que ceux-ci
  countryFromPath?: boolean; // lire le pays dans l'adresse (…/opportunite/<pays>/…)
  tenderType?: boolean;    // lire le type de passation (cotation / appel d'offres / AMI) dans la page
  fixedOrg?: string;       // employeur fixe (page carrière d'une seule entreprise, ex. une banque)
  fixedSite?: string;      // site de cet employeur fixe (pour son logo)
  titlePrefix?: RegExp;    // début de titre à retirer (nom du site, ex. « Senjob.com - »)
  siteOrg?: RegExp;        // « employeur » qui n'est que le nom du site : on l'ignore
  pages?: number;          // lire aussi les pages 2, 3… de la liste (?page=N), jusqu'à ce nombre
  slugCountry?: boolean;   // le pays est écrit à la fin de l'adresse : ne garder que celui de la source
  titleDeadline?: boolean; // la date limite termine le titre (« Chauffeur-10/11/2026 ») : on la lit et on la retire
  maxDetail?: number;      // au plus ce nombre de fiches lues par passage (site qui coupe vite les visites)
  mayBeEmpty?: boolean;    // une liste vide est normale (petit pays : parfois aucun poste ouvert)
  titleOrg?: RegExp;       // l'employeur termine le titre (« Comptable par COSEF ») : on le lit et on le retire
}

// Pages de marchés publics (SangoBids…) : le type est écrit dans la page, champ
// « Type de passation ». On le range dans nos catégories. Sans indice → undefined
// (la catégorie par défaut de la source s'applique).
function tenderCategory(text: string): string | undefined {
  const t = norm(text);
  if (/(manifestation|avis a manifestation|ami\b|interet)/.test(t)) return 'manifestation-interet';
  if (/(cotation|demande de prix|demande de devis|consultation|comparaison)/.test(t)) return 'cotation';
  if (/(appel d.?offres|appel a proposition|proposition|offres)/.test(t)) return 'appel-offres';
  return undefined;
}

// Pays lu dans l'adresse d'une offre, quand la page elle-même ne le dit pas :
// …/opportunite/<pays>/… → code à 2 lettres. « afrique »/inconnu → undefined
// (l'offre sera rangée en « Toute l'Afrique »).
function countryInPath(url: string): string | undefined {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean);
    const i = seg.indexOf('opportunite');
    return i >= 0 && seg[i + 1] ? countryFromSlug(seg[i + 1]) : undefined;
  } catch {
    return undefined;
  }
}

// Règles par site. À ajuster après le premier passage d'essai.
export const RULES: Record<string, SiteRule> = {
  // Liste paginée par ?page=N (environ 20 offres par page, 5 pages pour le Mali).
  'africarrieres.com': { pages: 5, offerLink: /\/[a-z]{2}\/emplois\/[a-z0-9-]+\/?$/, ignore: /\/emplois\/(comparer|recherche|alertes?|favoris)\/?$/ },
  'www.unjobnet.org': { pages: 2, offerLink: /\/jobs\/detail\/[a-z0-9-]+$/, ignore: /\/(jd|go|salaryscale)\// },
  // Liste non triée par date et pleine d'offres expirées : on se limite à 3 pages.
  'www.goafricaonline.com': { pages: 3, offerLink: /\/[a-z]{2}\/emploi\/job-\d+[a-z0-9-]*$/ },
  'www.malipages.com': { offerLink: /^\/emplois\/[a-z0-9-]+\/?$/, orgFromTitle: true, childSitemap: /job_listing-sitemap/ },
  // Côte d'Ivoire : educarriere.ci, 1er site d'emploi du pays (offres rendues côté serveur).
  'emploi.educarriere.ci': { offerLink: /^\/offre-\d+-[a-z0-9-]+\.html$/, siteOrg: /^educarriere/i },
  // Sénégal : senjob.com. robots.txt n'interdit que les CV et les pages d'employeurs.
  'senjob.com': { offerLink: /^\/sn\/jobseekers\/[^/]+_e_\d+\.html$/, titlePrefix: /^senjob\.com\s*[-–|:]\s*/i },
  // Mali : ikabara.com (emplois, stages, appels d'offres). robots.txt ouvert.
  // Adresse d'une offre : /offers/<titre>-<identifiant numérique>.
  // Titres en majuscules précédés d'émojis et d'une étiquette (« 🚨 OFFRE D'EMPLOI : »,
  // « IKABARA : ») : on retire l'étiquette ; les émojis sont retirés pour tous les sites.
  'ikabara.com': {
    offerLink: /^\/offers\/[a-z0-9-]+-\d{6,}$/,
    titlePrefix: /^(ikabara|offres? d.emploi( au mali)?|avis de recrutement|appel d.offres?)\s*:\s*/i,
  },
  // UN Vacancies : postes des Nations unies, page « lieu : Mali ». robots.txt
  // n'interdit que /admin et /api. Adresse : /jobs/<titre>-<code agence>-<n°>.
  // Petits pays (Burkina…) : il arrive qu'aucun poste ONU ne soit ouvert, ce n'est pas une panne.
  'unvacancies.org': { offerLink: /^\/jobs\/[a-z0-9-]+-[A-Z]{1,3}-\d+$/, mayBeEmpty: true },
  'mlemploi.com': { offerLink: /^\/annonce-details-\d+\.html$/, organization: '.company, .recruteur, .organisation' },
  // Agrégateur panafricain francophone. Offres dans un type « opportunite » absent
  // de l'API REST → lecture via le plan du site (sitemap). Adresse d'une offre :
  // /opportunite/<pays>/<type>/<domaine>/<titre>/. Le pays est lu dans l'adresse ;
  // on ne garde que les sous-sitemaps d'offres les plus récents.
  'www.lesopportunites.com': {
    offerLink: /^\/opportunite\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+\/?$/,
    childSitemap: /\/opportunite-sitemap\d*\.xml$/,
    countryFromPath: true,
  },
  // Plateforme malienne de marchés publics (appels d'offres, cotations, AMI).
  // Pages rendues côté serveur ; l'adresse d'un marché est /tenders/<id>/<titre>,
  // l'identifiant fait ≥ 20 caractères (ce qui exclut la pagination /tenders/page/N).
  // Le type exact (cotation / appel d'offres / AMI) est lu dans la page.
  'ml.sangobids.com': {
    offerLink: /^\/tenders\/[a-z0-9]{20,}\/[a-z0-9-]+\/?$/,
    tenderType: true,
    // L'acheteur (« Autorité contractante ») est un lien vers sa fiche /agencies/<nom>.
    organization: 'a[href^="/agencies/"]',
  },
  // Jobrapide : grand agrégateur francophone (WordPress, robots.txt ouvert), qui
  // reprend notamment les offres que les entreprises publient sur leur propre site
  // (Orabank…) en renvoyant vers l'annonce officielle. Le plan du site est fermé
  // aux robots (403) : on lit le flux RSS de la recherche « mali » (3 pages). Le
  // pays termine l'adresse (…-bamako-mali/) : on ne garde que celui de la source.
  'www.jobrapide.org': {
    offerLink: /^\/offres\/[a-z0-9-]+\/[a-z0-9-]+\/?$/,
    pages: 3,
    slugCountry: true,
    titlePrefix: /^avis de recrutement\s*:\s*/i,
  },
  // Togo : emploitogo.info (API WordPress). La date limite termine le titre
  // (« Un chauffeur-10/11/2026 ») ; le site publie aussi quelques offres d'autres
  // pays, signalées entre parenthèses (« (Gabon) ») : on les écarte.
  'www.emploitogo.info': { offerLink: /^\/[a-z0-9-]+\/?$/, titleDeadline: true },
  // Mali : emploi365.com (emploi365.ml renvoie vers l'accueil de ce site).
  // Fiches avec données JobPosting ; liste paginée par ?page=N. Beaucoup
  // d'annonces portent l'employeur « Entreprise divers » : ce n'en est pas un.
  'emploi365.com': {
    offerLink: /^\/offres\/[a-z0-9-]+$/,
    pages: 3,
    siteOrg: /^(entreprise divers|emploi365)$/i,
  },
  // Coris Bank International Mali (WordPress). Les recrutements sont publiés en
  // actualités, à des adresses /recrutement-<poste>/. On ne suit que ces
  // adresses (les autres actualités ne sont pas des offres). Employeur fixe.
  'mali.coris.bank': {
    offerLink: /^\/recrutement-[a-z0-9-]+\/?$/,
    fixedOrg: 'Coris Bank International Mali',
    fixedSite: 'https://mali.coris.bank',
  },
  // Afrique Emplois (afriqueemplois.com) : une page par pays (/ml, /sn…), offres
  // à l'adresse /<pays>/post/<n°>. robots.txt ouvert (sauf /api, comptes), pause 1 s.
  // Le site coupe la connexion après une quarantaine de pages lues d'affilée :
  // au plus 6 fiches par pays et par passage (les suivantes viennent au passage d'après).
  'afriqueemplois.com': { offerLink: /^\/([a-z]{2}\/)?post\/\d+\/?$/, maxDetail: 6 },
  // Simoon (simoon-cv.com) : offres par pays (/emplois/pays/<pays>), adresse
  // /emplois/offre/<titre>-<identifiant>. robots.txt n'interdit que comptes, CV et /api.
  // Le site reprend aussi des annonces d'autres sites : employeur parfois absent
  // (« Recruteur confidentiel ») mais écrit en fin de titre (« … par COSEF »),
  // date limite parfois en fin de titre (« …-19/11/2026 »).
  'simoon-cv.com': {
    pages: 2,
    offerLink: /^\/emplois\/offre\/[a-z0-9-]+$/,
    siteOrg: /^(recruteur confidentiel|confidential|confidentiel|simoon.*)$/i,
    titleOrg: /\s+par\s+([A-Z][^,()]{1,60})$/,
    titleDeadline: true,
  },
  // Portail officiel du gouvernement du Bénin : rubrique « Opportunités »
  // (recrutements publics, marchés publics). Adresse /opportunite/<n°>/<titre>/.
  'www.gouv.bj': { offerLink: /^\/(opportunite|marche-public|marches-publics)\/\d+\/[a-z0-9-]+\/?$/ },
  // BCEAO : appels d'offres de la Banque centrale (8 pays de l'UEMOA).
  'www.bceao.int': {
    offerLink: /^\/fr\/appels-offres\/[a-z0-9-]+$/,
    ignore: /\/appels-offres\/(appels-offres-marches|marche-mon)/,
    fixedOrg: 'BCEAO', fixedSite: 'https://www.bceao.int',
  },
};

// SangoBids a la même plateforme pour d'autres pays (sn., ci., bf., gn., ne., bj.) :
// même règle que pour le Mali. (Pas de version Togo : tg. renvoie vers le Cameroun.)
for (const cc of ['sn', 'ci', 'bf', 'gn', 'ne', 'bj']) RULES[`${cc}.sangobids.com`] = RULES['ml.sangobids.com'];

// « Temps plein » ne dit pas si c'est un CDI ou un CDD : dans ce cas on laisse le texte décider.
const EMPLOYMENT: Record<string, ContractType> = {
  PART_TIME: 'temps_partiel', CONTRACTOR: 'consultance', TEMPORARY: 'cdd',
  INTERN: 'stage', VOLUNTEER: 'volontariat',
};

const clean = (s?: string) => s?.replace(/\s+/g, ' ').trim() || undefined;

function jobPostingFrom($: cheerio.CheerioAPI): Record<string, any> | undefined {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : data['@graph'] ?? [data];
      const job = items.find((i: any) => [i?.['@type']].flat().includes('JobPosting'));
      if (job) return job;
    } catch { /* bloc illisible : on passe au suivant */ }
  }
  return undefined;
}

export function parseOfferPage(html: string, url: string, rule?: SiteRule): FoundOffer | undefined {
  const offer = readOfferPage(html, url, rule);
  if (!offer) return undefined;
  offer.title = offer.title.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  if (rule?.titlePrefix) offer.title = offer.title.replace(rule.titlePrefix, '').trim();
  if (rule?.siteOrg && offer.organization_name && rule.siteOrg.test(offer.organization_name)) {
    // Le « recruteur » est en fait le site lui-même : son logo n'est pas celui de l'employeur.
    offer.organization_name = offer.organization_website = offer.organization_logo = undefined;
  }
  // Morceaux de phrase pris pour un employeur ou une ville (« s – Inscription »,
  // « de la formation ») : un vrai nom commence par une majuscule ou un chiffre.
  if (offer.organization_name && !/^[\p{Lu}\d]/u.test(offer.organization_name)) offer.organization_name = offer.organization_logo = offer.organization_website = undefined;
  if (offer.city && (!/^[\p{Lu}]/u.test(offer.city) || offer.city.length > 40 || /[:(]/.test(offer.city))) offer.city = undefined;
  const byOrg = rule?.titleOrg ? offer.title.match(rule.titleOrg) : null;
  if (byOrg) {
    offer.title = offer.title.replace(byOrg[0], '').trim();
    if (!offer.organization_name) offer.organization_name = byOrg[1].trim();
  }
  if (rule?.titleDeadline) {
    const [kept] = titleDeadline([offer], null);
    if (kept && !offer.deadline_at) return kept;
    if (kept) return { ...kept, deadline_at: offer.deadline_at };
  }
  return offer;
}

function readOfferPage(html: string, url: string, rule?: SiteRule): FoundOffer | undefined {
  const $ = cheerio.load(html);
  const job = jobPostingFrom($);
  $('script, style, nav, header, footer, noscript, form').remove();
  const pageText = clean($('main').text() || $('article').text() || $('body').text()) ?? '';
  const countryFromUrl = rule?.countryFromPath ? countryInPath(url) : undefined;

  if (job) {
    const place = [job.jobLocation].flat()[0]?.address ?? {};
    const descText = clean(cheerio.load(String(job.description ?? '')).text()) ?? '';
    const employment = [job.employmentType].flat()[0];
    // Certains sites (UN Vacancies) marquent « VOLUNTEER » des postes du PNUD qui n'en
    // sont pas : on ne croit ce type que si l'annonce parle vraiment de volontariat.
    let contract = employment ? EMPLOYMENT[String(employment).toUpperCase()] : undefined;
    if (contract === 'volontariat' && !/volunt|volontai/i.test(`${job.title ?? ''} ${descText}`)) contract = undefined;
    return {
      url,
      title: clean(job.title) ?? clean($('h1').first().text()) ?? '',
      organization_name: clean(job.hiringOrganization?.name) ?? rule?.fixedOrg,
      // Logo et site de l'employeur, quand la fiche les donne (données JobPosting).
      organization_logo: job.hiringOrganization?.name ? webUrl(job.hiringOrganization?.logo?.url ?? job.hiringOrganization?.logo) : undefined,
      organization_website: job.hiringOrganization?.name ? webUrl([job.hiringOrganization?.sameAs ?? job.hiringOrganization?.url].flat()[0]) : rule?.fixedSite,
      country_code: countryFromUrl,
      city: clean(place.addressLocality),
      country_hint: clean(typeof place.addressCountry === 'object' ? place.addressCountry?.name : place.addressCountry),
      published_at: job.datePosted ? parseDate(String(job.datePosted)) ?? undefined : undefined,
      deadline_at: job.validThrough ? parseDate(String(job.validThrough)) : findDeadline(descText || pageText),
      contract_type: contract,
      is_remote: job.jobLocationType === 'TELECOMMUTE' ? true : undefined,
      text: descText || pageText,
    };
  }

  const title = clean($('h1').first().text()) ?? clean($('meta[property="og:title"]').attr('content'));
  if (!title) return undefined;
  let org = rule?.organization ? clean($(rule.organization).first().text()) : undefined;
  if (!org && rule?.orgFromTitle) {
    // Titre d'onglet « Poste | Employeur | Nom du site » : on retire le nom du site
    // (dernier segment), l'employeur est alors le dernier segment restant.
    const parts = clean($('title').first().text())?.split(/\s*[|–—]\s*/).map((p) => p.trim()).filter(Boolean) ?? [];
    parts.pop();
    if (parts.length >= 2) org = parts[parts.length - 1];
  }
  return {
    url,
    title,
    organization_name: org ?? rule?.fixedOrg,
    organization_website: org ? undefined : rule?.fixedSite,
    country_code: countryFromUrl,
    category: rule?.tenderType ? tenderCategory(pageText) : undefined,
    deadline_at: findDeadline(pageText),
    text: pageText.slice(0, 8000),
  };
}

export function offerLinks(html: string, pageUrl: string, rule: SiteRule): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href]').each((_, a) => {
    try {
      const u = new URL($(a).attr('href')!, pageUrl);
      u.hash = '';
      if (u.host !== new URL(pageUrl).host) return;
      if (rule.ignore?.test(u.pathname)) return;
      if (rule.offerLink.test(u.pathname)) links.add(u.toString());
    } catch { /* lien mal formé */ }
  });
  return [...links];
}

export const webpage: Collector = async (source, ctx) => {
  const listUrl = source.feed_url ?? source.base_url;
  const host = new URL(listUrl).host;
  const rule = RULES[host];
  if (!rule) throw new Error(`Pas de règle de lecture pour ${host}`);

  const listing = await (await politeFetch(listUrl)).text();
  const links = offerLinks(listing, listUrl, rule);
  // Pages suivantes : on s'arrête dès qu'une page n'apporte aucun lien nouveau.
  const pages = Math.min(rule.pages ?? 1, config.maxListPages);
  for (let page = 2; page <= pages; page++) {
    const pageUrl = new URL(listUrl);
    pageUrl.searchParams.set('page', String(page));
    const more = offerLinks(await (await politeFetch(pageUrl.toString())).text(), listUrl, rule).filter((l) => !links.includes(l));
    if (more.length === 0) break;
    links.push(...more);
    if (more.every((l) => ctx.isKnown(l))) break;
  }
  const fresh = links.filter((l) => !ctx.isKnown(l)).slice(0, Math.min(config.maxDetailPages, rule.maxDetail ?? Infinity));
  ctx.log(`${source.name} : ${links.length} liens d'offres, ${fresh.length} nouveaux à lire`);
  if (links.length === 0 && rule.mayBeEmpty) return [];
  if (links.length === 0) throw new Error('Aucun lien d’offre trouvé : la mise en page du site a peut-être changé');

  const offers: FoundOffer[] = [];
  for (const link of fresh) {
    try {
      const offer = parseOfferPage(await (await politeFetch(link)).text(), link, rule);
      if (!offer?.title) continue;
      // Certaines pages « pays » mélangent des offres d'autres pays : on les écarte.
      const code = offer.country_hint ? countryCode(offer.country_hint) : undefined;
      if (source.country_code && offer.country_hint && code !== source.country_code) {
        ctx.log(`  autre pays (${offer.country_hint}) : ${link}`);
        await ctx.skip?.(link);
        continue;
      }
      offers.push(offer);
    } catch (e) {
      if (e instanceof RobotsDisallowed) ctx.log(`  ignoré (robots.txt) : ${link}`);
      else ctx.log(`  erreur sur ${link} : ${(e as Error).message}`);
    }
  }
  return offers;
};
