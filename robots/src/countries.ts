// Codes pays à 2 lettres (notre base) et à 3 lettres (ReliefWeb).
export const ISO3: Record<string, string> = {
  ML: 'MLI', SN: 'SEN', CI: 'CIV', BF: 'BFA', GN: 'GIN', NE: 'NER', TG: 'TGO', BJ: 'BEN',
  CM: 'CMR', GA: 'GAB', CG: 'COG', CD: 'COD', TD: 'TCD', CF: 'CAF', GQ: 'GNQ', BI: 'BDI',
  RW: 'RWA', DJ: 'DJI', KM: 'COM', MG: 'MDG', MR: 'MRT', MA: 'MAR', DZ: 'DZA', TN: 'TUN',
  LY: 'LBY', EG: 'EGY', SD: 'SDN', NG: 'NGA', GH: 'GHA', KE: 'KEN', ZA: 'ZAF', ET: 'ETH',
  TZ: 'TZA', UG: 'UGA', ZM: 'ZMB', ZW: 'ZWE', MW: 'MWI', BW: 'BWA', NA: 'NAM', LS: 'LSO',
  SZ: 'SWZ', GM: 'GMB', SL: 'SLE', LR: 'LBR', MU: 'MUS', SC: 'SYC', SO: 'SOM', SS: 'SSD',
  ER: 'ERI', AO: 'AGO', MZ: 'MOZ', GW: 'GNB', CV: 'CPV', ST: 'STP',
};

// Noms de pays tels qu'ils apparaissent dans les annonces → code à 2 lettres.
// Noms en français ET en anglais (certaines sources, comme Greenhouse, écrivent en anglais).
export const COUNTRY_NAMES: Record<string, string> = {
  mali: 'ML', senegal: 'SN', "cote d'ivoire": 'CI', 'ivory coast': 'CI', 'burkina faso': 'BF',
  guinee: 'GN', guinea: 'GN', niger: 'NE', togo: 'TG', benin: 'BJ',
  somalia: 'SO', somalie: 'SO', nigeria: 'NG', ghana: 'GH', kenya: 'KE', cameroun: 'CM', cameroon: 'CM',
  'republique du mali': 'ML', 'republic of mali': 'ML',
  // Noms anglais supplémentaires (Afrique de l'Ouest + empreinte de Wave et des ONG).
  gambia: 'GM', 'the gambia': 'GM', gambie: 'GM', 'sierra leone': 'SL', 'sierra-leone': 'SL',
  liberia: 'LR', 'guinea-bissau': 'GW', 'guinea bissau': 'GW', uganda: 'UG', ouganda: 'UG',
  'democratic republic of the congo': 'CD', 'democratic republic of congo': 'CD', 'dr congo': 'CD',
  'drc': 'CD', 'rd congo': 'CD', congo: 'CG', 'republic of the congo': 'CG',
  malawi: 'MW', ethiopia: 'ET', ethiopie: 'ET', tanzania: 'TZ', tanzanie: 'TZ', rwanda: 'RW',
  'south africa': 'ZA', 'afrique du sud': 'ZA', 'cote divoire': 'CI', chad: 'TD', tchad: 'TD',
  mauritania: 'MR', mauritanie: 'MR', morocco: 'MA', maroc: 'MA',
};

// « Mali », « ML », « MLI » → ML. Inconnu → undefined.
export function countryCode(value: string): string | undefined {
  const v = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (/^[a-z]{2}$/.test(v) && ISO3[v.toUpperCase()]) return v.toUpperCase();
  if (/^[a-z]{3}$/.test(v)) return Object.keys(ISO3).find((k) => ISO3[k] === v.toUpperCase());
  return COUNTRY_NAMES[v];
}

// Slug de pays tel qu'il apparaît dans une adresse (ex. lesopportunites.com :
// /opportunite/<pays>/<type>/<domaine>/<titre>/) → code à 2 lettres.
// Seuls les pays présents dans la table `countries` (clé étrangère) y figurent.
// « afrique » ou un slug inconnu → undefined → l'offre est rangée en « Toute l'Afrique ».
// Les clés sont sans tiret ni accent : la recherche enlève tirets et accents, donc
// « rd-congo » et « rdcongo », « cote-divoire » et « cote-d-ivoire » tombent sur la même clé.
export const COUNTRY_SLUGS: Record<string, string> = {
  mali: 'ML', senegal: 'SN', cotedivoire: 'CI', burkinafaso: 'BF', guinee: 'GN',
  guineeconakry: 'GN', niger: 'NE', togo: 'TG', benin: 'BJ', cameroun: 'CM', gabon: 'GA',
  congo: 'CG', congobrazzaville: 'CG', rdcongo: 'CD', rdc: 'CD', tchad: 'TD', centrafrique: 'CF',
  guineeequatoriale: 'GQ', burundi: 'BI', rwanda: 'RW', djibouti: 'DJ', comores: 'KM',
  madagascar: 'MG', mauritanie: 'MR', maroc: 'MA', algerie: 'DZ', tunisie: 'TN', libye: 'LY',
  egypte: 'EG', soudan: 'SD', nigeria: 'NG', ghana: 'GH', kenya: 'KE', afriquedusud: 'ZA',
  ethiopie: 'ET', tanzanie: 'TZ', ouganda: 'UG', zambie: 'ZM', zimbabwe: 'ZW', malawi: 'MW',
  botswana: 'BW', namibie: 'NA', lesotho: 'LS', eswatini: 'SZ', gambie: 'GM', sierraleone: 'SL',
  liberia: 'LR', maurice: 'MU', seychelles: 'SC', somalie: 'SO', soudandusud: 'SS', erythree: 'ER',
  angola: 'AO', mozambique: 'MZ', guineebissau: 'GW', capvert: 'CV',
};

export function countryFromSlug(slug: string): string | undefined {
  const key = slug.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return COUNTRY_SLUGS[key];
}

// Pays écrit à la fin de l'adresse d'une offre (Jobrapide : …-bamako-mali/) → code.
// On essaie d'abord les noms les plus longs (« guinee-equatoriale » avant « guinee »).
export function countryAtSlugEnd(url: string): string | undefined {
  let last: string;
  try { last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''; } catch { return undefined; }
  const parts = last.split('-');
  for (let n = Math.min(4, parts.length); n >= 1; n--) {
    const code = countryFromSlug(parts.slice(-n).join('-'));
    if (code) return code;
  }
  return undefined;
}

// Autre pays cité en toutes lettres dans un titre (« Concours … Somalie 2026 ») → son code.
// Sert aux sites d'un seul pays qui republient aussi des annonces étrangères.
// « Maurice » est ignoré : c'est aussi un prénom.
export function otherCountryInTitle(title: string, country: string | null): string | undefined {
  const words = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z' -]/g, ' ').split(/[\s-]+/).filter(Boolean);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const g = words.slice(i, i + n);
      if (n === 1 && (g[0] === 'maurice' || g[0].length < 4)) continue;
      const code = COUNTRY_NAMES[g.join(' ')] ?? countryFromSlug(g.join(''));
      if (code && code !== country) {
        // « Guinée » suivi de « équatoriale » ou « Bissau » : déjà traité par le groupe plus long.
        return code;
      }
    }
  }
  return undefined;
}
