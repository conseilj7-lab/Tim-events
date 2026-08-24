/* Tim Event — socle de tests de non-régression (Playwright + oracle indépendant) */
const fs = require('fs');
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const HTML_PATH = process.env.TIMEV_HTML || path.join(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
const URL = 'https://app.test/index.html';

// ─────────────────────────────────────────────────────────────
//  Mini-framework
// ─────────────────────────────────────────────────────────────
const results = [];
let current = null;

function section(name) { results.push({ section: name, tests: [] }); }
function currentSection() { if (!results.length) section('Divers'); return results[results.length - 1]; }

async function test(name, fn) {
  const t = { name, ok: true, checks: 0, msgs: [] };
  current = t;
  currentSection().tests.push(t);
  try { await fn(); }
  catch (e) { t.ok = false; t.msgs.push('EXCEPTION ' + (e && e.message ? e.message : String(e))); }
  current = null;
  process.stdout.write((t.ok ? '  \u2713 ' : '  \u2717 ') + name + (t.ok ? ` (${t.checks})` : '') + '\n');
  if (!t.ok) t.msgs.forEach(m => process.stdout.write('      → ' + m + '\n'));
}

function ok(cond, msg) {
  current.checks++;
  if (!cond) { current.ok = false; current.msgs.push(msg); }
  return !!cond;
}
function eq(a, b, msg) { return ok(a === b, `${msg} — attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }
function near(a, b, msg, tol = 0.005) {
  return ok(Math.abs(Number(a) - Number(b)) <= tol, `${msg} — attendu ~${b}, obtenu ${a}`);
}
function includes(hay, needle, msg) {
  return ok(String(hay).includes(needle), `${msg} — "${needle}" absent`);
}
function notIncludes(hay, needle, msg) {
  return ok(!String(hay).includes(needle), `${msg} — "${needle}" présent alors qu'il ne devrait pas`);
}

// ─────────────────────────────────────────────────────────────
//  Oracle indépendant (réécrit d'après la spec, pas depuis l'app)
// ─────────────────────────────────────────────────────────────
const N = (v, d = 0) => { const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? d : n; };
const r2 = n => Math.round((N(n) + Number.EPSILON) * 100) / 100;
const ceilTo = (n, s) => { s = N(s); return s <= 0 ? N(n) : Math.ceil((N(n) - 1e-9) / s) * s; };

function oracleSupplements(sel, P) {
  const S = P.supplements, out = []; let waitH = 0;
  const pos = v => Math.max(0, N(v));
  sel = sel || {};
  if (sel.nappage) { const c = pos(sel.nappage.convives); const m = c > 0 ? Math.max(c * N(S.nappage.parConvive), N(S.nappage.min)) : 0; if (m > 0) out.push({ code: 'nappage', montant: r2(m) }); }
  if (sel.etageSansAsc) { const m = pos(sel.etageSansAsc.niveaux) * N(S.etageSansAsc.parNiveau); if (m > 0) out.push({ code: 'etageSansAsc', montant: r2(m) }); }
  if (sel.creneauImpose) { const m = N(S.creneauImpose.montant); if (m > 0) out.push({ code: 'creneauImpose', montant: r2(m) }); }
  if (sel.repriseDimanche) { const m = N(S.repriseDimanche.montant); if (m > 0) out.push({ code: 'repriseDimanche', montant: r2(m) }); }
  if (sel.portageLong) { const m = N(S.portageLong.montant); if (m > 0) out.push({ code: 'portageLong', montant: r2(m) }); }
  if (sel.attente) { waitH = Math.max(0, pos(sel.attente.heures) - N(S.attente.franchiseMin) / 60); const m = waitH * N(S.attente.parHeure); if (m > 0) out.push({ code: 'attente', montant: r2(m) }); }
  return { list: out, total: r2(out.reduce((a, x) => a + x.montant, 0)), waitH };
}

/** Oracle : reproduit les 5 règles de prix, indépendamment du code de l'app. */
function oracleLivraison(input, P) {
  const mode = input.mode || 'aller_retour';
  const tva = N(P.tva) / 100;
  const sup = oracleSupplements(input.supplements, P);
  const negoSet = input.prixNegocieHT != null && input.prixNegocieHT !== '' && !isNaN(parseFloat(input.prixNegocieHT));
  const nego = negoSet ? Math.max(0, N(input.prixNegocieHT)) : null;
  const dist = Math.max(0, N(input.distanceKm));

  if (mode === 'retrait') {
    return { mode, offerte: false, horsZone: false, prixRetenuHT: 0, supplementsHT: 0, totalHT: 0, totalTTC: 0, margeEur: 0, margeNegative: false, motifPrix: 'retrait' };
  }
  const trajets = mode === 'aller_retour' ? (N(P.nbTrajetsAR) || 1) : (N(P.nbTrajetsLivraison) || 1);
  const manut = mode === 'aller_retour' ? N(P.manutentionAR) : N(P.manutentionLivraison);
  const vit = N(P.vitesseMoyenne) || 1;
  const km = r2(dist * trajets);
  const tempsH = manut / 60 + km / vit + sup.waitH;
  const cout = km * N(P.coutKm) + tempsH * N(P.coutHoraire) + N(P.coutStructure);
  const prixBaseHT = ceilTo(cout * (1 + N(P.marge)), P.arrondi);
  const minimumHT = ceilTo(prixBaseHT * N(P.coefMinCommande), P.arrondiMin);
  const horsZone = dist > N(P.rayonMax);

  if (horsZone && !negoSet) {
    return { mode, offerte: false, horsZone: true, prixRetenuHT: 0, prixBaseHT, minimumHT, coutRevient: r2(cout), kmParcourus: km, tempsH: r2(tempsH), supplementsHT: sup.total, totalHT: 0, totalTTC: 0, margeEur: 0, margeNegative: false, motifPrix: 'surmesure' };
  }
  const seuil = N(P.seuilLivraisonOfferte);
  let prix, motif, offerte = false;
  if (negoSet) { prix = nego; motif = 'negocie'; }
  else if (seuil > 0 && N(input.montantLocationHT) >= seuil) { prix = 0; offerte = true; motif = 'offerte'; }
  else { prix = prixBaseHT; motif = 'calcule'; }
  const totalHT = r2(prix + sup.total);
  const margeEur = r2(prix - cout);
  const margePct = cout > 0 ? r2((prix - cout) / cout * 100) : (prix > 0 ? 100 : 0);
  const seuilAl = P.seuilAlerteMarge == null ? 15 : N(P.seuilAlerteMarge);
  return {
    mode, offerte, horsZone, motifPrix: motif, trajets, kmParcourus: km, tempsH: r2(tempsH),
    coutRevient: r2(cout), prixBaseHT, prixRetenuHT: r2(prix), minimumHT,
    supplementsHT: sup.total, totalHT, totalTTC: r2(totalHT * (1 + tva)),
    margeEur, margePct,
    margeAlerte: !offerte && margeEur >= 0 && margePct < seuilAl,
    margeNegative: !offerte && margeEur < 0,
    sousMinimum: !offerte && N(input.montantLocationHT) < minimumHT
  };
}

// Paramètres de référence (miroir de DEFAULT_DB().settings.livraison, TVA = taux société)
function refParams(over) {
  return Object.assign({
    actif: true, depot: { label: 'Dépôt', lat: 45.75, lon: 4.85 }, proxyUrl: '',
    coutKm: 0.494, coutHoraire: 21.94, vitesseMoyenne: 55,
    manutentionAR: 105, manutentionLivraison: 50,
    nbTrajetsAR: 4, nbTrajetsLivraison: 2,
    coutStructure: 15, marge: 0.25, arrondi: 10,
    coefMinCommande: 2.2, arrondiMin: 50,
    seuilLivraisonOfferte: 900, rayonMax: 120, tva: 0, seuilAlerteMarge: 15,
    supplements: {
      nappage: { actif: true, parConvive: 1.20, min: 100 },
      etageSansAsc: { actif: true, parNiveau: 40 },
      creneauImpose: { actif: true, montant: 50 },
      repriseDimanche: { actif: true, montant: 80 },
      portageLong: { actif: true, montant: 40 },
      attente: { actif: true, parHeure: 35, franchiseMin: 30 }
    }
  }, over || {});
}

// ─────────────────────────────────────────────────────────────
//  Base de données de test
// ─────────────────────────────────────────────────────────────
function baseDB(over) {
  const db = {
    clients: [
      { id: 101, prenom: 'Julie', nom: 'Martin', societe: '', typeClient: 'part', email: 'julie@test.fr', tel: '0601020304', adresse: '12 rue des Fleurs', cp: '69003', ville: 'Lyon', notes: '' },
      { id: 102, prenom: 'Paul', nom: 'Durand', societe: 'Durand SAS', typeClient: 'pro', siret: '12345678901234', email: 'paul@durand.fr', tel: '0605060708', adresse: '5 avenue Foch', cp: '69006', ville: 'Lyon', notes: '' }
    ],
    reservations: [], stock: [], devis: [], factures: [], paiements: [], activity: [], audit: [],
    stops: [], bons: [], events: [],
    settings: {
      nom: 'Tim Event', siret: '12345678901234', tvaRate: 0,
      livraison: { depot: { label: 'Dépôt Villeurbanne', lat: 45.77, lon: 4.88 }, proxyUrl: '' }
    },
    counters: { dv: 1, fac: 1, bc: 1 },
    distanceCache: {}
  };
  return Object.assign(db, over || {});
}

// ─────────────────────────────────────────────────────────────
//  Ouverture d'une app neuve
// ─────────────────────────────────────────────────────────────
async function openApp(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  const netCalls = [];

  await ctx.route('https://fonts.googleapis.com/**', r => r.abort());
  await ctx.route('https://fonts.gstatic.com/**', r => r.abort());
  await ctx.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  await ctx.route('https://app.test/manifest.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"name":"Tim Event"}' }));

  // BAN (géocodage) — mock
  await ctx.route('https://api-adresse.data.gouv.fr/**', route => {
    netCalls.push('ban');
    if (opts.banDown) return route.fulfill({ status: 500, body: 'ko' });
    const u = new global.URL(route.request().url());
    const q = u.searchParams.get('q') || '';
    const limit = Number(u.searchParams.get('limit') || 5);
    const feats = [];
    for (let i = 0; i < Math.min(limit, 3); i++) {
      feats.push({
        properties: { label: q + (i ? ' — variante ' + i : ''), id: '69003_1234_' + i },
        geometry: { coordinates: [4.86 + i / 100, 45.75 + i / 100] }
      });
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: feats }) });
  });

  // Mini-proxy distance — mock
  await ctx.route('https://proxy.test/**', route => {
    netCalls.push('proxy');
    if (opts.proxyDown) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"ko"}' });
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ km: opts.proxyKm == null ? 42.4 : opts.proxyKm, provider: 'google' }) });
  });

  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const IGNORE = /Failed to load resource|fetching the script|ServiceWorker|manifest|net::ERR_FAILED/i;
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.addInitScript(([dbStr, raw, sess]) => {
    try {
      if (dbStr !== null) localStorage.setItem('tim_ev', dbStr);
      if (raw) Object.keys(raw).forEach(k => localStorage.setItem(k, raw[k]));
      if (sess) sessionStorage.setItem('tim_sess', JSON.stringify({ unlocked: true, expires: Date.now() + 36e5 }));
    } catch (e) { }
  }, [opts.db === null ? null : JSON.stringify(opts.db || baseDB()), opts.rawStorage || null, !opts.noSession]);

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof db !== 'undefined' && document.getElementById('app'));
  return { ctx, page, errors, netCalls };
}

