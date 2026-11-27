import { createClient } from '@supabase/supabase-js';
import { config } from './config.ts';
import { siteOf } from './http.ts';
import { isExpired, prepare } from './enrich.ts';
import { greenhouse } from './sources/greenhouse.ts';
import { reliefweb } from './sources/reliefweb.ts';
import { rss } from './sources/rss.ts';
import { sitemap } from './sources/sitemap.ts';
import { webpage } from './sources/webpage.ts';
import { wordpressJobs } from './sources/wordpress.ts';
import { worldbank } from './sources/worldbank.ts';
import type { Collector, ReadyOffer, Source } from './types.ts';

// Lancement :
//   npm run collecte          → sources actives et « dues », résultats enregistrés dans Supabase
//   npm run essai             → toutes les sources d'essai, résultats affichés, rien n'est enregistré
//   npm run essai -- "Emploi" → seulement les sources dont le nom contient « Emploi »
//   npm run essai -- "Senjob,Educarriere" → plusieurs filtres, séparés par des virgules

const args = process.argv.slice(2);
const dryRun = args.includes('--essai') || !config.supabaseUrl;
// Plusieurs filtres possibles, séparés par des virgules : « Senjob,Educarriere ».
const only = args.find((a) => !a.startsWith('--'))?.toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);

// Titres qui ne sont pas des opportunités ouvertes : résultats, attributions de
// marché, reports, rectificatifs, communiqués, ou page d'accueil d'un site
// (« Emplois Mali - Offres d'emploi à Bamako… »).
export const NOT_AN_OFFER = /^(avis d.attribution|attribution|avis de publication des r[ée]sultats|r[ée]sultats?\b|publication des r[ée]sultats|addendum|avis de report|report\b|rectificatif|liste des (candidats|admis)|communiqu[ée]|lancement de)|^emplois [^-]{2,30} - offres d.emploi/i;

// Raccourci pour les sources d'essai ajoutées en novembre 2026 (migration 044).
const t = (name: string, country_code: string | null, base_url: string, feed_url: string, method: Source['method'], frequency_minutes: number, default_category: string | null): Source =>
  ({ id: null, name, country_code, base_url, feed_url, method, frequency_minutes, default_category, last_run_at: null });

