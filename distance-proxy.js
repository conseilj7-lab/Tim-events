/**
 * Tim Event — Mini-proxy « distance routière »
 * ------------------------------------------------------------
 * Rôle : garder la clé Google/Mapbox CÔTÉ SERVEUR (jamais dans l'app),
 * et renvoyer la distance routière aller simple en km.
 *
 * L'app Tim Event l'appelle ainsi :
 *   GET https://<votre-worker>.workers.dev/distance?o=45.77,4.88&d=48.85,2.35
 *   → réponse : { "km": 462.3, "provider": "google" }
 *
 * ------------------------------------------------------------
 * DÉPLOIEMENT (Cloudflare Workers — gratuit, ~2 min) :
 *   1. https://dash.cloudflare.com → Workers & Pages → Create Worker
 *   2. Collez ce fichier, cliquez « Deploy »
 *   3. Settings → Variables → ajoutez UNE des deux :
 *        GOOGLE_KEY  = votre clé Google Distance Matrix
 *        MAPBOX_KEY  = votre token Mapbox
 *      (si aucune n'est définie, le proxy utilise OSRM public — non-prod)
 *   4. Copiez l'URL du worker (…workers.dev) dans Tim Event →
 *      Paramètres → Livraison → « URL du mini-proxy ».
 *
 * Alternative Vercel : exportez `handler` dans /api/distance.js.
 * ------------------------------------------------------------
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const o = (url.searchParams.get('o') || '').split(',').map(Number); // [lat, lon] dépôt
    const d = (url.searchParams.get('d') || '').split(',').map(Number); // [lat, lon] client

    if (o.length !== 2 || d.length !== 2 || o.some(isNaN) || d.some(isNaN)) {
      return json({ error: 'Paramètres o et d requis : o=lat,lon&d=lat,lon' }, 400);
    }

    try {
      let meters = null, provider = null;

      if (env.GOOGLE_KEY) {
        // Google Distance Matrix — distance routière réelle
        const g = `https://maps.googleapis.com/maps/api/distancematrix/json`
          + `?origins=${o[0]},${o[1]}&destinations=${d[0]},${d[1]}`
          + `&mode=driving&units=metric&key=${env.GOOGLE_KEY}`;
        const r = await fetch(g);
        const j = await r.json();
        const el = j.rows?.[0]?.elements?.[0];
        if (el?.status === 'OK') { meters = el.distance.value; provider = 'google'; }
      } else if (env.MAPBOX_KEY) {
        // Mapbox Directions (lon,lat !)
        const m = `https://api.mapbox.com/directions/v5/mapbox/driving/`
          + `${o[1]},${o[0]};${d[1]},${d[0]}?overview=false&access_token=${env.MAPBOX_KEY}`;
        const r = await fetch(m);
        const j = await r.json();
        if (j.routes?.[0]) { meters = j.routes[0].distance; provider = 'mapbox'; }
      } else {
        // Repli OSRM public — démonstration, pas de SLA, usage raisonnable
        const s = `https://router.project-osrm.org/route/v1/driving/`
          + `${o[1]},${o[0]};${d[1]},${d[0]}?overview=false`;
        const r = await fetch(s);
        const j = await r.json();
        if (j.routes?.[0]) { meters = j.routes[0].distance; provider = 'osrm'; }
      }

      if (meters == null) return json({ error: 'Itinéraire introuvable' }, 502);
      return json({ km: Math.round((meters / 1000) * 10) / 10, provider });
    } catch (e) {
      return json({ error: 'Erreur amont : ' + e.message }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/* ---- Variante Vercel (décommenter et placer dans /api/distance.js) ----
export default async function handler(req, res) {
  const proxy = (await import('./distance-proxy.js')).default;
  const url = new URL(req.url, `https://${req.headers.host}`);
  const out = await proxy.fetch(new Request(url, { method: req.method }), process.env);
  res.status(out.status);
  out.headers.forEach((v, k) => res.setHeader(k, v));
  res.send(await out.text());
}
------------------------------------------------------------------------- */
