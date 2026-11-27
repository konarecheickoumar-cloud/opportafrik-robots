import * as cheerio from 'cheerio';
import { countryCode } from '../countries.ts';
import { politeFetch } from '../http.ts';
import type { Collector, FoundOffer } from '../types.ts';

// API publique Greenhouse (outil de recrutement). De nombreuses entreprises
// (dont Wave) y publient leurs offres. Le tableau d'offres est exposé sans clé :
//   https://boards-api.greenhouse.io/v1/boards/<token>/jobs?content=true
// Chaque offre donne un titre, un lieu, une adresse publique, la date de mise à
// jour et le descriptif (HTML échappé). Le descriptif ne sert qu'à classer et
// résumer l'offre : il n'est jamais enregistré tel quel.

interface GhJob {
  id: number;
  title: string;
  updated_at?: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
}

// Décode les entités HTML courantes puis retire les balises, pour obtenir le
// texte lisible du descriptif (Greenhouse renvoie le HTML échappé dans le JSON).
function textFromContent(content = ''): string {
  const decoded = content
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return cheerio.load(decoded).text().replace(/\s+/g, ' ').trim();
}

// « Bamako, Mali » → ML ; « Freetown, Sierra Leone » → SL ; « Cameroon » → CM.
// Lieu hors Afrique ou « Remote »/« Multiple Locations » → undefined → Toute l'Afrique.
export function countryFromLocation(name = ''): string | undefined {
  const segs = name.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const code = countryCode(segs[i]);
    if (code) return code;
  }
  return undefined;
}

// Ville = premier segment du lieu, sauf s'il désigne déjà un pays (« Cameroon »
// seul n'est pas une ville). « Bamako, Mali » → « Bamako » ; « Malawi » → aucune.
export function cityFromLocation(name = ''): string | undefined {
  const segs = name.split(',').map((s) => s.trim()).filter(Boolean);
  if (segs.length < 2 || countryCode(segs[0])) return undefined;
  return segs[0];
}

export const greenhouse: Collector = async (source, ctx) => {
  const base = source.feed_url ?? source.base_url;
  const url = base.includes('content=true') ? base : `${base}${base.includes('?') ? '&' : '?'}content=true`;

  // Un tableau Greenhouse = une entreprise. On lit son nom une fois pour le
  // donner comme employeur à toutes ses offres (et les rendre cherchables).
  let org: string | undefined;
  try {
    const boardUrl = url.replace(/\/jobs\b.*$/, '');
    const meta = (await (await politeFetch(boardUrl)).json()) as { name?: string };
    org = meta.name?.trim() || undefined;
  } catch { /* nom d'entreprise indisponible : on continue sans */ }

  const res = await politeFetch(url);
  const json = (await res.json()) as { jobs?: GhJob[] };
  if (!Array.isArray(json.jobs)) throw new Error('Réponse Greenhouse inattendue (pas de tableau « jobs »)');

  const offers: FoundOffer[] = [];
  for (const j of json.jobs) {
    if (!j.title || !j.absolute_url) continue;
    const country = countryFromLocation(j.location?.name);
    // Si la source cible un pays précis, on écarte les offres des autres pays.
    if (source.country_code && country && country !== source.country_code) continue;
    offers.push({
      url: j.absolute_url,
      title: j.title,
      organization_name: org,
      country_code: country,
      city: cityFromLocation(j.location?.name),
      published_at: j.updated_at,
      text: textFromContent(j.content),
    });
  }
  ctx.log(`${source.name} : ${json.jobs.length} offres reçues, ${offers.length} retenues`);
  return offers;
};
