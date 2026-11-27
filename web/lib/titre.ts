// Titres d'annonces propres : « ECOLE RECRUTE CENSEUR DES ETUDES H/F »
// devient « École recrute censeur des études (H/F) ».
// Utilisé à la collecte (robots/src/enrich.ts) ET à l'affichage (lib/data.ts,
// lib/offre-worker.ts) pour les offres déjà en base. Aucune dépendance : ce
// fichier est importé tel quel par les robots.
// Calcul très léger (quelques expressions régulières par titre).

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

// Sigles gardés en MAJUSCULES (ceux qui ont des voyelles ; un mot sans voyelle
// comme RH, BTP, DRH, PDG reste en majuscules automatiquement).
const SIGLES = new Set(`
OMS PNUD ONG ONU UNICEF UNHCR HCR PAM FAO OIT OIM UNFPA UNOPS UNESCO UNDP UNEP UNIDO UNAIDS ONUSIDA
MINUSMA UE USAID GIZ AFD BAD BOAD BCEAO UEMOA CEDEAO ECOWAS CICR MSF IRC NRC ACF CRS SNV WFP WHO
IFAD FIDA BID BIT OCHA IOM ILO IMF FMI BM IDA CILSS OMVS OMVG AES ALG ANPE APEJ FAFPA INPS CANAM AMO
ONEF ACI EDM CMDT BNDA BICIM BIM BDM BMS ORTM AGEFAU ANADEB OPAM ONAP CNSS IPRES ANSD ARMP DNCMP
DG DAF CEO CFO CTO COO CDI CDD CV BTS DUT BAC DEF CAP DEUG BEPC LMD MBA DESS DEA PHD
IT TIC NTIC QHSE HSE SIG SI ERP SAP KYC AML PME PMI SA SARL SAS SASU GIE USA UK EU
ICT UX UI SEO SEA SQL PHP AI IA GPS VIH SIDA TB ODD MEAL WASH EHA NUT AGR
II III IV VI VII VIII IX XI XII OHADA SYSCOHADA BEAC CEMAC
`.trim().split(/\s+/));

// Petits mots (2 à 4 lettres) qui sont de vrais mots : on les écrit en minuscules.
// Un mot court inconnu (ex. « BMCE », « SGBS ») est pris pour un sigle et reste en majuscules.
const PETITS_MOTS = new Set(`
a à au aux de des du la le les un une et ou en sur par pour avec dans sous chez vers sans entre
ce ces cet son sa ses nos vos leur tout tous toute mon ma
chef aide avis site zone base gare port mine eau eaux bois fer art arts vie soin soins sage lot lots
net mois ans an jour jours plus deux six sept huit neuf dix onze cent mil est sud nord ouest
job jobs data web lead head team call cash the and for of in at to on with from new all our its
poste stage etat agent cadre caisse poids role are you your bank fund care plan
`.trim().split(/\s+/).map(strip));

