import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWpJobs, parseWpPosts } from './wordpress.ts';
import { parseOfferPage, RULES } from './webpage.ts';
import { countryFromLocation, cityFromLocation } from './greenhouse.ts';
import { prepare } from '../enrich.ts';
import { countryAtSlugEnd, countryFromSlug } from '../countries.ts';
import type { Source } from '../types.ts';

const anpe: Source = {
  id: 1, name: 'ANPE Mali', country_code: 'ML',
  base_url: 'https://anpe-mali.org', feed_url: 'https://anpe-mali.org/wp-json/wp/v2/job-listings',
  method: 'api', frequency_minutes: 60, default_category: 'emploi', last_run_at: null,
};

// Jeu d'essai proche de la vraie réponse d'ANPE Mali (observée le 2026-10-27).
const sample = [
  {
    link: 'https://anpe-mali.org/poste/chef-dequipe-structures-metalliques/',
    status: 'publish',
    date_gmt: '2026-10-26T10:10:13',
    title: { rendered: 'CHEF D&#8217;EQUIPE EN STRUCTURES M&#201;TALLIQUES (H/F)' },
    content: { rendered: '<p>Poste basé à Bamako. DATE LIMITE : 30 octobre 2026.</p>' },
    class_list: ['post-123', 'type-job_listing', 'job-type-cdi'],
    meta: { _company_name: 'GRM Cabinet de Recrutement', _job_location: 'Bamako', _remote_position: 0 },
  },
  {
    link: 'https://anpe-mali.org/poste/developpeur-remote/',
    status: 'publish',
    date_gmt: '2026-10-25T09:00:00',
    title: { rendered: 'Développeur web' },
    content: { rendered: '<p>Mission à distance.</p>' },
    class_list: ['job-type-stage'],
    meta: { _company_name: 'Tech ML', _job_location: 'À distance', _remote_position: 1 },
  },
  { link: 'https://anpe-mali.org/poste/brouillon/', status: 'draft', title: { rendered: 'Brouillon' } },
];

test('parseWpJobs : champs et décodage', () => {
  const offers = parseWpJobs(sample);
  assert.equal(offers.length, 2, 'le brouillon est écarté');

  const a = offers[0];
  assert.equal(a.title, 'CHEF D’EQUIPE EN STRUCTURES MÉTALLIQUES (H/F)');
  // Entités nommées (ex. yabara.org renvoie &rsquo; et &amp;)
  assert.equal(parseWpPosts([{ link: "https://x/y", status: "publish", title: { rendered: "SNV RECRUTE BUREAU D&rsquo;ETUDES &amp; CONSEIL" } }])[0].title, "SNV RECRUTE BUREAU D’ETUDES & CONSEIL");
  assert.equal(a.organization_name, 'GRM Cabinet de Recrutement');
  assert.equal(a.city, 'Bamako');
  assert.equal(a.is_remote, undefined);
  assert.equal(a.contract_type, 'cdi');
  assert.equal(a.published_at, '2026-10-26T10:10:13Z');

  const b = offers[1];
  assert.equal(b.city, undefined, '« À distance » n’est pas une ville');
  assert.equal(b.is_remote, true);
  assert.equal(b.contract_type, 'stage');
});

test('prepare : une offre WordPress devient publiable', () => {
  const [a] = parseWpJobs(sample);
  const ready = prepare(a, anpe);
  assert.equal(ready.country_code, 'ML');
  assert.equal(ready.category, 'emploi');
  assert.equal(ready.region_slug, 'bamako');
  assert.equal(ready.deadline_at?.slice(0, 10), '2026-10-30', 'date limite lue dans le texte');
  assert.match(ready.summary, /GRM Cabinet de Recrutement/);
  assert.ok(ready.summary.length <= 600);
});

