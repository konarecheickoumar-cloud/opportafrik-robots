import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDeadline, guessCategory, guessContract, guessPlace, orgFromTitle, parseDate, prepare, suspicion } from './enrich.ts';
import { offerLinks, parseOfferPage } from './sources/webpage.ts';
import type { Source } from './types.ts';

const mali: Source = { id: 1, name: 'Essai', country_code: 'ML', base_url: 'https://exemple.ml', feed_url: null, method: 'html', frequency_minutes: 15, default_category: null, last_run_at: null };

test('dates en français et en anglais', () => {
  assert.equal(parseDate('06 septembre 2026')?.slice(0, 10), '2026-09-06');
  assert.equal(parseDate('1er décembre 2026')?.slice(0, 10), '2026-12-01');
  assert.equal(parseDate('15/11/2026')?.slice(0, 10), '2026-11-15');
  assert.equal(parseDate('Closes 9 Nov 2026 CET')?.slice(0, 10), '2026-11-09');
  assert.equal(parseDate('2026-10-30T12:00:00Z')?.slice(0, 10), '2026-10-30');
  assert.equal(parseDate('31/02/2026'), undefined);
});

test('date limite trouvée dans le texte', () => {
  assert.equal(findDeadline('Les dossiers seront reçus au plus tard le 06 septembre 2026 à 12 heures.')?.slice(0, 10), '2026-09-06');
  assert.equal(findDeadline('Date limite de dépôt : 20/11/2026')?.slice(0, 10), '2026-11-20');
  assert.equal(findDeadline('Référence 164584 Localisation Dakar Expiration 12 Novembre 2026 Offre visitée 85 fois')?.slice(0, 10), '2026-11-12');
  assert.equal(findDeadline('Aucune date ici'), undefined);
});

test('catégories et contrats', () => {
  assert.equal(guessCategory('Avis de concours direct de recrutement dans la fonction publique', '', null), 'concours');
  assert.equal(guessCategory("Avis d'appel d'offres pour la fourniture de matériel", '', null), 'appel-offres');
  assert.equal(guessCategory('APPEL À CANDIDATURES – CONCOURS DE L’INNOVATION 2026', '', null), 'appel-projets');
  assert.equal(guessCategory('Appel à projets de formation-insertion des jeunes', '', null), 'appel-projets');
  assert.equal(guessCategory('AVIS d’Appel à candidature pour le stage de formation professionnelle', '', null), 'stage');
  assert.equal(guessCategory('Avis de Formation', '', null), 'formation');
  assert.equal(guessContract('Energy Specialist', 'Tier 0 : UNDP/UNCDF/UNV IP staff and UN Volunteers'), 'non_precise');
  assert.equal(guessContract('Appel à candidatures : 200 volontaires nationaux', ''), 'volontariat');
  assert.equal(guessCategory("Avis à manifestation d'intérêt : étude de faisabilité", '', null), 'manifestation-interet');
  assert.equal(guessCategory('Stagiaire en comptabilité', '', null), 'stage');
  assert.equal(guessCategory('Comptable', '', null), 'emploi');
  assert.equal(guessContract('Chauffeur', 'Contrat : CDD de 12 mois'), 'cdd');
  assert.equal(guessContract('Consultant national', ''), 'consultance');
});

test('villes du Mali', () => {
  assert.deepEqual(guessPlace('ML', undefined, 'Infirmier à Sévaré', ''), { city: 'Sévaré', region_slug: 'mopti' });
  assert.deepEqual(guessPlace('ML', 'Bamako', 'Comptable', ''), { city: 'Bamako', region_slug: 'bamako' });
});

test('offre suspecte détectée', () => {
  const s = suspicion('Concours de la police 2026', "Payez les frais d'inscription de 10 000 FCFA par Orange Money au 70 00 00 00. Contact : recrutement.police@gmail.com", 'concours');
  assert.ok(s.score >= 50, `score ${s.score}`);
  assert.equal(suspicion('Comptable', 'Envoyez votre CV et lettre de motivation.', 'emploi').score, 0);
});

