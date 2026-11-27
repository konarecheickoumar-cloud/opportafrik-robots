// Ce qu'un robot rapporte pour une offre. Le texte lu (`text`) sert seulement
// à classer et résumer l'offre : il n'est jamais enregistré.
export type ContractType =
  | 'cdi' | 'cdd' | 'temps_partiel' | 'consultance' | 'stage' | 'volontariat'
  | 'freelance' | 'autre' | 'non_precise';

export interface FoundOffer {
  url: string;
  title: string;
  organization_name?: string;
  organization_website?: string;   // site de l'employeur (sert à afficher son logo)
  organization_logo?: string;      // image du logo de l'employeur, si la source la donne
  country_code?: string | null;
  city?: string;
  country_hint?: string;   // pays indiqué par la page, pour écarter les offres hors du pays visé
  published_at?: string;
  deadline_at?: string;
  contract_type?: ContractType;
  category?: string;
  language?: string;
  is_remote?: boolean;
  text?: string;
}

// Une offre prête à être rangée dans la base (format attendu par ingest_opportunity).
export interface ReadyOffer extends Omit<FoundOffer, 'text' | 'country_hint'> {
  source_id: number | null;
  region_slug?: string;
  summary: string;
  suspicion_score: number;
  suspicion_reasons: string[];
}

export interface Source {
  id: number | null;
  name: string;
  country_code: string | null;
  base_url: string;
  feed_url: string | null;
  method: 'api' | 'rss' | 'sitemap' | 'html' | 'manuel';
  frequency_minutes: number;
  default_category: string | null;
  last_run_at: string | null;
}

export interface CollectContext {
  // Liens déjà connus : le robot ne rouvre pas ces pages.
  isKnown: (url: string) => boolean;
  log: (message: string) => void;
  // Retenir une offre écartée (autre pays…) pour ne pas la rouvrir au prochain passage.
  skip?: (url: string) => Promise<void>;
}

export type Collector = (source: Source, ctx: CollectContext) => Promise<FoundOffer[]>;