test('parseWpPosts + prepare : un article devient un concours', () => {
  const fp: Source = {
    id: 9, name: 'Fonction publique (concours)', country_code: 'ML',
    base_url: 'https://fonctionpublique.gouv.ml',
    feed_url: 'https://fonctionpublique.gouv.ml/wp-json/wp/v2/posts?categories=6,60',
    method: 'api', frequency_minutes: 180, default_category: 'concours', last_run_at: null,
  };
  const posts = [{
    link: 'https://fonctionpublique.gouv.ml/ouverture-concours-directs-2026/',
    status: 'publish',
    date_gmt: '2026-10-20T08:00:00',
    title: { rendered: 'Ouverture des concours directs de recrutement 2026' },
    content: { rendered: '<p>Dossiers reçus. Date limite : 15 novembre 2026.</p>' },
    excerpt: { rendered: '<p>Concours fonction publique.</p>' },
  }];
  const offers = parseWpPosts(posts);
  assert.equal(offers.length, 1);
  const ready = prepare(offers[0], fp);
  assert.equal(ready.category, 'concours');
  assert.equal(ready.country_code, 'ML');
  assert.equal(ready.deadline_at?.slice(0, 10), '2026-11-15');
});

test('parseOfferPage : employeur déduit du titre (Malipages)', () => {
  const html = `<!doctype html><html><head><title>Caissier | GROUPE COFINA | Malipages</title></head>
    <body><main><h1>Caissier</h1><p>Poste à Bamako. Date limite de candidature: 2 novembre 2026.</p></main></body></html>`;
  const rule = { offerLink: /.*/, orgFromTitle: true };
  const offer = parseOfferPage(html, 'https://www.malipages.com/emplois/caissier-cofina/', rule);
  assert.equal(offer?.title, 'Caissier');
  assert.equal(offer?.organization_name, 'GROUPE COFINA');
  assert.equal(offer?.deadline_at?.slice(0, 10), '2026-11-02');
});

test('countryFromSlug : pays francophones et inconnus', () => {
  assert.equal(countryFromSlug('mali'), 'ML');
  assert.equal(countryFromSlug('tchad'), 'TD');
  assert.equal(countryFromSlug('cote-divoire'), 'CI');
  assert.equal(countryFromSlug('cote-d-ivoire'), 'CI', 'les deux orthographes tombent sur CI');
  assert.equal(countryFromSlug('rdcongo'), 'CD', 'sans tiret aussi (orthographe du site)');
  assert.equal(countryFromSlug('rd-congo'), 'CD');
  assert.equal(countryFromSlug('burkina-faso'), 'BF');
  assert.equal(countryFromSlug('afrique'), undefined, '« afrique » reste « Toute l’Afrique »');
  assert.equal(countryFromSlug('pays-imaginaire'), undefined);
});

test('lesopportunites : l’adresse d’offre est reconnue, pas les pages d’archive', () => {
  const rule = RULES['www.lesopportunites.com'];
  const offer = '/opportunite/mali/avis-de-recrutement/genre/coopi-recrute-un-agent-mali/';
  assert.ok(rule.offerLink.test(offer), 'une vraie offre passe');
  assert.ok(!rule.offerLink.test('/opportunite/'), 'la page d’archive est écartée');
  assert.ok(!rule.offerLink.test('/opportunite/mali/'), 'une page pays est écartée');
  assert.ok(rule.childSitemap!.test('https://www.lesopportunites.com/opportunite-sitemap51.xml'));
  assert.ok(rule.childSitemap!.test('https://www.lesopportunites.com/opportunite-sitemap.xml'));
  assert.ok(!rule.childSitemap!.test('https://www.lesopportunites.com/post-sitemap.xml'));
});

test('parseOfferPage : pays lu dans l’adresse (lesopportunites)', () => {
  const rule = RULES['www.lesopportunites.com'];
  const html = `<!doctype html><html><head><title>BIDC recrute - Opportunités du Monde</title></head>
    <body><main><h1>La BIDC recrute des jeunes professionnels</h1>
    <p>Postulez avant le 30/10/2026.</p></main></body></html>`;
  const td = parseOfferPage(html, 'https://www.lesopportunites.com/opportunite/tchad/avis-de-recrutement/sante/x-recrute-un-medecin/', rule);
  assert.equal(td?.country_code, 'TD');
  assert.equal(td?.deadline_at?.slice(0, 10), '2026-10-30');

  const panafr = parseOfferPage(html, 'https://www.lesopportunites.com/opportunite/afrique/bourses/ingenierie/prix-unesco/', rule);
  assert.equal(panafr?.country_code, undefined, 'une offre « afrique » n’a pas de pays → Toute l’Afrique');
});

test('SangoBids : une fiche de marché est reconnue, pas la pagination', () => {
  const rule = RULES['ml.sangobids.com'];
  assert.ok(rule.offerLink.test('/tenders/cmvqr9w35028up90pp7g612k5/fourniture-de-materiel'), 'une vraie fiche passe');
  assert.ok(!rule.offerLink.test('/tenders'), 'la page de liste est écartée');
  assert.ok(!rule.offerLink.test('/tenders/page/2'), 'la pagination est écartée');
});

