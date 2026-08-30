/**
 * Tim Event — connecteur de messagerie (Cloudflare Worker)
 * ---------------------------------------------------------------
 * Rôle : recevoir les webhooks Meta (WhatsApp Cloud API + Instagram),
 * normaliser les messages, les stocker, et exposer une petite API JSON
 * à l'application Tim Event (fichier statique) qui ne détient aucun jeton.
 * Il relaie aussi les missions de livraison vers le téléphone du livreur
 * et récupère les bons signés (GET /mission/:code, POST /mission/:code/retour).
 *
 * Variables d'environnement (wrangler secret put …)
 *   APP_TOKEN          jeton partagé avec l'application (Authorization: Bearer …)
 *   META_VERIFY_TOKEN  jeton de vérification déclaré dans le tableau de bord Meta
 *   META_APP_SECRET    secret de l'app Meta (validation X-Hub-Signature-256)
 *   WA_TOKEN           jeton permanent WhatsApp Cloud API
 *   WA_PHONE_ID        identifiant du numéro WhatsApp expéditeur
 *   IG_TOKEN           jeton Instagram (API with Instagram Login)
 *   ALLOWED_ORIGIN     origine autorisée pour l'application (ex. https://timevent.pages.dev)
 *
 * Binding KV : MSG
 *
 * wrangler.toml
 *   name = "tim-event-messagerie"
 *   main = "worker.js"
 *   compatibility_date = "2026-01-01"
 *   kv_namespaces = [{ binding = "MSG", id = "…" }]
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
const IG_GRAPH = 'https://graph.instagram.com/v21.0';
const MAX_MSG = 200;          // messages conservés par conversation
const RETENTION_JOURS = 90;   // purge des conversations inactives

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return cors(env, new Response(null, { status: 204 }));

    // ── Webhooks Meta ──────────────────────────────────────────
    if (p === '/webhook/meta' && request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token && token === env.META_VERIFY_TOKEN) {
        return new Response(challenge || '', { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    }

    if (p === '/webhook/meta' && request.method === 'POST') {
      const brut = await request.text();
      if (!(await signatureValide(request, brut, env.META_APP_SECRET))) {
        return new Response('signature invalide', { status: 401 });
      }
      let corps;
      try { corps = JSON.parse(brut); } catch { return new Response('ok', { status: 200 }); }
      // Toujours répondre 200 rapidement : Meta réessaie sinon et finit par couper l'abonnement.
      ctx.waitUntil(ingerer(corps, env));
      return new Response('ok', { status: 200 });
    }

    // ── Entrée générique (TikTok via partenaire, Zapier, formulaire…) ──
    if (p === '/entrant' && request.method === 'POST') {
      if (!autorise(request, env)) return cors(env, json({ error: 'non autorisé' }, 401));
      const b = await request.json().catch(() => null);
      if (!b || !b.extId) return cors(env, json({ error: 'extId requis' }, 400));
      await ajouterMessage(env, {
        canal: b.canal || 'tiktok', extId: String(b.extId), nom: b.nom || 'Contact TikTok',
        handle: b.handle || '', tel: b.tel || ''
      }, { id: b.id || ('ext-' + Date.now()), sens: 'in', texte: String(b.texte || ''), ts: Number(b.ts) || Date.now() });
      return cors(env, json({ ok: true }));
    }

    // ── Missions livreur (le code fait office de clé : lien à usage restreint) ──
    if (p.startsWith('/mission/') && request.method === 'GET') {
      const code = p.split('/')[2];
      const m = await env.MSG.get('mi:' + code, 'json');
      return cors(env, m ? json({ mission: m }) : json({ error: 'mission introuvable ou expirée' }, 404));
    }
    if (/^\/mission\/[^/]+\/retour$/.test(p) && request.method === 'POST') {
      const code = p.split('/')[2];
      const mission = await env.MSG.get('mi:' + code, 'json');
      if (!mission) return cors(env, json({ error: 'mission inconnue' }, 404));
      const b = await request.json().catch(() => null);
      if (!b || b.t !== 'r') return cors(env, json({ error: 'bon illisible' }, 400));
      b.recu = Date.now();
      await env.MSG.put('re:' + code, JSON.stringify(b), { expirationTtl: 30 * 86400 });
      const idx = (await env.MSG.get('idxr', 'json')) || {};
      idx[code] = b.recu;
      await env.MSG.put('idxr', JSON.stringify(idx));
      return cors(env, json({ ok: true }));
    }

    // ── API consommée par l'application ────────────────────────
    if (!autorise(request, env)) return cors(env, json({ error: 'non autorisé' }, 401));

    if (p === '/mission' && request.method === 'POST') {
      const b = await request.json().catch(() => null);
      if (!b || !b.code || !b.mission) return cors(env, json({ error: 'code et mission requis' }, 400));
      await env.MSG.put('mi:' + b.code, JSON.stringify(b.mission), { expirationTtl: 7 * 86400 });
      return cors(env, json({ ok: true, code: b.code }));
    }

    if (p === '/retours' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const idx = (await env.MSG.get('idxr', 'json')) || {};
      const retours = [];
      for (const code of Object.keys(idx)) {
        if (idx[code] <= since) continue;
        const r = await env.MSG.get('re:' + code, 'json');
        if (r) retours.push(r);
      }
      return cors(env, json({ retours, now: Date.now() }));
    }

    if (p === '/etat') {
      const canaux = [];
      if (env.WA_TOKEN && env.WA_PHONE_ID) canaux.push('whatsapp');
      if (env.IG_TOKEN) canaux.push('instagram');
      canaux.push('tiktok (entrée manuelle)');
      return cors(env, json({ ok: true, canaux, now: Date.now() }));
    }

    if (p === '/threads' && request.method === 'GET') {
      const since = Number(url.searchParams.get('since') || 0);
      const idx = await lireIndex(env);
      const sorties = [];
      for (const cle of Object.keys(idx)) {
        if (idx[cle] <= since) continue;
        const t = await env.MSG.get('th:' + cle, 'json');
        if (!t) continue;
        sorties.push({
          canal: t.canal, extId: t.extId, nom: t.nom, handle: t.handle, tel: t.tel,
          messages: (t.messages || []).filter(m => m.ts > since)
        });
      }
      return cors(env, json({ threads: sorties, now: Date.now() }));
    }

    if (p === '/send' && request.method === 'POST') {
      const b = await request.json().catch(() => null);
      if (!b || !b.canal || !b.extId || !b.texte) return cors(env, json({ error: 'canal, extId et texte requis' }, 400));
      const texte = String(b.texte).slice(0, 4000);
      try {
        const r = b.canal === 'whatsapp' ? await envoyerWhatsApp(env, b.extId, texte)
                : b.canal === 'instagram' ? await envoyerInstagram(env, b.extId, texte)
                : { id: 'local-' + Date.now(), local: true };
        await ajouterMessage(env, { canal: b.canal, extId: String(b.extId) },
          { id: r.id, sens: 'out', texte, ts: Date.now(), auteur: 'moi' });
        return cors(env, json({ ok: true, id: r.id, local: !!r.local }));
      } catch (e) {
        return cors(env, json({ error: String(e.message || e) }, 502));
      }
    }

    if (p === '/purge' && request.method === 'POST') { await purger(env); return cors(env, json({ ok: true })); }

    return cors(env, json({ error: 'route inconnue' }, 404));
  },

  // Purge quotidienne (déclencheur cron facultatif)
  async scheduled(event, env) { await purger(env); }
};

// ── Sécurité ────────────────────────────────────────────────
function autorise(request, env) {
  const h = request.headers.get('Authorization') || '';
  return !!env.APP_TOKEN && h === 'Bearer ' + env.APP_TOKEN;
}
async function signatureValide(request, brut, secret) {
  if (!secret) return false;
  const entete = request.headers.get('X-Hub-Signature-256') || '';
  if (!entete.startsWith('sha256=')) return false;
  const cle = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cle, new TextEncoder().encode(brut));
  const attendu = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  const recu = entete.slice(7);
  if (recu.length !== attendu.length) return false;
  let diff = 0;                                   // comparaison à temps constant
  for (let i = 0; i < attendu.length; i++) diff |= attendu.charCodeAt(i) ^ recu.charCodeAt(i);
  return diff === 0;
}
function cors(env, res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return new Response(res.body, { status: res.status, headers: h });
}
function json(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }

// ── Normalisation des webhooks ──────────────────────────────
async function ingerer(corps, env) {
  const entries = corps.entry || [];
  for (const e of entries) {
    // WhatsApp Cloud API
    for (const ch of (e.changes || [])) {
      const v = ch.value || {};
      const profils = {};
      (v.contacts || []).forEach(c => { profils[c.wa_id] = (c.profile && c.profile.name) || ''; });
      for (const m of (v.messages || [])) {
        const texte = m.text ? m.text.body
          : m.button ? m.button.text
          : m.interactive ? JSON.stringify(m.interactive).slice(0, 200)
          : '[' + (m.type || 'média') + ']';
        await ajouterMessage(env,
          { canal: 'whatsapp', extId: m.from, nom: profils[m.from] || m.from, tel: '+' + m.from },
          { id: m.id, sens: 'in', texte, ts: Number(m.timestamp) * 1000 || Date.now(), auteur: 'client' });
      }
    }
    // Instagram (API with Instagram Login)
    for (const mg of (e.messaging || [])) {
      if (!mg.message || mg.message.is_echo) continue;
      const texte = mg.message.text || (mg.message.attachments ? '[pièce jointe]' : '');
      if (!texte) continue;
      await ajouterMessage(env,
        { canal: 'instagram', extId: mg.sender.id, nom: (mg.sender && mg.sender.username) || 'Contact Instagram', handle: mg.sender.username ? '@' + mg.sender.username : '' },
        { id: mg.message.mid, sens: 'in', texte, ts: Number(mg.timestamp) || Date.now(), auteur: 'client' });
    }
  }
}
async function ajouterMessage(env, contact, msg) {
  const cle = contact.canal + ':' + contact.extId;
  const t = (await env.MSG.get('th:' + cle, 'json')) || {
    canal: contact.canal, extId: contact.extId, nom: contact.nom || 'Contact',
    handle: contact.handle || '', tel: contact.tel || '', messages: []
  };
  if (contact.nom && !t.nom) t.nom = contact.nom;
  if (contact.tel && !t.tel) t.tel = contact.tel;
  if (contact.handle && !t.handle) t.handle = contact.handle;
  if (!t.messages.some(m => m.id === msg.id)) t.messages.push(msg);
  t.messages.sort((a, b) => a.ts - b.ts);
  if (t.messages.length > MAX_MSG) t.messages = t.messages.slice(-MAX_MSG);
  t.maj = Date.now();
  await env.MSG.put('th:' + cle, JSON.stringify(t));
  const idx = await lireIndex(env);
  idx[cle] = t.maj;
  await env.MSG.put('index', JSON.stringify(idx));
}
async function lireIndex(env) { return (await env.MSG.get('index', 'json')) || {}; }
async function purger(env) {
  const idx = await lireIndex(env), limite = Date.now() - RETENTION_JOURS * 86400000, garde = {};
  for (const cle of Object.keys(idx)) {
    if (idx[cle] < limite) await env.MSG.delete('th:' + cle);
    else garde[cle] = idx[cle];
  }
  await env.MSG.put('index', JSON.stringify(garde));
}

// ── Envoi ───────────────────────────────────────────────────
async function envoyerWhatsApp(env, destinataire, texte) {
  if (!env.WA_TOKEN || !env.WA_PHONE_ID) throw new Error('WhatsApp non configuré');
  const r = await fetch(GRAPH + '/' + env.WA_PHONE_ID + '/messages', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.WA_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual',
      to: String(destinataire).replace(/[^0-9]/g, ''), type: 'text', text: { preview_url: false, body: texte } })
  });
  const j = await r.json();
  // Hors fenêtre de 24 h, Meta refuse le texte libre : le message doit passer par un modèle approuvé.
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return { id: (j.messages && j.messages[0] && j.messages[0].id) || ('wa-' + Date.now()) };
}
async function envoyerInstagram(env, destinataire, texte) {
  if (!env.IG_TOKEN) throw new Error('Instagram non configuré');
  const r = await fetch(IG_GRAPH + '/me/messages', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.IG_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: String(destinataire) }, message: { text: texte } })
  });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return { id: j.message_id || ('ig-' + Date.now()) };
}