// ─────────────────────────────────────────────────────────────
//  Helpers UI devis
// ─────────────────────────────────────────────────────────────
async function openDevisModal(page, clientId) {
  await page.evaluate(() => { go('devis'); modalDevis(); });
  await page.waitForSelector('#dv-client');
  if (clientId) await page.selectOption('#dv-client', String(clientId));
}
async function openEditDevis(page, dvId) {
  await page.evaluate(id => { go('devis'); editDv(id); }, dvId);
  await page.waitForSelector('#dv-client');
}
async function lineIds(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[id^="dl-qty-"]')).map(e => e.id.replace('dl-qty-', '')));
}
async function setLine(page, i, { qty, prix, desc, rem, remT }) {
  const ids = await lineIds(page);
  const id = ids[i];
  if (desc != null) await page.evaluate(([id, d]) => { document.getElementById('dl-desc-' + id).value = d; }, [id, desc]);
  if (qty != null) await page.fill('#dl-qty-' + id, String(qty));
  if (prix != null) await page.fill('#dl-prix-' + id, String(prix));
  if (remT) await page.click('#dl-' + (remT === 'eur' ? 're' : 'rp') + '-' + id);
  if (rem != null) await page.fill('#dl-rem-' + id, String(rem));
  await page.evaluate(() => calcDvTotal());
}
async function fillLiv(page, o) {
  o = o || {};
  if (o.mode) await page.click('#dv-liv-m' + ({ retrait: 'r', livraison: 'l', aller_retour: 'ar' })[o.mode]);
  // en mode retrait le corps de la section est replié : rien d'autre à saisir
  if (await page.evaluate(() => document.getElementById('dv-liv-mode').value) === 'retrait') { await page.evaluate(() => calcDvTotal()); return; }
  if (o.addr != null) await page.fill('#dv-liv-addr', o.addr);
  if (o.dist != null) await page.fill('#dv-liv-dist', String(o.dist));
  const S = o.sup || {};
  if (S.nappage != null) { await page.setChecked('#dv-liv-nap', true); await page.fill('#dv-liv-nap-c', String(S.nappage)); }
  if (S.etage != null) { await page.setChecked('#dv-liv-eta', true); await page.fill('#dv-liv-eta-n', String(S.etage)); }
  if (S.creneau) await page.setChecked('#dv-liv-cre', true);
  if (S.dimanche) await page.setChecked('#dv-liv-dim', true);
  if (S.portage) await page.setChecked('#dv-liv-por', true);
  if (S.attente != null) { await page.setChecked('#dv-liv-att', true); await page.fill('#dv-liv-att-h', String(S.attente)); }
  if (o.nego !== undefined) await page.fill('#dv-liv-nego', o.nego == null ? '' : String(o.nego));
  await page.evaluate(() => calcDvTotal());
}
const money = s => N(String(s).replace(/[^\d,.-]/g, '').replace(',', '.'));
async function readTotals(page) {
  return page.evaluate(() => ({
    st: document.getElementById('dv-st').textContent,
    ht: document.getElementById('dv-ht').textContent,
    ttc: document.getElementById('dv-ttc').textContent
  }));
}
async function toasts(page) { return page.evaluate(() => document.getElementById('toasts').textContent); }
async function clearToasts(page) { await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; }); }

module.exports = {
  chromium, HTML, URL, results, section, test, ok, eq, near, includes, notIncludes,
  N, r2, ceilTo, oracleLivraison, oracleSupplements, refParams, baseDB, openApp,
  openDevisModal, openEditDevis, lineIds, setLine, fillLiv, readTotals, money, toasts, clearToasts
};