test('résumé écrit avec nos mots, sans le texte d’origine', () => {
  const r = prepare({ url: 'https://exemple.ml/o/1', title: 'Chargé de communication', organization_name: 'Cabinet Exemple', text: 'Poste basé à Bamako. CDI. Au plus tard le 06 septembre 2026. Texte long de l’annonce…' }, mali);
  assert.equal(r.summary, "Cabinet Exemple recrute pour le poste « Chargé de communication » à Bamako. Il s'agit d'un contrat à durée indéterminée (CDI). Les candidatures sont ouvertes jusqu'au 6 septembre 2026.");
  assert.equal(r.region_slug, 'bamako');
  assert.ok(!('text' in r));
});

test('lecture d’une page avec données JobPosting', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Infirmier","datePosted":"2026-10-20","validThrough":"2026-11-15T23:59:00","employmentType":"FULL_TIME","hiringOrganization":{"@type":"Organization","name":"Clinique Exemple"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Ségou","addressCountry":"ML"}},"description":"<p>Soins aux patients.</p>"}</script></head><body><h1>Infirmier</h1></body></html>`;
  const o = parseOfferPage(html, 'https://exemple.ml/emplois/infirmier')!;
  assert.equal(o.title, 'Infirmier');
  assert.equal(o.organization_name, 'Clinique Exemple');
  assert.equal(o.city, 'Ségou');
  assert.equal(o.contract_type, undefined); // « temps plein » seul ne dit pas CDI
  assert.equal(o.deadline_at?.slice(0, 10), '2026-11-15');
});

test('repérage des liens d’offres sur une page de liste', () => {
  const html = `<a href="/mali/fr/emplois/comptable-senior">x</a><a href="/mali/fr/emplois/comptable-senior#top">x</a><a href="/mali/fr/companies/abc">y</a><a href="https://autre.com/mali/fr/emplois/z">z</a>`;
  assert.deepEqual(offerLinks(html, 'https://africarrieres.com/mali/fr/emplois', { offerLink: /\/[a-z]{2}\/emplois\/[a-z0-9-]+\/?$/ }), ['https://africarrieres.com/mali/fr/emplois/comptable-senior']);
});

test('pays reconnu pour écarter les offres hors du Mali', async () => {
  const { countryCode } = await import('./countries.ts');
  assert.equal(countryCode('Mali'), 'ML');
  assert.equal(countryCode('MLI'), 'ML');
  assert.equal(countryCode('ml'), 'ML');
  assert.equal(countryCode('Somalia'), 'SO');
});

test('« temps plein » ne veut pas dire CDI', () => {
  const html = `<script type="application/ld+json">{"@type":"JobPosting","title":"Consultant en tourisme","employmentType":"FULL_TIME","description":"Mission de consultance de 3 mois"}</script>`;
  const o = parseOfferPage(html, 'https://exemple.ml/emplois/x')!;
  assert.equal(o.contract_type, undefined);
  assert.equal(prepare(o, mali).contract_type, 'consultance');
});

test('formation seulement si le titre commence par « formation »', () => {
  assert.equal(guessCategory('Assistant technique Formation et insertion professionnelle', '', null), 'emploi');
  assert.equal(guessCategory('Formation en gestion de projet', '', null), 'formation');
});

test('dates limites absurdes ignorées, offres expirées repérées', async () => {
  const { isExpired } = await import('./enrich.ts');
  const far = prepare({ url: 'https://x.ml/1', title: 'Comptable', deadline_at: '2031-06-07T23:59:00Z' }, mali);
  assert.equal(far.deadline_at, undefined);
  assert.equal(isExpired({ deadline_at: '2026-05-11T23:59:00Z' }), true);
  assert.equal(isExpired({}), false);
});

test('adresse Supabase acceptée sous plusieurs formes', async () => {
  const { normalizeSupabaseUrl } = await import('./config.ts');
  assert.equal(normalizeSupabaseUrl(' https://abcdefghijklmnopqrst.supabase.co/ \n'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(normalizeSupabaseUrl('abcdefghijklmnopqrst.supabase.co'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(normalizeSupabaseUrl('abcdefghijklmnopqrst'), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(normalizeSupabaseUrl('https://abcdefghijklmnopqrst.supabase.co/rest/v1'), 'https://abcdefghijklmnopqrst.supabase.co');
});

test('adresse Supabase retrouvée depuis l’adresse de connexion', async () => {
  const { supabaseUrlFrom } = await import('./config.ts');
  const db = 'postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-0-eu-west-3.pooler.supabase.com:5432/postgres';
  assert.equal(supabaseUrlFrom('https://github.com', db), 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(supabaseUrlFrom('https://zyxwvutsrqponmlkjihg.supabase.co', db), 'https://zyxwvutsrqponmlkjihg.supabase.co');
});

test('employeur lu dans le titre « X recrute … »', () => {
  assert.equal(orgFromTitle('Sanova recrute un comptable'), 'Sanova');
  assert.equal(orgFromTitle('CBI Mali recrute un Chargé de Projets (H/F)'), 'CBI Mali');
  assert.equal(orgFromTitle("Avis de recrutement : Orange Mali recrute des stagiaires"), 'Orange Mali');
  assert.equal(orgFromTitle('Wave is hiring a Field Agent'), 'Wave');
  assert.equal(orgFromTitle('Une ONG internationale recrute un chauffeur'), undefined, 'employeur anonyme');
  assert.equal(orgFromTitle('Cabinet recrute 10 commerciaux'), undefined);
  assert.equal(orgFromTitle('Recrutement d’un comptable'), undefined, 'pas de « recrute » après un nom');
  assert.equal(orgFromTitle('Comptable senior – Bamako'), undefined);
  const r = prepare({ url: 'https://exemple.ml/o/2', title: 'Sanova recrute un comptable', text: 'Bamako' }, mali);
  assert.equal(r.organization_name, 'Sanova');
  assert.match(r.summary, /^Sanova recrute/);
});

test('logo et site de l’employeur lus dans la fiche JobPosting', () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Comptable",
    "hiringOrganization":{"@type":"Organization","name":"Sanova","sameAs":"https://sanova.ml","logo":{"@type":"ImageObject","url":"https://sanova.ml/logo.png"}}}</script></head><body></body></html>`;
  const o = parseOfferPage(html, 'https://exemple.ml/offre/1');
  assert.equal(o?.organization_website, 'https://sanova.ml');
  assert.equal(o?.organization_logo, 'https://sanova.ml/logo.png');
});