test('SangoBids : le type de passation est rangé dans nos catégories', () => {
  const rule = RULES['ml.sangobids.com'];
  const page = (type: string) => `<!doctype html><html><head><title>Marché</title></head>
    <body><main><h1>Fourniture de matériel informatique</h1>
    <p>Type de passation : ${type}</p><p>Date limite : 9 novembre 2026</p></main></body></html>`;
  assert.equal(parseOfferPage(page('Demande de cotation'), 'https://ml.sangobids.com/tenders/cmvqr9w35028up90pp7g612k5/x', rule)?.category, 'cotation');
  assert.equal(parseOfferPage(page("Appel d'offres ouvert"), 'https://ml.sangobids.com/tenders/cmvqr9w35028up90pp7g612k5/x', rule)?.category, 'appel-offres');
  assert.equal(parseOfferPage(page("Avis à manifestation d'intérêt"), 'https://ml.sangobids.com/tenders/cmvqr9w35028up90pp7g612k5/x', rule)?.category, 'manifestation-interet');
});

test('Greenhouse : le pays est lu dans le lieu (noms anglais)', () => {
  assert.equal(countryFromLocation('Bamako, Mali'), 'ML');
  assert.equal(countryFromLocation('Niamey, Niger'), 'NE');
  assert.equal(countryFromLocation('Freetown, Sierra Leone'), 'SL');
  assert.equal(countryFromLocation('Kinshasa, Democratic Republic of the Congo'), 'CD');
  assert.equal(countryFromLocation('Cameroon'), 'CM');
  assert.equal(countryFromLocation('Malawi'), 'MW');
  assert.equal(countryFromLocation('Remote'), undefined, 'un lieu non reconnu → Toute l’Afrique');
});

test('Coris : seules les actualités /recrutement-…/ sont des offres, employeur fixe', () => {
  const rule = RULES['mali.coris.bank'];
  assert.ok(rule.offerLink.test('/recrutement-charge-de-projets-h-f/'), 'une offre de recrutement passe');
  assert.ok(!rule.offerLink.test('/actualites/'), 'la page de liste est écartée');
  assert.ok(!rule.offerLink.test('/communique-de-presse-2026/'), 'une actualité qui n’est pas une offre est écartée');
  const html = `<!doctype html><html><head><title>CBI Mali recrute un Chargé de Projets (H/F) - Coris Bank International Mali</title></head>
    <body><main><h1>CBI Mali recrute un Chargé de Projets (H/F)</h1>
    <p>Candidatures au plus tard le 7 novembre 2026.</p></main></body></html>`;
  const offer = parseOfferPage(html, 'https://mali.coris.bank/recrutement-charge-de-projets-h-f/', rule);
  assert.equal(offer?.organization_name, 'Coris Bank International Mali');
  assert.equal(offer?.deadline_at?.slice(0, 10), '2026-11-07');
});

test('Greenhouse : la ville est séparée du pays', () => {
  assert.equal(cityFromLocation('Bamako, Mali'), 'Bamako');
  assert.equal(cityFromLocation('Malawi'), undefined, 'un pays seul n’est pas une ville');
  assert.equal(cityFromLocation('Cameroon'), undefined);
});

test('Emploi365 : une fiche est reconnue, « Entreprise divers » n’est pas un employeur', () => {
  const rule = RULES['emploi365.com'];
  assert.ok(rule.offerLink.test('/offres/entreprise-divers-poste-assistant-magasinier'), 'une vraie fiche passe');
  assert.ok(!rule.offerLink.test('/offres'), 'la page de liste est écartée');
  const html = `<!doctype html><html><head><title>Assistant Magasinier — Entreprise divers | Emploi365</title>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Assistant Magasinier",
    "description":"<p>Lieu : Goulamina, Mali</p>","hiringOrganization":{"@type":"Organization","name":"Entreprise divers"},
    "datePosted":"2026-10-23","validThrough":"2026-11-01"}</script></head><body><h1>Assistant Magasinier</h1></body></html>`;
  const offer = parseOfferPage(html, 'https://emploi365.com/offres/entreprise-divers-poste-assistant-magasinier', rule);
  assert.equal(offer?.title, 'Assistant Magasinier');
  assert.equal(offer?.organization_name, undefined);
  assert.equal(offer?.deadline_at?.slice(0, 10), '2026-11-01');
});