// Mots qu'on remet avec leurs accents (forme sans accent → forme correcte).
const ACCENTS: Record<string, string> = Object.fromEntries(`
école écoles étude études étudiant étudiants étudiante étudiantes ménage ménagère ménagères
sécurité santé société sociétés secrétaire secrétaires secrétariat général générale généraux généraliste
gérant gérante gérants électricien électricienne électriciens électricité électrique électronique
électromécanicien électromécanique électrification mécanicien mécaniciens mécanique technicienne
ingénieur ingénieure ingénieurs ingénierie médecin médecins médical médicale médicaux réceptionniste
réception hôtesse hôtesses hôtel hôtels hôtellerie hôtelier hôtelière cuisinière pâtissier pâtisserie
télécom télécoms télécommunications développeur développeuse développeurs développement données système
systèmes réseau réseaux opérateur opératrice opérateurs opérations opération opérationnel opérationnelle
délégué déléguée délégués délégation vétérinaire vétérinaires élevage éleveur éleveurs régional régionale
régionaux région régions préfet préfecture chargé chargée chargés chargées équipe équipes équipement
équipements matériel matériels matériaux entrepôt dépôt diplômé diplômée diplômés diplôme diplômes
bénévole bénévoles rémunéré rémunérée rémunération éducation éducateur éducatrice éducateurs élève
élèves mathématiques français française économie économique économiques économiste financière
trésorerie trésorier trésorière contrôleur contrôleuse contrôleurs contrôle contrôles qualité hygiène
propreté réparation réparateur rédacteur rédactrice rédaction communauté président présidente
présidence ministère république décembre février août agréé agréée référent référente spécialiste
spécialistes spécialisé spécialisée café épicerie détail détaillant véhicule véhicules numérique énergie
énergies énergétique géomètre géologue géologie génie crédit créance créances clientèle guichetière
téléconseiller téléconseillère télévendeur télévendeuse vidéo vidéos vidéaste créatif créative créateur
création dédouanement déclarant déclaration procédure procédures supérieur supérieure intérim intérimaire
durée déterminée indéterminée période expérience expériences expérimenté expérimentée expérimentés
qualifié qualifiée qualifiés compétence compétences compétent compétente préparateur préparatrice
pédagogique pédagogie médiateur médiatrice élaboration évaluation évaluations évaluateur évaluatrice
réalisation réhabilitation bâtiment bâtiments sélection présélection entrée accès privé privée carrière
carrières métier métiers activité activités intégrité sûreté téléphonie téléphone aéroport aérien
aérienne aéronautique régisseur écologie médias média câble câblage sénior séniors pépinière
pépiniériste hydrogéologue géophysicien désigné désignée sécurisation rénovation réfection bénéficiaire
bénéficiaires préparation stratégie stratégique sténo commerçant commerçante prospérité réseautage
caissière responsable fonctionnalité thématique thème université universités universitaire
universitaires lycée collège collèges académie académique bibliothécaire bibliothèque musée
infirmière infirmières sage-femme ophtalmologie pédiatre pédiatrie gynécologue gynécologie chirurgien
chirurgienne dentiste kinésithérapeute radiologie anesthésie épidémiologie épidémiologiste
nutritionniste diététicien diététicienne assistante comptabilité réceptionnaire répartiteur
installateur intégrateur négociateur négociatrice négociation représentant représentante représentants
démarcheur démarcheuse prévention protection détection désinfection déchets décoration décorateur
décoratrice esthéticienne esthétique coiffeuse cuisinier pâtissière boulangère serveuse
blanchisserie sécurisé gestionnaire coopérative coopératives coopération fédération association
élu élue élus élection élections électorale électoral sénégal sénégalais guinée bénin lomé
ségou tombouctou thiès bouaké bénévolat intérieur extérieur général énergie hôpital hôpitaux clinique
pharmacie pharmacien pharmacienne biomédical biomédicale paramédical paramédicaux médicaments
écrivain écriture édition éditeur éditrice éditorial rédactionnel publié publiée immédiat immédiate
immédiatement urgent urgente prioritaire réservé réservée réservées féminin féminine féminines
masculin candidatures candidature dépôts sélectionné sélectionnés retenu retenus admis admissibilité
définitive définitif résultats résultat liste listes à
`.trim().split(/\s+/).map((w) => [strip(w).toLowerCase(), w]));

// Noms propres (pays, villes, régions) remis avec une majuscule (et leurs accents).
const LIEUX: Record<string, string> = Object.fromEntries(`
Mali Sénégal Guinée Niger Togo Bénin Burkina Faso Afrique Africa Bamako Ségou Mopti Sikasso Kayes Gao
Tombouctou Kidal Koulikoro Kati Ménaka Taoudéni Bougouni Koutiala Dakar Thiès Ziguinchor Kaolack
Touba Abidjan Yamoussoukro Bouaké Korhogo Daloa Ouagadougou Bobo-Dioulasso Koudougou Conakry Kankan
Kindia Niamey Zinder Maradi Agadez Tahoua Lomé Kara Sokodé Cotonou Porto-Novo Parakou Abomey-Calavi
Nigeria Ghana Cameroun Gabon Congo Tchad Mauritanie Maroc Tunisie Algérie Kenya Rwanda Ouganda
Éthiopie Madagascar Libéria Gambie Europe France Canada Genève Paris Londres Washington
`.trim().split(/\s+/).map((w) => [strip(w).toLowerCase(), w]));

// Titre presque entièrement en majuscules ?
function crie(s: string): boolean {
  const lettres = s.match(/\p{L}/gu) ?? [];
  if (lettres.length < 6) return false;
  const maj = lettres.filter((c) => c !== c.toLowerCase()).length;
  return maj / lettres.length >= 0.7;
}

const capitale = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// Un mot écrit en majuscules → sa bonne forme.
function mot(w: string): string {
  if (/\d/.test(w)) return w;                       // « 2026 », « N°3 », « B2B »
  const nu = strip(w).toUpperCase();
  if (SIGLES.has(nu)) return w;
  const bas = strip(w).toLowerCase();
  if (LIEUX[bas]) return LIEUX[bas];
  if (!/[AEIOUY]/.test(nu) && nu.length <= 5) return w;   // RH, BTP, DRH, PDG
  if (nu.length <= 4 && !PETITS_MOTS.has(bas) && !ACCENTS[bas]) return w; // sigle inconnu court
  const minus = w.toLowerCase();
  // Accents seulement si le mot n'en avait pas (sinon on garde ceux de l'annonce).
  if (minus === bas && ACCENTS[bas]) return ACCENTS[bas];
  if (bas === "etat") return "État";
  return minus;
}

