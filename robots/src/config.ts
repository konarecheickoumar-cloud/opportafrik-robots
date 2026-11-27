// Réglages lus dans les « secrets » de GitHub (ou un fichier .env en local).
// Accepte l'adresse telle qu'on la copie : avec ou sans « https:// », espaces, guillemets,
// chemin en trop, ou seulement l'identifiant du projet.
export function normalizeSupabaseUrl(raw = ''): string {
  let v = raw.trim().replace(/^["'<]+|["'>]+$/g, '').trim();
  if (!v) return '';
  if (/^[a-z0-9]{15,30}$/.test(v)) return `https://${v}.supabase.co`;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  try {
    return new URL(v).origin;
  } catch {
    return v;
  }
}

// Si SUPABASE_URL est absent ou incorrect, on retrouve l'adresse du projet à partir
// de l'adresse de connexion à la base (elle contient l'identifiant du projet).
export function supabaseUrlFrom(rawUrl = '', dbUrl = ''): string {
  const url = normalizeSupabaseUrl(rawUrl);
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return url;
  const ref = dbUrl.match(/postgres\.([a-z0-9]{15,30})[:@]/)?.[1] ?? dbUrl.match(/db\.([a-z0-9]{15,30})\.supabase\.co/)?.[1];
  return ref ? `https://${ref}.supabase.co` : url;
}

export const config = {
  supabaseUrl: supabaseUrlFrom(process.env.SUPABASE_URL, process.env.SUPABASE_DB_URL),
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  botName: process.env.BOT_NAME ?? 'OpportunitesAfriqueBot',
  botContact: process.env.BOT_CONTACT ?? '',
  // L'« appname » ReliefWeb est un simple identifiant de courtoisie, choisi librement
  // (aucune inscription n'est exigée pour lire l'API). On en met un par défaut.
  reliefwebAppname: process.env.RELIEFWEB_APPNAME || 'opportafrik.org-mali',
  // Pause minimale entre deux pages d'un même site (millisecondes).
  delayPerHostMs: Number(process.env.DELAY_PER_HOST_MS ?? 4000),
  // Nombre maximum de pages d'offres ouvertes par source et par passage.
  maxDetailPages: Number(process.env.MAX_DETAIL_PAGES ?? 25),
  // Nombre maximum de pages de liste lues par source (page 1, 2, 3…). On s'arrête
  // plus tôt dès qu'une page ne contient plus que des offres déjà connues.
  maxListPages: Number(process.env.MAX_LIST_PAGES ?? 5),
  // Temps maximum de collecte par passage (le workflow est coupé à 12 min).
  runBudgetMs: Number(process.env.RUN_BUDGET_MS ?? 9 * 60_000),
  // Nombre de sites différents visités en même temps.
  parallelSites: Number(process.env.PARALLEL_SITES ?? 4),
};

export function userAgent(): string {
  const contact = config.botContact ? `; ${config.botContact}` : '';
  return `${config.botName}/1.0 (collecte d'offres, résumé et lien vers l'original${contact})`;
}