test('Jobrapide : le pays est lu à la fin de l’adresse', () => {
  const rule = RULES['www.jobrapide.org'];
  const url = 'https://www.jobrapide.org/offres/avis-recrutement/orabank-recherche-controleur-financier-h-f-bamako-mali/';
  assert.ok(rule.offerLink.test(new URL(url).pathname));
  assert.equal(countryAtSlugEnd(url), 'ML');
  assert.equal(countryAtSlugEnd('https://www.jobrapide.org/offres/avis-recrutement/comptable-abidjan-cote-d-ivoire/'), 'CI');
  assert.equal(countryAtSlugEnd('https://www.jobrapide.org/offres/avis-recrutement/stagiaire-malabo-guinee-equatoriale/'), 'GQ');
  assert.equal(countryAtSlugEnd('https://www.jobrapide.org/offres/avis-recrutement/developpeur-paris-france/'), undefined);
});

test('Jobrapide multi-pays : on garde nos 8 pays, et les bourses sans pays', async () => {
  const { keepBySlugCountry } = await import('./wordpress.ts');
  const o = (url: string) => ({ url, title: 't' });
  const offers = [
    o('https://www.jobrapide.org/offres/avis-recrutement/comptable-dakar-senegal/'),
    o('https://www.jobrapide.org/offres/avis-recrutement/chauffeur-lome-togo/'),
    o('https://www.jobrapide.org/offres/avis-recrutement/stagiaire-douala-cameroun/'),
    o('https://www.jobrapide.org/offres/bourses-etude/bourses-mna-banque-mondiale/'),
    o('https://www.jobrapide.org/offres/concours/concours-banque-de-france/'),
  ];
  const kept = keepBySlugCountry(offers, null, null);
  assert.deepEqual(kept.map((x) => x.country_code), ['SN', 'TG', null]);
  assert.equal(kept[2].category, 'bourse');
  assert.equal(kept[0].category, undefined);
  assert.deepEqual(keepBySlugCountry(offers, 'TG', null).map((x) => x.url), [offers[1].url]);
});

test('EmploiTogo : date limite lue dans le titre, offres d\'autres pays écartées', async () => {
  const { titleDeadline } = await import('./wordpress.ts');
  const out = titleDeadline([
    { url: 'https://www.emploitogo.info/a/', title: 'Un chauffeur-10/11/2026 (02 postes)' },
    { url: 'https://www.emploitogo.info/b/', title: 'Group AGECOSCO recrute-04/12/2026 (Gabon)' },
    { url: 'https://www.emploitogo.info/c/', title: 'La GIZ recrute' },
    { url: 'https://www.emploitogo.info/d/', title: 'Concours de plans d\'affaires SDRB Somalie 2026' },
    { url: 'https://www.emploitogo.info/e/', title: 'Concours d\'entrée au CFPJ 2026 à Lomé, Togo' },
    { url: 'https://www.emploitogo.info/f/', title: 'Bourse Maurice Dupont pour étudiants togolais' },
  ], 'TG');
  assert.deepEqual(out.map((o) => o.title), ['Un chauffeur (02 postes)', 'La GIZ recrute', 'Concours d\'entrée au CFPJ 2026 à Lomé, Togo', 'Bourse Maurice Dupont pour étudiants togolais']);
  assert.equal(out[0].deadline_at, '2026-11-10T23:59:00Z');
});

test('SangoBids : l\'autorité contractante devient l\'employeur, la date limite est lue', () => {
  const rule = RULES['ml.sangobids.com'];
  const html = '<html><body><h1>Formation de femmes maraîchères</h1><div><p>Autorité contractante</p><a href="/agencies/undp">UNDP</a></div>'
    + '<div><p>Date limite</p><p>9 novembre 2026</p></div><p>Demande de cotation</p><footer><a href="/agencies">Autorités contractantes</a></footer></body></html>';
  const o = parseOfferPage(html, 'https://ml.sangobids.com/tenders/cmvb1eoyr02tso20pm1wwreui/x', rule);
  assert.equal(o?.organization_name, 'UNDP');
  assert.equal(o?.deadline_at?.slice(0, 10), '2026-11-09');
});

