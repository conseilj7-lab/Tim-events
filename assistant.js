/* Tim Event — suite de non-régression « Assistant de saisie » (Phase 3) */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const {
  chromium, results, section, test, ok, eq, near, includes, notIncludes,
  N, baseDB, openApp, toasts, clearToasts
} = L;

// Base de test : clients + stock + tarifs alignés
function dbAssist(over) {
  const d = baseDB();
  d.stock = [
    { id: 201, nom: 'Chaise napoléonienne', categorie: 'Mobilier', unite: 'unité', total: 200, reserve: 0, seuil: 20, prix: 2.5, notes: '' },
    { id: 202, nom: 'Table ronde 150cm', categorie: 'Mobilier', unite: 'unité', total: 20, reserve: 0, seuil: 4, prix: 10, notes: '' },
    { id: 203, nom: 'Nappage blanc', categorie: 'Textile', unite: 'unité', total: 100, reserve: 0, seuil: 15, prix: 5, notes: '' },
    { id: 204, nom: 'Nappage doré / champagne', categorie: 'Textile', unite: 'unité', total: 80, reserve: 0, seuil: 10, prix: 6, notes: '' },
    { id: 205, nom: 'Arche florale', categorie: 'Décoration', unite: 'unité', total: 3, reserve: 0, seuil: 1, prix: 120, notes: '' }
  ];
  d.tarifs = [
    { id: 1, nom: 'Chaise napoléonienne', unite: 'unité', prix: 2.5 },
    { id: 2, nom: 'Table rectangulaire 180cm', unite: 'unité', prix: 8 },
    { id: 3, nom: 'Table ronde 150cm', unite: 'unité', prix: 10 },
    { id: 4, nom: 'Nappage blanc', unite: 'unité', prix: 5 },
    { id: 5, nom: 'Nappage doré / champagne', unite: 'unité', prix: 6 },
    { id: 9, nom: 'Arche florale', unite: 'unité', prix: 120 },
    { id: 11, nom: 'Sono + micro HF', unite: 'jour', prix: 80 }
  ];
  d.settings.livraison = Object.assign(d.settings.livraison || {}, { actif: true, proxyUrl: '' });
  return Object.assign(d, over || {});
}

const jour = (page, n) => page.evaluate(k => (k ? addDays(today(), k) : today()), n);

// Analyse dans la page (moteur pur)
const P = (page, txt, over) => page.evaluate(([t, o]) => {
  const ctx = Object.assign(assistCtx(), o || {});
  return TimNLU.parseAll(t, ctx);
}, [txt, over || null]);

