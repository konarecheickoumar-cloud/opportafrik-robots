import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { config } from './config.ts';

// Notifications sur le téléphone : après chaque passage des robots, chaque abonné
// reçoit au plus une alerte toutes les 6 heures, de 7 h à 21 h (heure de Bamako,
// = UTC), avec le nombre de nouvelles offres de son pays et la plus récente.
// Les clés VAPID sont créées au premier passage et rangées dans la base.
//   npm run push            → envoi normal
//   npm run push -- --cles  → seulement créer les clés (aucun envoi)

const SITE = 'https://www.opportafrik.com';
const SLUG: Record<string, string> = {
  ML: 'mali', SN: 'senegal', CI: 'cote-d-ivoire', BF: 'burkina-faso',
  GN: 'guinee', NE: 'niger', TG: 'togo', BJ: 'benin',
};
const NAME: Record<string, [string, string]> = {
  ML: ['au Mali', 'in Mali'], SN: ['au Sénégal', 'in Senegal'], CI: ["en Côte d'Ivoire", "in Côte d'Ivoire"],
  BF: ['au Burkina Faso', 'in Burkina Faso'], GN: ['en Guinée', 'in Guinea'], NE: ['au Niger', 'in Niger'],
  TG: ['au Togo', 'in Togo'], BJ: ['au Bénin', 'in Benin'],
};

type Sub = { endpoint: string; p256dh: string; auth: string; country_code: string | null; locale: string; last_sent_at: string | null; created_at: string };
type Row = { slug: string; country_slug: string | null; title: string; organization_name: string | null; created_at: string; category: string };

async function main() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    console.log('Notifications : pas de base (mode essai).');
    return;
  }
  const db = createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false } });

  const { data: keys, error: kErr } = await db.rpc('push_keys');
  if (kErr) {
    console.log('Notifications : base pas encore à jour (migration 062).', kErr.message);
    return;
  }
  let { public: pub, private: priv } = (keys ?? {}) as { public: string | null; private: string | null };
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    const { error } = await db.rpc('push_save_keys', { p_public: k.publicKey, p_private: k.privateKey });
    if (error) throw error;
    pub = k.publicKey; priv = k.privateKey;
    console.log('Notifications : clés créées.');
  }
  if (process.argv.includes('--cles')) return;

  const hour = new Date().getUTCHours();
  if (hour < 7 || hour >= 21) {
    console.log('Notifications : la nuit, on ne dérange personne.');
    return;
  }
  webpush.setVapidDetails('mailto:contact@opportafrik.com', pub, priv);

  const { data: stats } = await db.rpc('push_stats');
  console.log('Notifications : abonnés par pays', JSON.stringify(stats));
  const { data: due, error } = await db.rpc('push_due');
  if (error) throw error;
  const subs = (due ?? []) as Sub[];
  if (!subs.length) return;

  // Offres récentes par pays (la même recherche que le site).
  const latest = new Map<string | null, Row[]>();
  for (const code of new Set(subs.map((s) => s.country_code))) {
    const { data } = await db.rpc('search_opportunities', { p_country: code, p_limit: 50 });
    latest.set(code, ((data ?? []) as Row[]).filter((o) => ['emploi', 'stage', 'concours', 'ong-international', 'bourse', 'volontariat'].includes(o.category)));
  }

  const sent: string[] = [];
  let gone = 0, failed = 0;
  for (const s of subs) {
    const since = Date.parse(s.last_sent_at ?? s.created_at);
    const fresh = (latest.get(s.country_code) ?? []).filter((o) => Date.parse(o.created_at) > since);
    if (!fresh.length) continue;
    const en = s.locale === 'en';
    const where = s.country_code && NAME[s.country_code] ? NAME[s.country_code][en ? 1 : 0] : en ? 'in Africa' : 'en Afrique';
    const top = fresh[0];
    const n = fresh.length;
    const payload = JSON.stringify({
      title: en ? `${n} new opportunit${n > 1 ? 'ies' : 'y'} ${where}` : `${n} nouvelle${n > 1 ? 's' : ''} offre${n > 1 ? 's' : ''} ${where}`,
      body: `${top.title}${top.organization_name ? ` · ${top.organization_name}` : ''}`.slice(0, 160),
      url: `${SITE}${en ? '/en' : ''}/${s.country_code ? SLUG[s.country_code] ?? 'afrique' : 'afrique'}?src=push`,
    });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
      sent.push(s.endpoint);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) {
        await db.rpc('push_unsubscribe', { p_endpoint: s.endpoint });
        gone++;
      } else failed++;
    }
  }
  if (sent.length) await db.rpc('push_mark', { p_endpoints: sent });
  console.log(`Notifications : ${sent.length} envoyée(s), ${gone} abonnement(s) expiré(s) retiré(s), ${failed} échec(s).`);
}

main().catch((e) => console.log('Notifications : envoi impossible', e?.message ?? e));