// Mots composés et apostrophes : « D'UN », « L'ETAT », « SAGE-FEMME ».
function morceau(tok: string): string {
  const ap = tok.match(/^([a-z]{1,3})(['’])(.+)$/i);
  if (ap && /^(d|l|qu|j|n|s|c|m|t|jusqu|lorsqu|puisqu)$/i.test(ap[1])) {
    return ap[1].toLowerCase() + ap[2] + morceau(ap[3]);
  }
  if (tok.includes("-")) {
    const entier = strip(tok).toLowerCase();
    if (LIEUX[entier]) return LIEUX[entier];
    if (ACCENTS[entier] && tok.toLowerCase() === entier) return ACCENTS[entier];
    return tok.split("-").map(mot).join("-");
  }
  return mot(tok);
}

// « H/F », « h / f », « (H/F) », « F/H » → « (H/F) » une seule fois, à la fin du groupe.
function hommesFemmes(s: string): string {
  return s
    .replace(/\s*[([]?\s*\b([HF])\s*\/\s*([HF])\b\s*[)\]]?/gi, (m, a: string, b: string) =>
      a.toUpperCase() !== b.toUpperCase() ? " (H/F)" : m)
    .replace(/^\s+/, "");
}

// Remet le nom de l'employeur tel qu'il l'écrit lui-même (« Orange Mali », « UNICEF »).
function employeur(titre: string, org: string | null | undefined): string {
  if (!org || org.length < 2 || org.length > 80) return titre;
  let bon = org.trim();
  if (crie(bon)) bon = bon.split(/(\s+)/).map((p) => (/\s/.test(p) ? p : p.split("-").map((x) => {
    const nu = strip(x).toUpperCase();
    const l = strip(x).toLowerCase();
    if (LIEUX[l]) return LIEUX[l];
    if (SIGLES.has(nu) || x.length <= 4 || !/[AEIOUY]/.test(nu)) return x;
    return capitale(x.toLowerCase());
  }).join("-"))).join("");
  const esc = bon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return titre.replace(new RegExp(`(^|[^\\p{L}])${esc}(?=$|[^\\p{L}])`, "iu"), (_m, avant: string) => avant + bon);
  } catch {
    return titre;
  }
}

export function tidyTitle(raw: string | null | undefined, org?: string | null): string {
  let s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (crie(s)) {
    s = s.replace(/[\p{L}\p{N}'’-]+/gu, (tok) => morceau(tok));
    s = s.replace(/\bc[oô]te d['’]ivoire\b/giu, "Côte d'Ivoire");
    s = employeur(s, org);
  }
  s = hommesFemmes(s);
  // Majuscule au début (« école » → « École »), même après un guillemet ou une puce.
  s = s.replace(/^([^\p{L}\p{N}]*)(\p{Ll})/u, (_m, a: string, b: string) => a + b.toUpperCase());
  return s;
}

// Le nom de l'employeur figure-t-il déjà dans le titre ? (pour ne pas le répéter sur la carte)
export function orgInTitle(title: string, org: string | null | undefined): boolean {
  if (!org) return false;
  const n = (x: string) => ` ${strip(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const o = n(org).trim();
  return o.length >= 2 && n(title).includes(` ${o} `);
}

// Intitulé du poste seul : « D2C SAS recrute contrôleur qualité (H/F) » → « Contrôleur qualité (H/F) ».
// Sert aux résumés « X recrute pour le poste « … » » qui répétaient le titre entier (24/11).
// Si le titre n'a pas la forme « … recrute … », il est rendu tel quel.
const RECRUTE_RE = /^(.{2,90}?)\s+(?:recrute(?:nt)?|is hiring|is recruiting|recruits|hiring)\s*(?:[:–-]\s*)?(?:(?:un|une|des|plusieurs|a|an)\s+)?(.{3,})$/iu;
export function posteSeul(title: string): string {
  const m = RECRUTE_RE.exec(title.trim());
  if (!m) return title;
  const poste = m[2].trim();
  return poste.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());
}

// Corrige un résumé déjà rangé en base : « … pour le poste « D2C SAS recrute contrôleur » … »
// devient « … pour le poste « Contrôleur … » … » (idem en anglais « position “…” »).
export function tidySummary(summary: string | null | undefined): string | null {
  if (!summary) return summary ?? null;
  return summary
    .replace(/(pour le poste « )([^»]+?)( »)/u, (_m, a: string, t: string, b: string) => a + posteSeul(t) + b)
    .replace(/(for the position “)([^”]+?)(”)/u, (_m, a: string, t: string, b: string) => a + posteSeul(t) + b);
}
