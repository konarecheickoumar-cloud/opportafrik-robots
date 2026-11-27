import { createRequire } from 'node:module';
import { config, userAgent } from './config.ts';

interface Robots {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
}
const robotsParser = createRequire(import.meta.url)('robots-parser') as (url: string, txt: string) => Robots;

export class RobotsDisallowed extends Error {}

const robotsCache = new Map<string, Robots | null>();
const lastHit = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': userAgent(), 'Accept-Language': 'fr,en;q=0.8', ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(25_000),
    redirect: 'follow',
  });
}

// Sites dont le robots.txt n'a pas pu être lu (site lent ou en panne) : on s'abstient
// pour ce passage, mais ce n'est pas une interdiction (le message le dit).
const unreachable = new Set<string>();

async function robotsFor(origin: string) {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  let parser: Robots | null = null;
  try {
    const res = await rawFetch(`${origin}/robots.txt`);
    // Pas de robots.txt (404) = pas de restriction. Erreur serveur = on s'abstient.
    if (res.ok) parser = robotsParser(`${origin}/robots.txt`, await res.text());
    else if (res.status >= 500) { parser = robotsParser(`${origin}/robots.txt`, 'User-agent: *\nDisallow: /'); unreachable.add(origin); }
  } catch {
    parser = robotsParser(`${origin}/robots.txt`, 'User-agent: *\nDisallow: /');
    unreachable.add(origin);
  }
  robotsCache.set(origin, parser);
  return parser;
}

// « ml.sangobids.com » → « sangobids.com » : les sous-domaines d'un même site
// partagent la même limite de visites.
export const siteOf = (host: string) => host.split('.').slice(-2).join('.');

// Requête « polie » : respecte robots.txt, attend entre deux pages d'un même site,
// se présente avec un nom de robot clair.
export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { origin, host } = new URL(url);
  const robots = await robotsFor(origin);
  if (robots && robots.isAllowed(url, config.botName) === false) {
    if (unreachable.has(origin)) throw new RobotsDisallowed(`site injoignable (robots.txt illisible), réessai au prochain passage : ${url}`);
    throw new RobotsDisallowed(`robots.txt interdit ${url}`);
  }
  const crawlDelay = (robots?.getCrawlDelay(config.botName) ?? 0) * 1000;
  // Pause comptée par site (ml.sangobids.com et sn.sangobids.com = même site).
  const site = siteOf(host);
  const wait = Math.max(config.delayPerHostMs, crawlDelay) - (Date.now() - (lastHit.get(site) ?? 0));
  if (wait > 0) await sleep(wait);
  lastHit.set(site, Date.now());

  const res = await rawFetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${url}`);
  return res;
}

// Vérification d'un lien d'offre (robot « liens morts ») : même politesse que
// politeFetch, mais renvoie le code au lieu de lever une erreur.
// 'interdit' = robots.txt l'interdit ; 0 = site injoignable (on ne conclut rien).
export async function linkStatus(url: string): Promise<{ status: number | 'interdit'; finalUrl: string }> {
  try {
    const res = await politeFetch(url, { signal: AbortSignal.timeout(15_000) }).catch((e: unknown) => {
      if (e instanceof RobotsDisallowed) throw e;
      const m = /^(\d{3}) /.exec(String((e as Error)?.message ?? ''));
      if (m) return { status: Number(m[1]), url } as unknown as Response;
      throw e;
    });
    // On ne lit pas la page : seul le code compte.
    await res.body?.cancel().catch(() => {});
    return { status: res.status, finalUrl: res.url || url };
  } catch (e) {
    if (e instanceof RobotsDisallowed) return { status: 'interdit', finalUrl: url };
    return { status: 0, finalUrl: url };
  }
}
