import type { ContractType, FoundOffer, ReadyOffer, Source } from './types.ts';
// Même mise en forme des titres que sur le site (minuscules, accents, sigles, « (H/F) »).
import { posteSeul, tidyTitle } from '../../web/lib/titre.ts';

export const norm = (s = '') =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Adresse web valable (http/https), sinon rien.
export const webUrl = (v?: unknown): string | undefined =>
  typeof v === 'string' && /^https?:\/\/[^\s"<>]+$/i.test(v.trim()) ? v.trim() : undefined;

// ---------------------------------------------------------------------
// Employeur lu dans le titre : beaucoup d'annonces (Y'a bara, Maliavis…)
// s'intitulent « Sanova recrute un comptable » sans donner l'employeur à part.
// On garde le nom avant « recrute » s'il ressemble à un nom (pas « Une ONG »).
// ---------------------------------------------------------------------
const VAGUE_ORG = /^(une?|des|nous|on|il|elle|cette|notre|votre|cabinet|entreprise|societe|structure|organisation|ong|client|importante?|grande?|groupe|projet|recrutement|avis|offre|urgent)\b/;
export function orgFromTitle(title: string): string | undefined {
  const m = title.match(/^(?:[^:]{0,40}:\s*)?(.{2,60}?)\s+(?:recrute(?:nt)?|is hiring|is recruiting)\b/i);
  const org = m?.[1].replace(/^[«"'\s]+|[»"'\s,:–-]+$/g, '').trim();
  if (!org || org.split(/\s+/).length > 6 || VAGUE_ORG.test(norm(org)) || /\d{3,}/.test(org)) return undefined;
  return org;
}

// ---------------------------------------------------------------------
// Dates : « 06 septembre 2026 », « 6/9/2026 », « 2026-09-06 », « 9 Nov 2026 »
// ---------------------------------------------------------------------
const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8,
  septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, jun: 6, jul: 7, juil: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function iso(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d, 23, 59));
  if (date.getUTCMonth() !== m - 1 || y < 2020 || y > 2100) return undefined;
  return date.toISOString();
}

export function parseDate(raw: string): string | undefined {
  const t = norm(raw);
  let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(/(\d{1,2})(?:er)?\s+([a-z]+)\.?\s+(\d{4})/);
  if (m && MONTHS[m[2]]) return iso(+m[3], MONTHS[m[2]], +m[1]);
  m = t.match(/([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1]]) return iso(+m[3], MONTHS[m[1]], +m[2]);
  m = t.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return undefined;
}

// Cherche une date limite dans le texte de l'offre.
export function findDeadline(text = ''): string | undefined {
  const t = norm(text);
  const re = /(date limite|au plus tard le|au plus tard|avant le|cloture|deadline|closing date|closes|date de fin|date d.expiration|expiration|expire le)[^0-9a-z]{0,20}(.{0,60})/g;
  for (const m of t.matchAll(re)) {
    const d = parseDate(m[2]);
    if (d) return d;
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Classement : catégorie, contrat, télétravail
// ---------------------------------------------------------------------
export function guessCategory(title: string, text: string, fallback: string | null): string {
  const t = norm(title);
  const all = `${t} ${norm(text).slice(0, 1500)}`;
  // Avant « concours » : un « concours de l'innovation » n'est pas un concours de la fonction publique.
  if (/appels? a projets?|appels? a propositions?|call for proposals|concours (de l.?|d.?)?innovation|appel a candidatures? .*(innovation|startup|entrepreneur)/.test(t)) return 'appel-projets';
  if (/\bconcours\b|recrutement direct|fonction publique/.test(t)) return 'concours';
  if (/manifestation d.?interet|\bami\b|expression of interest|\beoi\b/.test(t)) return 'manifestation-interet';
  if (/demande de (cotation|prix|devis)|request for quotation|\brfq\b/.test(t)) return 'cotation';
  if (/appel d.?offres?|\bdao\b|avis d.?appel (d.?offres?|a la concurrence|public|ouvert|restreint|national|international)|tender|invitation for bids|\bifb\b|\brfp\b|request for proposal/.test(t)) return 'appel-offres';
  if (/\bbourses?\b|scholarship|fellowship/.test(t)) return 'bourse';
  if (/\bstages?\b|stagiaire|internship|\bintern\b/.test(t)) return 'stage';
  if (/volontaire|volontariat|volunteer|\bunv\b/.test(t)) return 'volontariat';
  if (/^((avis|offre|programme|session|cycle) (de |d.?)?)?formations?\b|training course/.test(t)) return 'formation';
  if (fallback) return fallback;
  if (/\bong\b|nations unies|united nations|unicef|pnud|undp|\bpam\b|\bwfp\b|cicr|icrc/.test(all)) return 'ong-international';
  return 'emploi';
}

export function guessContract(title: string, text: string): ContractType {
  const t = norm(`${title} ${text.slice(0, 2500)}`);
  if (/\bstage\b|stagiaire|internship/.test(t)) return 'stage';
  // Volontariat : seulement si le titre le dit (ou une mention explicite). Les postes
  // du PNUD citent les « UN Volunteers » dans leurs conditions d'éligibilité.
  if (/volontaire|volunteer/.test(norm(title)) || /mission de volontariat|volunteer assignment/.test(t)) return 'volontariat';
  if (/consultan|consultance|consultancy/.test(t)) return 'consultance';
  if (/\bcdi\b|duree indeterminee|permanent/.test(t)) return 'cdi';
  if (/\bcdd\b|duree determinee|fixed.term/.test(t)) return 'cdd';
  if (/temps partiel|part.time|mi.temps/.test(t)) return 'temps_partiel';
  if (/freelance|independant/.test(t)) return 'freelance';
  return 'non_precise';
}

export const guessRemote = (title: string, text: string) =>
  /teletravail|a distance|remote|home.based|work from home/.test(norm(`${title} ${text.slice(0, 2000)}`));

// ---------------------------------------------------------------------
// Régions du Mali (les autres pays seront ajoutés pays par pays)
// ---------------------------------------------------------------------
const PLACES: Record<string, Array<[RegExp, string, string]>> = {
  ML: [
    [/\bbamako\b/, 'bamako', 'Bamako'],
    [/\bkati\b/, 'koulikoro', 'Kati'],
    [/\bkoulikoro\b/, 'koulikoro', 'Koulikoro'],
    [/\bsikasso\b/, 'sikasso', 'Sikasso'],
    [/\bsegou\b/, 'segou', 'Ségou'],
    [/\bsevare\b/, 'mopti', 'Sévaré'],
    [/\bmopti\b/, 'mopti', 'Mopti'],
    [/\bkayes\b/, 'kayes', 'Kayes'],
    [/\btombouctou\b|\btimbuktu\b/, 'tombouctou', 'Tombouctou'],
    [/\bgao\b/, 'gao', 'Gao'],
    [/\bkidal\b/, 'kidal', 'Kidal'],
    [/\btaoudenit\b|\btaoudeni\b/, 'taoudenit', 'Taoudénit'],
    [/\bmenaka\b/, 'menaka', 'Ménaka'],
    [/\bnioro\b/, 'nioro', 'Nioro du Sahel'],
    [/\bkita\b/, 'kita', 'Kita'],
    [/\bdioila\b/, 'dioila', 'Dioïla'],
    [/\bnara\b/, 'nara', 'Nara'],
    [/\bbougouni\b/, 'bougouni', 'Bougouni'],
    [/\bkoutiala\b/, 'koutiala', 'Koutiala'],
    [/\bsan\b(?!\s*francisco)/, 'san', 'San'],
    [/\bdouentza\b/, 'douentza', 'Douentza'],
    [/\bbandiagara\b/, 'bandiagara', 'Bandiagara'],
  ],
};

export function guessPlace(country: string | null | undefined, city: string | undefined, title: string, text: string) {
  const list = country ? PLACES[country] : undefined;
  if (!list) return { city, region_slug: undefined };
  // Priorité à la ville annoncée, puis au titre, puis au début du texte.
  for (const hay of [city ?? '', title, text.slice(0, 1500)].map((s) => norm(s))) {
    for (const [re, slug, name] of list) if (re.test(hay)) return { city: city || name, region_slug: slug };
  }
  return { city, region_slug: undefined };
}

// ---------------------------------------------------------------------
// Offres suspectes : on ne publie pas, on vous les soumet.
// ---------------------------------------------------------------------
const RED_FLAGS: Array<[RegExp, number, string]> = [
  [/frais (de dossier|d.?inscription|de traitement|de formation|de visite medicale)/, 40, 'frais demandés au candidat'],
  [/(payer|verser|envoyer|transfert).{0,40}(fcfa|f cfa|xof|orange money|moov money|wave|western union)/, 50, 'paiement demandé pour postuler'],
  [/(orange money|moov money|wave|western union|moneygram)/, 20, 'mention de transfert d’argent'],
  [/(sans diplome|sans experience).{0,40}(salaire|remuneration).{0,20}\d{3}/, 20, 'promesse de salaire élevé sans condition'],
  [/(whatsapp|telegram) uniquement|contactez.{0,20}whatsapp/, 15, 'contact uniquement par messagerie'],
  [/@(gmail|yahoo|hotmail|outlook)\.[a-z]+/, 10, 'adresse e-mail personnelle'],
];

export function suspicion(title: string, text: string, category: string) {
  const t = norm(`${title} ${text}`);
  let score = 0;
  const reasons: string[] = [];
  for (const [re, pts, why] of RED_FLAGS) if (re.test(t)) { score += pts; reasons.push(why); }
  // Un concours « public » annoncé avec une adresse gmail est très souvent un faux.
  if (category === 'concours' && /@(gmail|yahoo|hotmail)\./.test(t)) { score += 30; reasons.push('concours annoncé avec une adresse non officielle'); }
  return { score: Math.min(score, 100), reasons };
}

// ---------------------------------------------------------------------
// Résumé rédigé par nous (jamais une copie du texte d'origine)
// ---------------------------------------------------------------------
const CONTRACT_FR: Record<ContractType, string> = {
  cdi: 'un contrat à durée indéterminée (CDI)', cdd: 'un contrat à durée déterminée (CDD)',
  temps_partiel: 'un poste à temps partiel', consultance: 'une mission de consultance',
  stage: 'un stage', volontariat: 'une mission de volontariat', freelance: 'une mission indépendante',
  autre: '', non_precise: '',
};
const CONTRACT_EN: Record<ContractType, string> = {
  cdi: 'a permanent contract', cdd: 'a fixed-term contract', temps_partiel: 'a part-time position',
  consultance: 'a consultancy', stage: 'an internship', volontariat: 'a volunteer assignment',
  freelance: 'a freelance assignment', autre: '', non_precise: '',
};

const fmtDate = (isoDate: string, lang: 'fr' | 'en') =>
  new Date(isoDate).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Catégories « emploi » : seules celles-là ont un employeur et un type de contrat.
// Les autres (bourse, concours, appel d'offres…) sont proposées par un organisme.
const JOB_CATEGORIES = new Set(['emploi', 'stage', 'ong-international', 'volontariat']);

export function summarize(o: { title: string; organization_name?: string; city?: string; category: string; contract_type: ContractType; deadline_at?: string; is_remote?: boolean; language?: string }): string {
  const org = o.organization_name?.trim();
  const isJob = JOB_CATEGORIES.has(o.category);
  if (o.language === 'en') {
    const who = org ?? (isJob ? 'An employer' : 'An organisation');
    const where = o.is_remote ? ' (remote)' : o.city ? ` in ${o.city}` : '';
    const first: Record<string, string> = {
      concours: `${who} announces a recruitment exam: “${o.title}”${where}.`,
      'appel-offres': `${who} has issued a tender: “${o.title}”${where}.`,
      'manifestation-interet': `${who} invites expressions of interest: “${o.title}”${where}.`,
      cotation: `${who} requests quotations: “${o.title}”${where}.`,
      bourse: `${who} offers a scholarship: “${o.title}”.`,
      formation: `${who} offers a training: “${o.title}”${where}.`,
      'appel-projets': `${who} has launched a call for projects: “${o.title}”${where}.`,
    };
    const parts = [first[o.category] ?? `${who} is hiring for the position “${posteSeul(o.title)}”${where}.`];
    if (isJob && CONTRACT_EN[o.contract_type]) parts.push(`It is ${CONTRACT_EN[o.contract_type]}.`);
    parts.push(o.deadline_at ? `Applications close on ${fmtDate(o.deadline_at, 'en')}.` : 'Check the original notice for the deadline and how to apply.');
    return parts.join(' ');
  }
  const who = org ?? (isJob ? 'Un employeur' : 'Un organisme');
  const where = o.is_remote ? ' (télétravail)' : o.city ? ` à ${o.city}` : '';
  const first: Record<string, string> = {
    concours: `${who} annonce un concours : « ${o.title} »${where}.`,
    'appel-offres': `${who} lance un appel d'offres : « ${o.title} »${where}.`,
    'manifestation-interet': `${who} lance un avis de manifestation d'intérêt : « ${o.title} »${where}.`,
    cotation: `${who} lance une demande de cotation : « ${o.title} »${where}.`,
    bourse: `${who} propose une bourse : « ${o.title} ».`,
    formation: `${who} propose une formation : « ${o.title} »${where}.`,
    'appel-projets': `${who} lance un appel à projets : « ${o.title} »${where}.`,
  };
  const parts = [first[o.category] ?? `${who} recrute pour le poste « ${posteSeul(o.title)} »${where}.`];
  if (isJob && CONTRACT_FR[o.contract_type]) parts.push(`Il s'agit d'${CONTRACT_FR[o.contract_type]}.`);
  parts.push(o.deadline_at ? `Les candidatures sont ouvertes jusqu'au ${fmtDate(o.deadline_at, 'fr')}.` : "Consultez l'offre originale pour la date limite et la marche à suivre.");
  return parts.join(' ');
}

// Une date limite à plus d'un an est presque toujours une erreur de l'annonce : on l'ignore.
function plausibleDeadline(d?: string): string | undefined {
  if (!d) return undefined;
  return new Date(d).getTime() - Date.now() > 366 * 864e5 ? undefined : d;
}

// Une offre dont la date limite est déjà passée n'intéresse plus personne.
export const isExpired = (o: { deadline_at?: string }) =>
  !!o.deadline_at && new Date(o.deadline_at).getTime() < Date.now();

// Assemble tout : ce que le robot a trouvé → ce que la base va ranger.
export function prepare(found: FoundOffer, source: Source): ReadyOffer {
  const text = found.text ?? '';
  const rawTitle = found.title.replace(/\s+/g, ' ').trim();
  // L'employeur est lu dans le titre d'origine, puis le titre est remis en forme.
  const organization_name = found.organization_name ?? orgFromTitle(rawTitle);
  const title = tidyTitle(rawTitle, organization_name);
  const country = found.country_code === undefined ? source.country_code : found.country_code;
  const category = found.category ?? guessCategory(title, text, source.default_category);
  const contract_type = found.contract_type && found.contract_type !== 'non_precise' ? found.contract_type : guessContract(title, text);
  const deadline_at = plausibleDeadline(found.deadline_at ?? findDeadline(text));
  const is_remote = found.is_remote ?? guessRemote(title, text);
  const place = guessPlace(country, found.city, title, text);
  const language = found.language ?? (/\b(the|and|for|with)\b/.test(norm(title)) ? 'en' : 'fr');
  const flags = suspicion(title, text, category);
  const { text: _text, country_hint: _hint, ...rest } = found;
  return {
    ...rest,
    organization_name,
    title,
    country_code: country,
    category,
    contract_type,
    deadline_at,
    is_remote,
    language,
    city: place.city,
    region_slug: place.region_slug,
    source_id: source.id,
    summary: summarize({ title, organization_name, city: place.city, category, contract_type, deadline_at, is_remote, language }),
    suspicion_score: flags.score,
    suspicion_reasons: flags.reasons,
  };
}