// Chaîne complète : saisie → analyse → fiche pré-remplie
async function dicte(page, txt) {
  await page.evaluate(t => {
    assistOpen();
    document.getElementById('as-txt').value = t;
    assistAnalyse();
  }, txt);
  await page.waitForSelector('#as-res .as-card', { timeout: 3000 });
}
async function applique(page) {
  await page.evaluate(() => assistAppliquer());
  await page.waitForTimeout(320);
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();

  // ═══════════════════════════════════════════════════════════
  section('K · Moteur de compréhension (fonction pure)');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser, { db: dbAssist() });

    await test('K1 — nature de l\'acte reconnue sur 18 formulations courantes', async () => {
      const cas = [
        ['Fais un devis pour Julie Martin, 100 chaises', 'devis'],
        ['Chiffre-moi 80 chaises pour Paul Durand', 'devis'],
        ['Réserve 80 chaises pour Julie Martin samedi', 'reservation'],
        ['Bloque 20 tables rondes pour Paul Durand le 12 septembre', 'reservation'],
        ['Nouvelle cliente Sophie Bernard 06 12 34 56 78', 'client'],
        ['Ajoute le contact Marc Petit, 04 78 00 11 22', 'client'],
        ['Facture les 100 chaises à Julie Martin', 'facture'],
        ['Paul Durand a payé 1200 € par virement', 'paiement'],
        ['Encaisser 500 euros en chèque sur la facture FAC-0001', 'paiement'],
        ['Planifie une livraison chez Julie Martin demain à 8h', 'arret'],
        ['Arrêt de tournée mardi 14h chez Paul Durand', 'arret'],
        ['Prépare un bon de commande pour Julie Martin, 50 chaises', 'bon'],
        ['J\'ai reçu 50 chaises napoléoniennes', 'ajustement'],
        ['5 nappages blancs cassés', 'ajustement'],
        ['Nouvel article de stock : parasol chauffant', 'stock'],
        ['Le devis DEV-0001 est accepté', 'statut'],
        ['Marque la réservation de Paul Durand comme terminée', 'statut'],
        ['Il fait beau aujourd\'hui', 'inconnu']
      ];
      let ko = 0;
      for (const [txt, attendu] of cas) {
        const r = await P(app.page, txt);
        if (r.type !== attendu) { if (ko++ < 5) ok(false, `« ${txt} » → ${r.type} (attendu ${attendu})`); }
      }
      ok(ko === 0, ko ? `${ko} formulations mal classées` : '');
      eq(ko, 0, 'formulations mal classées');
    });

    await test('K2 — nombres en toutes lettres et en chiffres', async () => {
      const cas = [['quatre-vingts', 80], ['quatre-vingt-dix-sept', 97], ['cent vingt', 120],
      ['deux cent cinquante', 250], ['mille deux cents', 1200], ['deux mille vingt-six', 2026],
      ['soixante-dix-sept', 77], ['1 250,50', 1250.5], ['12', 12]];
      const got = await app.page.evaluate(cs => cs.map(c => TimNLU.litNombre(c[0])), cas);
      cas.forEach((c, i) => eq(got[i], c[1], `« ${c[0] } »`));
    });

    await test('K3 — dates relatives, absolues et jours de la semaine', async () => {
      const T = '2026-08-29'; // un samedi
      const cas = [
        ['on livre demain', '2026-08-30'],
        ['après-demain', '2026-08-31'],
        ['hier', '2026-08-28'],
        ['le 12 septembre', '2026-09-12'],
        ['le 12/09/2026', '2026-09-12'],
        ['mariage le 3 octobre', '2026-10-03'],
        ['lundi prochain', '2026-08-31'],
        ['dans 3 semaines', '2026-09-19'],
        ['la semaine prochaine', '2026-09-05'],
        ['fin septembre', '2026-09-27'],
        ['le 15 janvier', '2027-01-15']   // date passée cette année → année suivante
      ];
      const got = await app.page.evaluate(([cs, t]) => cs.map(c => { const d = TimNLU.parseDateFr(c[0], t, 'futur'); return d ? d.iso : null; }), [cas, T]);
      cas.forEach((c, i) => eq(got[i], c[1], `date « ${c[0]} »`));
    });

    await test('K4 — heures : 8h30, huit heures et demie, midi, 18 h', async () => {
      const cas = [['à 8h30', '08:30'], ['à 8 h', '08:00'], ['huit heures et demie', '08:30'],
      ['à midi', '12:00'], ['18 heures', '18:00'], ['14:15', '14:15'], ['6h du soir', '18:00']];
      const got = await app.page.evaluate(cs => cs.map(c => { const h = TimNLU.parseHeureFr(c[0]); return h ? h.heure : null; }), cas);
      cas.forEach((c, i) => eq(got[i], c[1], `heure « ${c[0]} »`));
    });

    await test('K5 — montants, pourcentages, téléphone, email, adresse', async () => {
      const r = await app.page.evaluate(() => ({
        m1: TimNLU.montants('un acompte de 1 250,50 € HT')[0],
        m2: TimNLU.montants('deux mille euros')[0],
        m3: TimNLU.montants('deux euros cinquante')[0],
        p: TimNLU.pourcents('remise de 10 %')[0],
        t1: TimNLU.telephone('appelle le 06 12 34 56 78'),
        t2: TimNLU.telephone('+33 6 12 34 56 78'),
        e1: TimNLU.email('écris à julie@test.fr'),
        e2: TimNLU.email('sophie point bernard arobase gmail point com'),
        a: TimNLU.adresse('livraison au 12 rue des Fleurs 69003 Lyon')
      }));
      eq(r.m1.v, 1250.5, 'montant décimal'); eq(r.m1.ht, true, 'mention HT');
      eq(r.m2.v, 2000, 'montant en lettres');
      eq(r.m3.v, 2.5, '« deux euros cinquante »');
      eq(r.p.v, 10, 'pourcentage');
      eq(r.t1, '0612345678', 'téléphone espacé');
      eq(r.t2, '0612345678', 'téléphone +33');
      eq(r.e1, 'julie@test.fr', 'email direct');
      eq(r.e2, 'sophie.bernard@gmail.com', 'email dicté');
      eq(r.a.cp, '69003', 'code postal'); eq(r.a.ville, 'Lyon', 'ville');
      includes(r.a.adresse, 'rue des Fleurs', 'voie');
    });

    await test('K6 — catalogue : pluriels, synonymes, fautes de dictée, ambiguïté', async () => {
      const r = await app.page.evaluate(() => {
        const ctx = assistCtx();
        const m = q => { const x = TimNLU.matchArticle(q, ctx); return { nom: x.best ? x.best.item.nom : null, opts: (x.options || []).length }; };
        return { a: m('chaises'), b: m('chaises napoléoniennes'), c: m('tables rondes'), d: m('chaise napoleonnienne'), e: m('nappage'), f: m('arche'), g: m('sono'), h: m('licorne gonflable') };
      });
      eq(r.a.nom, 'Chaise napoléonienne', 'pluriel simple');
      eq(r.b.nom, 'Chaise napoléonienne', 'désignation complète');
      eq(r.c.nom, 'Table ronde 150cm', 'table ronde');
      eq(r.d.nom, 'Chaise napoléonienne', 'faute de dictée');
      ok(r.e.opts >= 2, 'nappage blanc / doré → ambiguïté signalée');
      eq(r.f.nom, 'Arche florale', 'arche florale');
      eq(r.g.nom, 'Sono + micro HF', 'sono');
      eq(r.h.nom, null, 'article inconnu non inventé');
    });

    await test('K7 — client : reconnaissance, homonymes, client absent', async () => {
      const r1 = await P(app.page, 'Devis pour Julie Martin, 10 chaises');
      eq(r1.champs.clientId, 101, 'client reconnu');
      const r2 = await P(app.page, 'Devis pour Durand SAS, 10 chaises');
      eq(r2.champs.clientId, 102, 'reconnaissance par raison sociale');
      const r3 = await P(app.page, 'Devis pour Martin, 10 chaises', {
        clients: [{ id: 1, prenom: 'Julie', nom: 'Martin' }, { id: 2, prenom: 'Luc', nom: 'Martin' }]
      });
      ok((r3.questions || []).some(q => q.code === 'client'), 'homonymes → question posée');
      const r4 = await P(app.page, 'Devis pour Sophie Bernard, 10 chaises');
      ok(r4.champs.clientNouveau && r4.champs.clientNouveau.nom === 'Bernard', 'client absent → création proposée');
    });

    await test('K8 — devis complet : lignes, livraison, suppléments, remise', async () => {
      const r = await P(app.page, "Devis pour Julie Martin, mariage le 12 septembre, 120 chaises napoléoniennes et 10 tables rondes, livraison et reprise au 12 rue des Fleurs 69003 Lyon à 42 km, nappage pour 120 convives, créneau horaire imposé, 2 heures d'attente, 10% de remise, valable 15 jours");
      eq(r.type, 'devis', 'type');
      eq(r.champs.clientId, 101, 'client');
      eq(r.champs.date, '2026-09-12', 'date événement');
      eq(r.champs.nomEv, 'Mariage', 'événement');
      eq(r.lignes.length, 2, 'nombre de lignes');
      eq(r.lignes[0].qty, 120, 'quantité chaises'); eq(r.lignes[0].desc, 'Chaise napoléonienne', 'article 1');
      eq(r.lignes[1].qty, 10, 'quantité tables'); eq(r.lignes[1].desc, 'Table ronde 150cm', 'article 2');
      near(r.lignes[0].prixUnit, 2.5, 'prix repris du catalogue');
      eq(r.livraison.mode, 'aller_retour', 'mode livraison');
      near(r.livraison.distanceKm, 42, 'distance');
      eq(r.livraison.supplements.nappage.convives, 120, 'nappage convives');
      eq(r.livraison.supplements.creneauImpose, true, 'créneau imposé');
      near(r.livraison.supplements.attente.heures, 2, 'attente');
      eq(r.champs.remise.v, 10, 'remise'); eq(r.champs.remise.t, 'pct', 'remise en %');
      eq(r.champs.validiteJours, 15, 'validité');
    });

    await test('K9 — modes de livraison et prix négocié', async () => {
      const a = await P(app.page, 'Devis Julie Martin, 50 chaises, le client vient chercher au dépôt');
      eq(a.livraison.mode, 'retrait', 'retrait détecté');
      const b = await P(app.page, 'Devis Julie Martin, 50 chaises, on livre seulement');
      eq(b.livraison.mode, 'livraison', 'livraison simple');
      const c = await P(app.page, 'Devis Julie Martin, 50 chaises, livraison et reprise, je lui fais la livraison à 60 €');
      eq(c.livraison.mode, 'aller_retour', 'aller-retour');
      near(c.livraison.prixNegocieHT, 60, 'prix négocié livraison');
      const d = await P(app.page, 'Devis Julie Martin, 50 chaises, livraison 3e étage sans ascenseur, portage long, reprise le dimanche soir');
      eq(d.livraison.supplements.etageSansAsc.niveaux, 3, 'niveaux d\'étage');
      eq(d.livraison.supplements.portageLong, true, 'portage');
      eq(d.livraison.supplements.repriseDimanche, true, 'reprise dimanche');
    });

    await test('K9b — bascule d\'année : un encaissement d\'hier ne saute pas d\'un an', async () => {
      const T = '2026-08-29';
      const got = await app.page.evaluate(t => ({
        passeVeille: TimNLU.parseDateFr('le 28 août', t, 'passe').iso,
        passeLointain: TimNLU.parseDateFr('le 15 décembre', t, 'passe').iso,
        futurProche: TimNLU.parseDateFr('le 12 septembre', t, 'futur').iso,
        futurPasse: TimNLU.parseDateFr('le 15 janvier', t, 'futur').iso,
        autoRecent: TimNLU.parseDateFr('le 28 août', t).iso
      }), T);
      eq(got.passeVeille, '2026-08-28', 'paiement de la veille : année en cours');
      eq(got.passeLointain, '2025-12-15', 'paiement du 15 décembre : année précédente');
      eq(got.futurProche, '2026-09-12', 'devis à venir : année en cours');
      eq(got.futurPasse, '2027-01-15', 'devis pour janvier : année suivante');
      eq(got.autoRecent, '2026-08-28', 'sans contexte, un passé récent reste tel quel');
      const p = await P(app.page, 'Paul Durand a payé 1 200 € par virement le 28 août');
      eq(p.champs.date, '2026-08-28', 'analyse complète d\'un encaissement daté');
    });

    await test('K10 — plusieurs actes dans une même note vocale', async () => {
      const r = await P(app.page, 'Réserve 80 chaises pour Julie Martin samedi. Ensuite planifie la livraison vendredi à 9h.');
      eq(r.type, 'reservation', 'acte principal');
      ok((r.suite || []).some(s => s.type === 'arret'), 'second acte détecté');
    });

    await test('K11 — fonction pure : déterministe, sans effet de bord', async () => {
      const r = await app.page.evaluate(() => {
        const ctx = assistCtx();
        const avant = JSON.stringify(db);
        const t = 'Devis pour Julie Martin, 120 chaises, livraison 42 km';
        const a = TimNLU.parse(t, ctx), b = TimNLU.parse(t, ctx);
        return { egal: JSON.stringify(a) === JSON.stringify(b), dbIntacte: avant === JSON.stringify(db), texte: t };
      });
      eq(r.egal, true, 'deux analyses identiques');
      eq(r.dbIntacte, true, 'aucune écriture en base pendant l\'analyse');
    });

    await test('K12 — saisies aberrantes : aucun plantage, aucun NaN', async () => {
      const entrees = ['', '   ', '!!!???', '000000', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '12 12 12 12 12',
        'devis devis devis devis', '🎉🎉🎉', '-50 chaises pour personne', 'le 45 janvier à 99h99',
        '999999999999 chaises', 'client client client', 'SELECT * FROM clients', '<script>alert(1)</script>'];
      const r = await app.page.evaluate(es => es.map(e => {
        try {
          const x = TimNLU.parseAll(e, assistCtx());
          const nan = JSON.stringify(x).includes('null,null') ? false : false;
          const bad = (x.lignes || []).some(l => !isFinite(l.qty) || !isFinite(N2(l.prixUnit)) || l.qty < 0);
          function N2(v) { return typeof v === 'number' ? v : parseFloat(v || 0); }
          return { ok: true, type: x.type, bad: bad, nan: nan };
        } catch (err) { return { ok: false, err: String(err) }; }
      }), entrees);
      let ko = 0;
      r.forEach((x, i) => { if (!x.ok || x.bad) { ko++; ok(false, `entrée « ${entrees[i]} » → ${x.err || 'valeur invalide'}`); } });
      eq(ko, 0, 'entrées problématiques');
      const errs = app.errors.filter(e => !/SpeechRecognition/.test(e));
      eq(errs.length, 0, 'aucune erreur console : ' + errs.join(' | '));
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('L · Interface de l\'assistant');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser, { db: dbAssist() });
    const page = app.page;

    await test('L1 — points d\'entrée présents et ouverture du panneau', async () => {
      eq(await page.locator('#as-topbtn').count(), 1, 'bouton barre du haut');
      eq(await page.locator('#as-fab').count(), 1, 'bouton flottant mobile');
      eq(await page.locator('.s-item:has-text("Assistant de saisie")').count(), 1, 'entrée de menu');
      await page.evaluate(() => assistOpen());
      await page.waitForSelector('#as-txt');
      eq(await page.locator('.as-mic').count(), 1, 'bouton micro');
      ok((await page.locator('.as-chip').count()) >= 4, 'exemples proposés');
      await page.evaluate(() => assistClose());
      eq(await page.locator('#as-txt').count(), 0, 'fermeture propre');
    });

    await test('L2 — fiche de vérification : type, confiance, champs, lignes', async () => {
      await dicte(page, 'Devis pour Julie Martin, mariage le 12 septembre, 120 chaises napoléoniennes et 10 tables rondes');
      const txt = await page.locator('.as-card').innerText();
      includes(txt, 'Devis', 'nature de l\'acte affichée');
      includes(txt, 'Julie Martin', 'client affiché');
      ok(/confiance/i.test(txt), 'niveau de confiance affiché');
      includes(txt, '120 × Chaise napoléonienne', 'ligne 1 affichée');
      includes(txt, '10 × Table ronde 150cm', 'ligne 2 affichée');
      ok(/rien n'est enregistr/i.test(txt), 'garde-fou rappelé');
      eq(await page.evaluate(() => db.devis.length), 0, 'aucun devis créé à ce stade');
      await page.evaluate(() => assistClose());
    });

    await test('L3 — devis pré-rempli : client, date, lignes, totaux', async () => {
      await dicte(page, 'Devis pour Julie Martin, mariage le 12 septembre, 120 chaises napoléoniennes et 10 tables rondes');
      await applique(page);
      await page.waitForSelector('#dv-client');
      eq(await page.inputValue('#dv-client'), '101', 'client sélectionné');
      eq(await page.inputValue('#dv-date-ev'), '2026-09-12', 'date événement');
      eq(await page.inputValue('#dv-ev'), 'Mariage', 'nom de l\'événement');
      const lignes = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="dl-qty-"]')).map(e => {
        const i = e.id.replace('dl-qty-', '');
        return { q: e.value, d: document.getElementById('dl-desc-' + i).value, p: document.getElementById('dl-prix-' + i).value };
      }));
      eq(lignes.length, 2, 'deux lignes créées');
      eq(lignes[0].q, '120', 'quantité 1'); eq(lignes[0].d, 'Chaise napoléonienne', 'désignation 1'); eq(lignes[0].p, '2.5', 'prix 1');
      eq(lignes[1].q, '10', 'quantité 2'); eq(lignes[1].d, 'Table ronde 150cm', 'désignation 2');
      includes(await page.locator('#dv-st').innerText(), '400,00', 'sous-total 120×2,50 + 10×10 = 400 €');
      ok((await page.locator('.mo-body .al-info').count()) >= 1, 'bandeau de contrôle affiché');
      await page.evaluate(() => closeModal());
    });

    await test('L4 — devis avec livraison : mode, distance, suppléments, prix négocié', async () => {
      await dicte(page, "Devis pour Paul Durand, 200 chaises, livraison et reprise au 5 avenue Foch 69006 Lyon à 42 km, nappage pour 120 convives, créneau imposé, livraison à 260 €");
      await applique(page);
      await page.waitForSelector('#dv-liv-addr');
      eq(await page.inputValue('#dv-liv-mode'), 'aller_retour', 'mode aller-retour');
      eq(await page.inputValue('#dv-liv-dist'), '42', 'distance');
      eq(await page.isChecked('#dv-liv-nap'), true, 'nappage coché');
      eq(await page.inputValue('#dv-liv-nap-c'), '120', 'convives');
      eq(await page.isChecked('#dv-liv-cre'), true, 'créneau imposé coché');
      eq(await page.inputValue('#dv-liv-nego'), '260', 'prix négocié');
      includes(await page.locator('#dv-liv-addr').inputValue(), 'avenue Foch', 'adresse reprise');
      const res = await page.evaluate(() => window._dvLiv.res);
      eq(res.motifPrix, 'negocie', 'le prix négocié prime');
      near(res.prixRetenuHT, 260, 'prix retenu');
      await page.evaluate(() => closeModal());
    });

    await test('L5 — le devis dicté s\'enregistre avec les bons montants', async () => {
      await dicte(page, 'Devis pour Julie Martin, 100 chaises napoléoniennes, retrait au dépôt');
      await applique(page);
      await page.waitForSelector('#dv-client');
      await page.click('button:has-text("Créer le devis")');
      await page.waitForTimeout(200);
      const d = await page.evaluate(() => db.devis[db.devis.length - 1]);
      ok(!!d, 'devis enregistré');
      eq(d.clientId, 101, 'client');
      eq(d.lignes.length, 1, 'une ligne');
      near(d.montantHT, 250, 'montant HT 100 × 2,50 €');
      eq(d.livraison.mode, 'retrait', 'mode retrait figé dans le devis');
      const a = await page.evaluate(() => db.audit.filter(x => x.type === 'assistant').length);
      ok(a >= 1, 'trace dans la piste d\'audit');
    });

    await test('L6 — réservation pré-remplie avec articles de stock', async () => {
      await dicte(page, 'Réserve 80 chaises napoléoniennes et 8 tables rondes pour Paul Durand le 12 septembre au château de Bagnols');
      await applique(page);
      await page.waitForSelector('#r-client');
      eq(await page.inputValue('#r-client'), '102', 'client');
      eq(await page.inputValue('#r-date'), '2026-09-12', 'date');
      includes(await page.inputValue('#r-lieu'), 'Bagnols', 'lieu');
      const l = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="rl-qty-"]')).map(e => {
        const i = e.id.replace('rl-qty-', '');
        return { q: e.value, sel: document.querySelector('#rl-' + i + ' .li-sel').value };
      }));
      eq(l.length, 2, 'deux lignes');
      eq(l[0].q, '80', 'quantité 1'); eq(l[0].sel, '201', 'article de stock 1 correctement sélectionné');
      eq(l[1].q, '8', 'quantité 2'); eq(l[1].sel, '202', 'article de stock 2');
      await clearToasts(page);
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(150);
      includes(await toasts(page), 'événement', 'garde-fou : nom d\'événement toujours exigé');
      eq(await page.evaluate(() => db.reservations.length), 0, 'rien enregistré sans nom d\'événement');
      await page.fill('#r-ev', 'Mariage Durand');
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => db.reservations[0]);
      ok(!!r, 'réservation enregistrée');
      eq(await page.evaluate(() => db.stock.find(s => s.id === 201).reserve), 80, 'stock réservé');
    });

    await test('L7 — fiche client pré-remplie (client inconnu)', async () => {
      await dicte(page, 'Nouvelle cliente Sophie Bernard, 14 avenue Jean Jaurès 69007 Lyon, 06 12 34 56 78, sophie.bernard@gmail.com');
      await applique(page);
      await page.waitForSelector('#m-prenom');
      eq(await page.inputValue('#m-prenom'), 'Sophie', 'prénom');
      eq(await page.inputValue('#m-nom'), 'Bernard', 'nom');
      eq(await page.inputValue('#m-tel'), '0612345678', 'téléphone');
      eq(await page.inputValue('#m-email'), 'sophie.bernard@gmail.com', 'email');
      includes(await page.inputValue('#m-adr'), 'Jean Jaurès', 'adresse avec accents');
      eq(await page.inputValue('#m-cp'), '69007', 'code postal');
      eq(await page.inputValue('#m-ville'), 'Lyon', 'ville');
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(150);
      eq(await page.evaluate(() => db.clients.length), 3, 'client enregistré');
    });

    await test('L8 — arrêt de tournée pré-rempli', async () => {
      await dicte(page, 'Planifie une livraison chez Julie Martin demain à 8h30, 120 chaises napoléoniennes');
      await applique(page);
      await page.waitForSelector('#st-d');
      eq(await page.inputValue('#st-d'), await jour(page, 1), 'date (demain)');
      eq(await page.inputValue('#st-h'), '08:30', 'créneau');
      eq(await page.inputValue('#st-n'), 'Martin', 'nom repris de la fiche client');
      includes(await page.inputValue('#st-a'), 'rue des Fleurs', 'adresse client');
      eq(await page.inputValue('#st-t'), '0601020304', 'téléphone client');
      includes(await page.inputValue('#st-ar'), '120 Chaise napoléonienne', 'matériel repris');
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(200);
      const s = await page.evaluate(() => db.stops[0]);
      ok(!!s, 'arrêt enregistré'); eq(s.mode, 'livraison', 'mode livraison');
    });

    await test('L9 — encaissement pré-rempli sur la facture ouverte', async () => {
      await page.evaluate(() => {
        db.factures.push({ id: 900, numero: 'FAC-0001', clientId: 102, type: 'facture', dateCreation: today(), echeance: today(), lignes: [{ desc: 'Location', qty: 1, prixUnit: 1200, total: 1200 }], montantHT: 1200, montantTTC: 1200, statut: 'non payée', acompte: 0 });
        saveDB();
      });
      await dicte(page, 'Paul Durand a payé 1 200 € par virement hier');
      await applique(page);
      await page.waitForSelector('#p-mont');
      eq(await page.inputValue('#p-fac'), '900', 'facture ciblée');
      eq(await page.inputValue('#p-mont'), '1200', 'montant');
      eq(await page.inputValue('#p-date'), await jour(page, -1), 'date de règlement (hier)');
      eq(await page.inputValue('#p-mode'), 'Virement', 'mode de règlement');
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(200);
      eq(await page.evaluate(() => db.paiements.length), 1, 'paiement enregistré');
      eq(await page.evaluate(() => db.factures.find(f => f.id === 900).statut), 'payée', 'facture soldée');
    });

    await test('L10 — bon de commande pré-rempli', async () => {
      await dicte(page, 'Prépare un bon de commande pour Julie Martin, 120 chaises napoléoniennes et 10 tables rondes');
      await applique(page);
      await page.waitForSelector('#bc-cl');
      eq(await page.inputValue('#bc-cl'), '101', 'client');
      const l = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="bl-qty-"]')).map(e => e.value));
      eq(l.length, 2, 'deux lignes');
      eq(l[0], '120', 'quantité 1');
      await page.evaluate(() => closeModal());
    });

    await test('L11 — ajustement de stock (entrée et casse)', async () => {
      await dicte(page, "J'ai reçu 50 chaises napoléoniennes");
      await applique(page);
      await page.waitForSelector('#adj-qty');
      eq(await page.inputValue('#adj-type'), 'add', 'entrée en stock');
      eq(await page.inputValue('#adj-qty'), '50', 'quantité');
      await page.click('.mo-foot button:has-text("Appliquer")');
      await page.waitForTimeout(150);
      eq(await page.evaluate(() => db.stock.find(s => s.id === 201).total), 250, 'stock augmenté');
      await dicte(page, '5 nappages blancs cassés');
      await applique(page);
      await page.waitForSelector('#adj-qty');
      eq(await page.inputValue('#adj-type'), 'remove', 'sortie de stock');
      eq(await page.inputValue('#adj-qty'), '5', 'quantité cassée');
      await page.evaluate(() => closeModal());
    });

    await test('L12 — changement de statut appliqué au bon document', async () => {
      const ref = await page.evaluate(() => db.devis[0].ref);
      await dicte(page, 'Le devis ' + ref + ' est accepté');
      await applique(page);
      eq(await page.evaluate(() => db.devis[0].statut), 'accepté', 'statut appliqué');
    });

    await test('L13 — ambiguïté d\'article : question posée puis mémorisée', async () => {
      await dicte(page, 'Devis pour Julie Martin, 40 nappages');
      const qArt = () => page.locator('.as-q:has-text("Article")').count();
      ok((await qArt()) >= 1, 'question d\'ambiguïté affichée');
      const opts = await page.locator('.as-sel option').count();
      ok(opts >= 3, 'options proposées');
      await page.selectOption('.as-sel', { index: 1 });
      await page.waitForTimeout(150);
      eq(await qArt(), 0, 'question résolue');
      const alias = await page.evaluate(() => db.settings.assistant.alias);
      ok(Object.keys(alias).length >= 1, 'correspondance apprise et enregistrée');
      await dicte(page, 'Devis pour Julie Martin, 40 nappages');
      eq(await qArt(), 0, 'plus d\'ambiguïté à la deuxième dictée');
      includes(await page.locator('.as-lignes').innerText(), 'Nappage', 'article résolu automatiquement');
      await page.evaluate(() => assistClose());
    });

    await test('L14 — client manquant : l\'application est bloquée avec explication', async () => {
      await clearToasts(page);
      await dicte(page, 'Devis pour 40 chaises napoléoniennes');
      const n0 = await page.evaluate(() => db.devis.length);
      await page.evaluate(() => assistAppliquer());
      await page.waitForTimeout(150);
      includes(await toasts(page), 'client', 'message explicite');
      eq(await page.evaluate(() => db.devis.length), n0, 'aucun devis créé');
      eq(await page.locator('#as-txt').count(), 1, 'le panneau reste ouvert pour corriger');
      await page.evaluate(() => assistClose());
    });

    await test('L15 — assistant désactivable depuis les Paramètres', async () => {
      await page.evaluate(() => { go('settings'); sTab('assistant', null); });
      await page.waitForSelector('#as-set-actif', { state: 'attached' });
      await page.evaluate(() => { document.getElementById('as-set-actif').checked = false; saveAssistSettings(); });
      eq(await page.evaluate(() => db.settings.assistant.actif), false, 'réglage enregistré');
      eq(await page.evaluate(() => document.getElementById('as-fab').style.display), 'none', 'bouton flottant masqué');
      await clearToasts(page);
      await page.evaluate(() => assistOpen());
      includes(await toasts(page), 'désactivé', 'ouverture refusée avec message');
      await page.evaluate(() => { document.getElementById('as-set-actif').checked = true; saveAssistSettings(); });
    });

    await test('L16 — aucune erreur JavaScript pendant toute la session', async () => {
      const errs = app.errors.filter(e => !/SpeechRecognition|webkitSpeech/.test(e));
      eq(errs.length, 0, 'erreurs : ' + errs.join(' | '));
      eq(app.netCalls.filter(c => c !== 'ban' && c !== 'proxy').length, 0, 'aucun appel réseau inattendu');
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('M · Robustesse et non-régression du reste de l\'application');
  // ═══════════════════════════════════════════════════════════
  {
    await test('M1 — base sans bloc « assistant » : valeurs par défaut injectées', async () => {
      const d = dbAssist();
      delete d.settings.assistant;
      const app = await openApp(browser, { db: d });
      const a = await app.page.evaluate(() => db.settings.assistant);
      eq(a.actif, true, 'assistant actif par défaut');
      eq(typeof a.alias, 'object', 'table des correspondances créée');
      eq(a.iaActif, false, 'renfort IA désactivé par défaut');
      eq(a.iaUrl, '', 'aucune URL par défaut : rien ne sort de l\'appareil');
      await app.ctx.close();
    });

    await test('M2 — 60 dictées aléatoires : aucune exception, aucun montant négatif', async () => {
      const app = await openApp(browser, { db: dbAssist() });
      const mots = ['devis', 'réserve', 'facture', 'paiement', 'livraison', 'client', 'bon de commande', 'stock',
        'Julie Martin', 'Paul Durand', '120 chaises', '10 tables rondes', 'demain', 'le 12 septembre', 'à 8h30',
        '42 km', '1 200 €', '10 %', 'nappage pour 80 convives', 'créneau imposé', 'retrait', 'aller-retour',
        'château de Bagnols', '06 12 34 56 78', 'virement', 'cassé', 'accepté', '', 'euh', 'et', ','];
      const r = await app.page.evaluate(ms => {
        const out = { ko: 0, neg: 0, types: {} };
        for (let i = 0; i < 60; i++) {
          let t = [];
          for (let j = 0; j < 3 + (i % 6); j++) t.push(ms[(i * 7 + j * 13) % ms.length]);
          const txt = t.join(' ');
          try {
            const x = TimNLU.parseAll(txt, assistCtx());
            out.types[x.type] = (out.types[x.type] || 0) + 1;
            (x.lignes || []).forEach(l => { if (!(l.qty > 0) || !isFinite(l.qty) || l.prixUnit < 0) out.neg++; });
          } catch (e) { out.ko++; }
        }
        return out;
      }, mots);
      eq(r.ko, 0, 'exceptions');
      eq(r.neg, 0, 'quantités ou prix invalides');
      ok(Object.keys(r.types).length >= 2, 'plusieurs natures d\'actes reconnues');
      const errs = app.errors.filter(e => !/SpeechRecognition/.test(e));
      eq(errs.length, 0, 'erreurs console : ' + errs.join(' | '));
      await app.ctx.close();
    });

    await test('M3 — devis saisi à la main : comportement inchangé', async () => {
      const app = await openApp(browser, { db: dbAssist() });
      const page = app.page;
      await page.evaluate(() => { go('devis'); modalDevis(); });
      await page.waitForSelector('#dv-client');
      await page.selectOption('#dv-client', '101');
      const id = await page.evaluate(() => document.querySelector('[id^="dl-qty-"]').id.replace('dl-qty-', ''));
      await page.evaluate(i => { document.getElementById('dl-desc-' + i).value = 'Chaise napoléonienne'; }, id);
      await page.fill('#dl-qty-' + id, '100');
      await page.fill('#dl-prix-' + id, '2.5');
      await page.evaluate(() => calcDvTotal());
      includes(await page.locator('#dv-st').innerText(), '250,00', 'sous-total inchangé');
      await page.click('button:has-text("Créer le devis")');
      await page.waitForTimeout(200);
      eq(await page.evaluate(() => db.devis.length), 1, 'devis créé normalement');
      near(await page.evaluate(() => db.devis[0].montantHT), 250, 'montant HT');
      await app.ctx.close();
    });

    await test('M4 — export / import JSON : les réglages de l\'assistant survivent', async () => {
      const app = await openApp(browser, { db: dbAssist() });
      const r = await app.page.evaluate(() => {
        db.settings.assistant.alias = { 'nappages': 4 };
        saveDB();
        const json = JSON.stringify(db);
        const relu = JSON.parse(json);
        return { alias: relu.settings.assistant.alias.nappages, actif: relu.settings.assistant.actif };
      });
      eq(r.alias, 4, 'correspondance exportée');
      eq(r.actif, true, 'réglage exporté');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  await browser.close();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  let nOk = 0, nKo = 0, nChecks = 0;
  results.forEach(s => s.tests.forEach(t => { nChecks += t.checks; t.ok ? nOk++ : nKo++; }));

  const lines = [];
  lines.push('# Tim Event — Rapport de tests (Phase 3 · Assistant de saisie)');
  lines.push('');
  lines.push(`Exécuté le ${new Date().toLocaleString('fr-FR')} · Chromium headless · ${dur} s`);
  lines.push('');
  lines.push(`**${nOk + nKo} scénarios · ${nChecks} assertions · ${nOk} réussis · ${nKo} échoués**`);
  lines.push('');
  results.forEach(s => {
    lines.push('## ' + s.section);
    lines.push('');
    s.tests.forEach(t => {
      lines.push(`- ${t.ok ? '✅' : '❌'} ${t.name} _(${t.checks} assertions)_`);
      if (!t.ok) t.msgs.forEach(m => lines.push(`    - ⚠️ ${m}`));
    });
    lines.push('');
  });
  fs.writeFileSync(path.join(__dirname, '..', 'rapport-assistant.md'), lines.join('\n'), 'utf8');

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${nOk} réussis / ${nOk + nKo} scénarios · ${nChecks} assertions · ${dur}s`);
  console.log('═'.repeat(60));
  process.exit(nKo ? 1 : 0);
})();