// Mêmes sources que dans la base (migration 004), pour les essais sans base.
const TRIAL_SOURCES: Source[] = [
  { id: null, name: 'ReliefWeb (emplois Mali)', country_code: 'ML', base_url: 'https://reliefweb.int', feed_url: 'https://api.reliefweb.int/v2/jobs', method: 'api', frequency_minutes: 15, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Mali', country_code: 'ML', base_url: 'https://africarrieres.com/mali/fr', feed_url: 'https://africarrieres.com/mali/fr/emplois', method: 'html', frequency_minutes: 15, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Mali', country_code: 'ML', base_url: 'https://www.unjobnet.org/fr/emplois/mali', feed_url: 'https://www.unjobnet.org/fr/emplois/mali', method: 'html', frequency_minutes: 30, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Go Africa Online Mali', country_code: 'ML', base_url: 'https://www.goafricaonline.com/ml/emploi', feed_url: 'https://www.goafricaonline.com/ml/emploi', method: 'html', frequency_minutes: 30, default_category: null, last_run_at: null },
  { id: null, name: 'ANPE Mali', country_code: 'ML', base_url: 'https://anpe-mali.org', feed_url: 'https://anpe-mali.org/wp-json/wp/v2/job-listings', method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: 'Malipages (emplois)', country_code: 'ML', base_url: 'https://www.malipages.com', feed_url: 'https://www.malipages.com/sitemap_index.xml', method: 'sitemap', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: 'MLemploi', country_code: 'ML', base_url: 'https://mlemploi.com', feed_url: 'https://mlemploi.com/emplois-annonces.html', method: 'html', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: 'Fonction publique Mali (concours)', country_code: 'ML', base_url: 'https://fonctionpublique.gouv.ml', feed_url: 'https://fonctionpublique.gouv.ml/wp-json/wp/v2/posts?categories=6,60', method: 'api', frequency_minutes: 180, default_category: 'concours', last_run_at: null },
  // Greatyop : API fermée (410) et interdite par robots.txt depuis le 2026-10-28 (migration 030).
  // { id: null, name: 'Greatyop (bourses)', country_code: null, base_url: 'https://greatyop.com', feed_url: 'https://greatyop.com/wp-json/wp/v2/posts', method: 'api', frequency_minutes: 180, default_category: 'bourse', last_run_at: null },
  { id: null, name: 'Les Opportunités du Monde', country_code: null, base_url: 'https://www.lesopportunites.com', feed_url: 'https://www.lesopportunites.com/sitemap_index.xml', method: 'sitemap', frequency_minutes: 180, default_category: null, last_run_at: null },
  { id: null, name: "Y'a bara (Mali)", country_code: 'ML', base_url: 'https://yabara.org', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=2', method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Guinée)", country_code: 'GN', base_url: 'https://yabara.org/category/guinee/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=3', method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Côte d'Ivoire)", country_code: 'CI', base_url: 'https://yabara.org/category/c-ivoire/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=5', method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Niger)", country_code: 'NE', base_url: 'https://yabara.org/category/niger/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=4', method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Sénégal)", country_code: 'SN', base_url: 'https://yabara.org/category/senegal/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=6,33', method: 'api', frequency_minutes: 120, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Burkina Faso)", country_code: 'BF', base_url: 'https://yabara.org/category/burkina/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=25,34', method: 'api', frequency_minutes: 120, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Togo)", country_code: 'TG', base_url: 'https://yabara.org/category/togo/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=24', method: 'api', frequency_minutes: 120, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Y'a bara (Bénin)", country_code: 'BJ', base_url: 'https://yabara.org/category/benin/', feed_url: 'https://yabara.org/wp-json/wp/v2/posts?categories=32', method: 'api', frequency_minutes: 120, default_category: 'emploi', last_run_at: null },
  { id: null, name: 'Maliavis (emplois)', country_code: 'ML', base_url: 'https://maliavis.com/category/offres-demplois/', feed_url: 'https://maliavis.com/wp-json/wp/v2/posts?categories=11,7,8,1', method: 'api', frequency_minutes: 120, default_category: 'emploi', last_run_at: null },
  { id: null, name: "Maliavis (appels d'offres et AMI)", country_code: 'ML', base_url: 'https://maliavis.com/category/appels-doffres/', feed_url: 'https://maliavis.com/wp-json/wp/v2/posts?categories=3,4,5', method: 'api', frequency_minutes: 120, default_category: 'appel-offres', last_run_at: null },
  { id: null, name: 'Maliavis (appels à projets)', country_code: 'ML', base_url: 'https://maliavis.com/category/appel-aux-projets/', feed_url: 'https://maliavis.com/wp-json/wp/v2/posts?categories=1463', method: 'api', frequency_minutes: 360, default_category: 'appel-projets', last_run_at: null },
  { id: null, name: 'Maliavis (formations et stages)', country_code: 'ML', base_url: 'https://maliavis.com/category/formation/', feed_url: 'https://maliavis.com/wp-json/wp/v2/posts?categories=10,13', method: 'api', frequency_minutes: 360, default_category: null, last_run_at: null },
  { id: null, name: 'Ikabara', country_code: 'ML', base_url: 'https://ikabara.com', feed_url: 'https://ikabara.com/offers', method: 'html', frequency_minutes: 120, default_category: null, last_run_at: null },
  { id: null, name: 'UN Vacancies Mali', country_code: 'ML', base_url: 'https://unvacancies.org/jobs/location/mali', feed_url: 'https://unvacancies.org/jobs/location/mali', method: 'html', frequency_minutes: 360, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Jobrapide Mali', country_code: 'ML', base_url: 'https://www.jobrapide.org', feed_url: 'https://www.jobrapide.org/?s=mali&feed=rss2', method: 'rss', frequency_minutes: 120, default_category: null, last_run_at: null },
  { id: null, name: 'Kaleta Mali', country_code: 'ML', base_url: 'https://kaleta.co/job-region/mali/', feed_url: 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=978,38031,37986', method: 'api', frequency_minutes: 360, default_category: null, last_run_at: null },
  { id: null, name: 'Africarrières Sénégal', country_code: 'SN', base_url: 'https://africarrieres.com/senegal/fr', feed_url: 'https://africarrieres.com/senegal/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Sénégal', country_code: 'SN', base_url: 'https://www.goafricaonline.com/sn/emploi', feed_url: 'https://www.goafricaonline.com/sn/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Sénégal', country_code: 'SN', base_url: 'https://www.unjobnet.org/fr/emplois/senegal', feed_url: 'https://www.unjobnet.org/fr/emplois/senegal', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Côte d\'Ivoire', country_code: 'CI', base_url: 'https://africarrieres.com/ivory-coast/fr', feed_url: 'https://africarrieres.com/ivory-coast/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Côte d\'Ivoire', country_code: 'CI', base_url: 'https://www.goafricaonline.com/ci/emploi', feed_url: 'https://www.goafricaonline.com/ci/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Côte d\'Ivoire', country_code: 'CI', base_url: 'https://www.unjobnet.org/fr/emplois/cote-d-ivoire', feed_url: 'https://www.unjobnet.org/fr/emplois/cote-d-ivoire', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Burkina Faso', country_code: 'BF', base_url: 'https://africarrieres.com/burkina-faso/fr', feed_url: 'https://africarrieres.com/burkina-faso/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Burkina Faso', country_code: 'BF', base_url: 'https://www.goafricaonline.com/bf/emploi', feed_url: 'https://www.goafricaonline.com/bf/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Burkina Faso', country_code: 'BF', base_url: 'https://www.unjobnet.org/fr/emplois/burkina-faso', feed_url: 'https://www.unjobnet.org/fr/emplois/burkina-faso', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Guinée', country_code: 'GN', base_url: 'https://africarrieres.com/guinea/fr', feed_url: 'https://africarrieres.com/guinea/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Guinée', country_code: 'GN', base_url: 'https://www.goafricaonline.com/gn/emploi', feed_url: 'https://www.goafricaonline.com/gn/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Guinée', country_code: 'GN', base_url: 'https://www.unjobnet.org/fr/emplois/guinee', feed_url: 'https://www.unjobnet.org/fr/emplois/guinee', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Niger', country_code: 'NE', base_url: 'https://africarrieres.com/niger/fr', feed_url: 'https://africarrieres.com/niger/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Niger', country_code: 'NE', base_url: 'https://www.goafricaonline.com/ne/emploi', feed_url: 'https://www.goafricaonline.com/ne/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Niger', country_code: 'NE', base_url: 'https://www.unjobnet.org/fr/emplois/niger', feed_url: 'https://www.unjobnet.org/fr/emplois/niger', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Togo', country_code: 'TG', base_url: 'https://africarrieres.com/togo/fr', feed_url: 'https://africarrieres.com/togo/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Togo', country_code: 'TG', base_url: 'https://www.goafricaonline.com/tg/emploi', feed_url: 'https://www.goafricaonline.com/tg/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Togo', country_code: 'TG', base_url: 'https://www.unjobnet.org/fr/emplois/togo', feed_url: 'https://www.unjobnet.org/fr/emplois/togo', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: 'Africarrières Bénin', country_code: 'BJ', base_url: 'https://africarrieres.com/benin/fr', feed_url: 'https://africarrieres.com/benin/fr/emplois', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'Go Africa Online Bénin', country_code: 'BJ', base_url: 'https://www.goafricaonline.com/bj/emploi', feed_url: 'https://www.goafricaonline.com/bj/emploi', method: 'html', frequency_minutes: 720, default_category: null, last_run_at: null },
  { id: null, name: 'UNjobnet Bénin', country_code: 'BJ', base_url: 'https://www.unjobnet.org/fr/emplois/benin', feed_url: 'https://www.unjobnet.org/fr/emplois/benin', method: 'html', frequency_minutes: 720, default_category: 'ong-international', last_run_at: null },
  { id: null, name: "Educarriere (Côte d'Ivoire)", country_code: 'CI', base_url: 'https://emploi.educarriere.ci', feed_url: 'https://emploi.educarriere.ci/page/all', method: 'html', frequency_minutes: 240, default_category: null, last_run_at: null },
  { id: null, name: 'Senjob (Sénégal)', country_code: 'SN', base_url: 'https://senjob.com/sn', feed_url: 'https://senjob.com/sn/offres-d-emploi.php', method: 'html', frequency_minutes: 240, default_category: null, last_run_at: null },
  { id: null, name: 'Opportunities for Africans (bourses)', country_code: null, base_url: 'https://www.opportunitiesforafricans.com/category/scholarships/', feed_url: 'https://www.opportunitiesforafricans.com/wp-json/wp/v2/posts?categories=12,46', method: 'api', frequency_minutes: 240, default_category: 'bourse', last_run_at: null },
  { id: null, name: 'Opportunities for Africans (stages)', country_code: null, base_url: 'https://www.opportunitiesforafricans.com/category/internships/', feed_url: 'https://www.opportunitiesforafricans.com/wp-json/wp/v2/posts?categories=8', method: 'api', frequency_minutes: 240, default_category: 'stage', last_run_at: null },
  { id: null, name: 'SangoBids (marchés publics Mali)', country_code: 'ML', base_url: 'https://ml.sangobids.com', feed_url: 'https://ml.sangobids.com/tenders', method: 'html', frequency_minutes: 180, default_category: 'appel-offres', last_run_at: null },
  { id: null, name: 'Wave (recrutement)', country_code: null, base_url: 'https://wave.com/fr/careers/', feed_url: 'https://boards-api.greenhouse.io/v1/boards/wavemm1/jobs?content=true', method: 'api', frequency_minutes: 180, default_category: 'emploi', last_run_at: null },
  { id: null, name: 'Coris Bank Mali (recrutement)', country_code: 'ML', base_url: 'https://mali.coris.bank', feed_url: 'https://mali.coris.bank/actualites/', method: 'html', frequency_minutes: 360, default_category: 'emploi', last_run_at: null },
  // Migration 044 : huit pays, toutes les rubriques.
  t("SangoBids (marchés publics Sénégal)", 'SN', 'https://sn.sangobids.com', 'https://sn.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("SangoBids (marchés publics Côte d'Ivoire)", 'CI', 'https://ci.sangobids.com', 'https://ci.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("SangoBids (marchés publics Burkina Faso)", 'BF', 'https://bf.sangobids.com', 'https://bf.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("SangoBids (marchés publics Guinée)", 'GN', 'https://gn.sangobids.com', 'https://gn.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("SangoBids (marchés publics Niger)", 'NE', 'https://ne.sangobids.com', 'https://ne.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("SangoBids (marchés publics Bénin)", 'BJ', 'https://bj.sangobids.com', 'https://bj.sangobids.com/tenders', 'html', 240, 'appel-offres'),
  t("Kaleta Sénégal", 'SN', 'https://kaleta.co/job-region/senegal/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=977,38008', 'api', 360, null),
  t("Kaleta Côte d'Ivoire", 'CI', 'https://kaleta.co/job-region/cote-divoire/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=12084,38383', 'api', 360, null),
  t("Kaleta Burkina Faso", 'BF', 'https://kaleta.co/job-region/burkina-faso/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=980,38277,37952,38025', 'api', 360, null),
  t("Kaleta Guinée", 'GN', 'https://kaleta.co/job-region/guinea/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=972', 'api', 360, null),
  t("Kaleta Niger", 'NE', 'https://kaleta.co/job-region/niger/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=979', 'api', 360, null),
  t("Kaleta Togo", 'TG', 'https://kaleta.co/job-region/togo/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=969', 'api', 360, null),
  t("Kaleta Bénin", 'BJ', 'https://kaleta.co/job-region/benin/', 'https://kaleta.co/wp-json/wp/v2/job-listings?job_listing_region=968,37985,38058,38057', 'api', 360, null),
  t("UN Vacancies Sénégal", 'SN', 'https://unvacancies.org/jobs/location/senegal', 'https://unvacancies.org/jobs/location/senegal', 'html', 480, 'ong-international'),
  t("UN Vacancies Côte d'Ivoire", 'CI', 'https://unvacancies.org/jobs/location/ivory-coast', 'https://unvacancies.org/jobs/location/ivory-coast', 'html', 480, 'ong-international'),
  t("UN Vacancies Burkina Faso", 'BF', 'https://unvacancies.org/jobs/location/burkina-faso', 'https://unvacancies.org/jobs/location/burkina-faso', 'html', 480, 'ong-international'),
  t("UN Vacancies Guinée", 'GN', 'https://unvacancies.org/jobs/location/guinea', 'https://unvacancies.org/jobs/location/guinea', 'html', 480, 'ong-international'),
  t("UN Vacancies Niger", 'NE', 'https://unvacancies.org/jobs/location/niger', 'https://unvacancies.org/jobs/location/niger', 'html', 480, 'ong-international'),
  t("UN Vacancies Togo", 'TG', 'https://unvacancies.org/jobs/location/togo', 'https://unvacancies.org/jobs/location/togo', 'html', 480, 'ong-international'),
  t("UN Vacancies Bénin", 'BJ', 'https://unvacancies.org/jobs/location/benin', 'https://unvacancies.org/jobs/location/benin', 'html', 480, 'ong-international'),
  t("ANPE Niger", 'NE', 'https://anpe-niger.ne', 'https://anpe-niger.ne/wp-json/wp/v2/job-listings', 'api', 240, 'emploi'),
  t("EmploiTogo (emplois)", 'TG', 'https://www.emploitogo.info', 'https://www.emploitogo.info/wp-json/wp/v2/posts?categories=2,17437', 'api', 120, 'emploi'),
  t("EmploiTogo (appels d'offres)", 'TG', 'https://www.emploitogo.info/category/appeloffres/', 'https://www.emploitogo.info/wp-json/wp/v2/posts?categories=14421', 'api', 240, 'appel-offres'),
  t("EmploiTogo (formations)", 'TG', 'https://www.emploitogo.info/category/formations/', 'https://www.emploitogo.info/wp-json/wp/v2/posts?categories=12', 'api', 360, 'formation'),
  t("EmploiTogo (bourses et concours)", 'TG', 'https://www.emploitogo.info/category/bourses-et-concours/', 'https://www.emploitogo.info/wp-json/wp/v2/posts?categories=14621,17440,14422', 'api', 360, 'bourse'),
  t("Guinée Emploi", 'GN', 'https://www.guineeemploi.com', 'https://www.guineeemploi.com/wp-json/wp/v2/posts', 'api', 180, null),
  t("Jobrapide (Afrique de l'Ouest, toutes rubriques)", null, 'https://www.jobrapide.org/offres/', 'https://www.jobrapide.org/wp-json/wp/v2/posts?categories=17,18,19,20,21,22,121', 'api', 180, null),
  t("Scholars4dev (bourses)", null, 'https://www.scholars4dev.com', 'https://www.scholars4dev.com/wp-json/wp/v2/posts', 'api', 720, 'bourse'),
  // Novembre 2026 (2e tour) : nouvelles sources pour les 8 pays (migration 066).
  ...([['ML','ml','Mali'],['SN','sn','Sénégal'],['CI','ci',"Côte d'Ivoire"],['BF','bf','Burkina Faso'],['GN','gn','Guinée'],['NE','ne','Niger'],['TG','tg','Togo'],['BJ','bj','Bénin']] as const)
    .map(([cc, path, name]) => t(`Afrique Emplois ${name}`, cc, `https://afriqueemplois.com/${path}`, `https://afriqueemplois.com/${path}`, 'html', 240, null)),
  ...([['ML','mali','Mali'],['SN','senegal','Sénégal'],['CI','cote-d-ivoire',"Côte d'Ivoire"],['BF','burkina-faso','Burkina Faso'],['GN','guinee','Guinée'],['NE','niger','Niger'],['TG','togo','Togo'],['BJ','benin','Bénin']] as const)
    .map(([cc, path, name]) => t(`Simoon ${name}`, cc, `https://simoon-cv.com/emplois/pays/${path}`, `https://simoon-cv.com/emplois/pays/${path}`, 'html', 240, null)),
  t("Gouvernement du Bénin (offres d'emploi)", 'BJ', 'https://www.gouv.bj/opportunites/', 'https://www.gouv.bj/opportunites/offres-emploi/', 'html', 360, 'emploi'),
  t("JAO Guinée (emplois)", 'GN', 'https://www.jaoguinee.com/category/offres-d-emplois/', 'https://www.jaoguinee.com/wp-json/wp/v2/posts?categories=2', 'api', 240, 'emploi'),
  t("JAO Guinée (appels d'offres)", 'GN', 'https://www.jaoguinee.com/category/appels-d-offres/', 'https://www.jaoguinee.com/wp-json/wp/v2/posts?categories=3', 'api', 240, 'appel-offres'),
  t("BCEAO (appels d'offres)", null, 'https://www.bceao.int/fr/appels-offres/appels-offres-marches-publics-achats', 'https://www.bceao.int/fr/appels-offres/appels-offres-marches-publics-achats', 'html', 720, 'appel-offres'),
];

function collectorFor(s: Source): Collector {
  const host = new URL(s.feed_url ?? s.base_url).host;
  if (s.method === 'api' && host.includes('reliefweb')) return reliefweb;
  if (s.method === 'api' && host.includes('worldbank')) return worldbank;
  if (s.method === 'api' && host.includes('greenhouse')) return greenhouse;
  if (s.method === 'api' && (s.feed_url ?? '').includes('/wp-json/')) return wordpressJobs;
  if (s.method === 'rss') return rss;
  if (s.method === 'sitemap') return sitemap;
  if (s.method === 'html') return webpage;
  throw new Error(`Aucun robot pour la méthode « ${s.method} » sur ${host}`);
}

const isDue = (s: Source) =>
  !s.last_run_at || Date.now() - new Date(s.last_run_at).getTime() >= (s.frequency_minutes - 2) * 60_000;

function show(o: ReadyOffer) {
  const flag = o.suspicion_score >= 50 ? '  ⚠ SUSPECTE : ' + o.suspicion_reasons.join(', ') : '';
  console.log(`  • ${o.title} | ${o.organization_name ?? '?'} | ${o.city ?? '?'} | ${o.category} | ${o.deadline_at?.slice(0, 10) ?? '?'}${flag}`);
}

async function main() {
  if (!dryRun && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl)) {
    const v = config.supabaseUrl;
    throw new Error(`Le secret SUPABASE_URL ne ressemble pas à https://xxxx.supabase.co (longueur ${v.length}, début « ${v.slice(0, 12)} »)`);
  }
  const db = dryRun ? null : createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });

  let sources: Source[];
  if (db) {
    const { data, error } = await db.from('sources').select('*').eq('is_active', true);
    if (error) throw error;
    sources = (data as Source[]).filter(isDue);
  } else {
    console.log('Mode essai : rien ne sera enregistré.');
    sources = TRIAL_SOURCES;
  }
  if (only?.length) sources = sources.filter((s) => only.some((t) => s.name.toLowerCase().includes(t)));
  // Les sources attendues depuis le plus longtemps passent en premier : si le
  // temps manque, celles qui restent seront en tête au prochain passage.
  sources.sort((a, b) => (a.last_run_at ? Date.parse(a.last_run_at) : 0) - (b.last_run_at ? Date.parse(b.last_run_at) : 0));
  console.log(`${sources.length} source(s) à visiter.`);

  const startedAt = Date.now();
  let failures = 0, visited = 0, postponed = 0;
  const visit = async (source: Source) => {
    // On s'arrête avant la limite de temps du workflow (12 min) : une source
    // non visitée garde son ancien last_run_at et reste donc « due ».
    if (Date.now() - startedAt > config.runBudgetMs) {
      postponed++;
      return;
    }
    visited++;
    const started = new Date().toISOString();
    let runId: number | undefined;
    if (db && source.id) {
      const { data } = await db.from('source_runs').insert({ source_id: source.id, started_at: started }).select('id').single();
      runId = data?.id;
    }

    // Liens déjà enregistrés pour cette source : inutile de rouvrir ces pages.
    const known = new Set<string>();
    if (db && source.id) {
      const { data } = await db.from('opportunity_links').select('url').eq('source_id', source.id).order('last_seen_at', { ascending: false }).limit(5000);
      data?.forEach((r) => known.add(r.url));
      // Offres déjà lues mais écartées car expirées : on ne les rouvre pas non plus,
      // sinon elles occupent chaque fois la place des nouvelles (pages suivantes).
      const { data: skipped } = await db.from('skipped_links').select('url').eq('source_id', source.id).limit(5000);
      skipped?.forEach((r) => known.add(r.url));
    }

    let seen = 0, created = 0, error: string | null = null;
    try {
      const skip = async (url: string) => {
        if (db && source.id) await db.from('skipped_links').upsert({ url, source_id: source.id }, { onConflict: 'url', ignoreDuplicates: true });
      };
      const found = await collectorFor(source)(source, { isKnown: (u) => known.has(u), log: (m) => console.log(m), skip });
      seen = found.length;
      let expired = 0;
      for (const f of found) {
        const ready = prepare(f, source);
        // Résultats, attributions, reports, pages d'accueil… : pas des opportunités.
        if (NOT_AN_OFFER.test(ready.title)) {
          await skip(ready.url);
          continue;
        }
        if (isExpired(ready)) {
          expired++;
          await skip(ready.url);
          continue;
        }
        if (!db) { show(ready); continue; }
        const { data, error: e } = await db.rpc('ingest_opportunity', { p: ready });
        if (e) console.log(`  non enregistrée (${e.message}) : ${ready.url}`);
        else if (data?.created) created++;
      }
      console.log(`✓ ${source.name} : ${seen} offres lues, ${expired} déjà expirées écartées, ${created} nouvelles enregistrées`);
    } catch (e) {
      failures++;
      error = (e as Error).message;
      console.log(`✗ ${source.name} : ${error}`);
    }

    if (db && source.id) {
      const now = new Date().toISOString();
      if (runId) await db.from('source_runs').update({ finished_at: now, ok: !error, items_seen: seen, items_new: created, error }).eq('id', runId);
      const { data: cur } = await db.from('sources').select('consecutive_failures').eq('id', source.id).single();
      await db.from('sources').update({
        last_run_at: started,
        ...(error ? { consecutive_failures: (cur?.consecutive_failures ?? 0) + 1 } : { last_success_at: now, consecutive_failures: 0 }),
      }).eq('id', source.id);
    }
  };

  // Plusieurs sites visités en même temps (un groupe par site) : les sources
  // d'un même site restent l'une après l'autre, avec la pause habituelle entre
  // deux pages ; des sites différents avancent en parallèle. Le passage dure
  // ainsi beaucoup moins longtemps (et consomme moins de minutes GitHub).
  const groups = new Map<string, Source[]>();
  for (const s of sources) {
    // Un groupe par site : les 7 SangoBids (ml., sn., ci.…) passent l'un après l'autre,
    // sinon le site répond « 429 Too Many Requests ».
    const site = siteOf(new URL(s.feed_url ?? s.base_url).host);
    groups.set(site, [...(groups.get(site) ?? []), s]);
  }
  const queue = [...groups.values()];
  await Promise.all(Array.from({ length: config.parallelSites }, async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const source of group) await visit(source);
    }
  }));
  if (postponed) console.log(`⏸ Temps écoulé : ${postponed} source(s) remise(s) au prochain passage.`);

  if (visited > 0 && failures === visited) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