// Titres remis en forme (web/lib/titre.ts, partagé avec le site).
test('titres en majuscules remis en forme', async () => {
  const { tidyTitle, orgInTitle } = await import('../../web/lib/titre.ts');
  assert.equal(tidyTitle('ECOLE RECRUTE CENSEUR DES ETUDES H/F'), 'École recrute censeur des études (H/F)');
  assert.equal(tidyTitle('RECRUTEMENT D\'UNE AIDE MENAGERE A BAMAKO'), 'Recrutement d\'une aide ménagère à Bamako');
  assert.equal(tidyTitle('L\'OMS RECRUTE UN CHARGE DE PROGRAMME PNUD/ONG'), 'L\'OMS recrute un chargé de programme PNUD/ONG');
  assert.equal(tidyTitle('ORANGE MALI RECRUTE UN DRH EN CDI', 'Orange Mali'), 'Orange Mali recrute un DRH en CDI');
  assert.equal(tidyTitle('Comptable senior h/f'), 'Comptable senior (H/F)');
  assert.equal(tidyTitle('Assistant administratif'), 'Assistant administratif');
  assert.ok(orgInTitle('Orange Mali recrute un comptable', 'ORANGE MALI'));
  assert.ok(!orgInTitle('Comptable', 'Orange'));
});

test('résumé : le titre « X recrute … » n’est pas répété en entier', () => {
  const r = prepare({ url: 'https://exemple.ml/o/2', title: 'D2C SAS recrute contrôleur qualité (H/F)', organization_name: 'D2C SAS', text: 'Poste basé à Bamako. CDD.' }, mali);
  assert.ok(r.summary.startsWith('D2C SAS recrute pour le poste « Contrôleur qualité (H/F) »'), r.summary);
});
