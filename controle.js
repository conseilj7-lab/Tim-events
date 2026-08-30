/* Tim Event — suite de non-régression « Contrôle et bons signés » (Phase 5) */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const {
  chromium, results, section, test, ok, eq, near, includes, notIncludes,
  N, baseDB, openApp, toasts, clearToasts, URL: APP_URL
} = L;

// Ouvre l'application sur un lien (mission ou bon signé) : le rechargement rejoue init()
async function ouvrirLien(browser, opts, hash, routes) {
  const app = await openApp(browser, opts);
  if (routes) await routes(app);
  await app.page.goto(APP_URL + hash);
  await app.page.reload({ waitUntil: 'domcontentloaded' });
  await app.page.waitForFunction(() => typeof db !== 'undefined');
  return app;
}

const CONNECTEUR = 'https://connecteur.test';

function dbCtrl(over) {
  const d = baseDB();
  d.stock = [
    { id: 201, nom: 'Chaise napoléonienne', categorie: 'Mobilier', unite: 'unité', total: 200, reserve: 0, seuil: 20, prix: 2.5 },
    { id: 202, nom: 'Table ronde 150cm', categorie: 'Mobilier', unite: 'unité', total: 20, reserve: 0, seuil: 4, prix: 10 }
  ];
  d.tarifs = [
    { id: 1, nom: 'Chaise napoléonienne', unite: 'unité', prix: 2.5 },
    { id: 3, nom: 'Table ronde 150cm', unite: 'unité', prix: 10 }
  ];
  d.devis = [{
    id: 501, ref: 'DEV-0001', clientId: 101, nomEv: 'Mariage', dateEv: '2026-09-12', dateCreation: '2026-08-20',
    validite: '2026-09-20', statut: 'accepté', lignes: [
      { desc: 'Chaise napoléonienne', qty: 120, prixUnit: 2.5, remise: 0, remiseT: 'pct', total: 300 },
      { desc: 'Table ronde 150cm', qty: 10, prixUnit: 10, remise: 0, remiseT: 'pct', total: 100 }
    ], montantHT: 400, montantTTC: 400, remiseG: 0, remiseGT: 'pct', notes: ''
  }];
  d.stops = [{
    id: 701, prenom: 'Julie', nom: 'Martin', adresse: '12 rue des Fleurs', cp: '69003', ville: 'Lyon',
    tel: '0601020304', lieu: 'Château de Bagnols', date: '2026-09-12', time: '08:30',
    mode: 'livraison', statut: 'attente', notes: '', dvId: 501, clientId: 101, mont: 400
  }];
  d.controles = [];
  d.settings.messagerie = { actif: true, url: '', token: 'jeton-test', canaux: {}, accuse: false, signature: 'Tim Event', horaires: { debut: '00:00', fin: '23:59' }, dernierSync: 0 };
  d.settings.controle = { actif: true, livreur: 'Marc', telLivreur: '0611223344', sigLivreur: true, photos: true, facturerEcarts: true, mention: 'Le client reconnaît avoir compté et reçu les quantités portées ci-dessus.', dernierRetour: 0 };
  return Object.assign(d, over || {});
}

// Signature au doigt : trois traits sur le pavé
async function signer(page, sel) {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error('pavé introuvable : ' + sel);
  await page.mouse.move(b.x + 20, b.y + b.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(b.x + 20 + i * (b.width - 45) / 12, b.y + b.height * (0.6 - 0.32 * Math.sin(i / 2)));
  }
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();

  // ═══════════════════════════════════════════════════════════
  section('R · Contrôle de livraison : compter, constater, signer');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser, { db: dbCtrl() });
    const page = app.page;

    await test('R1 — le contrôle part de l\'arrêt de tournée, avec le matériel du devis', async () => {
      await page.evaluate(() => { trDate = '2026-09-12'; go('tournee'); });
      await page.waitForTimeout(120);
      ok((await page.locator('button:has-text("Contrôler et faire signer")').count()) >= 1, 'bouton présent sur l\'arrêt');
      await page.click('button:has-text("Contrôler et faire signer")');
      await page.waitForSelector('#sig-client');
      const l = await page.evaluate(() => CTRL.courant.lignes.map(x => [x.desc, x.prevu, x.compte, x.stockId]));
      eq(l.length, 2, 'deux références');
      eq(l[0][0], 'Chaise napoléonienne', 'article 1');
      eq(l[0][1], 120, 'quantité prévue reprise du devis');
      eq(l[0][2], 120, 'comptage pré-rempli à la quantité prévue');
      eq(l[0][3], 201, 'rattaché à l\'article de stock');
      includes(await page.locator('.mo-body').innerText(), 'Château de Bagnols', 'lieu rappelé au livreur');
      includes(await page.locator('.ct-mention').innerText(), 'reconnaît avoir compté', 'mention avant signature');
    });

    await test('R2 — comptage : les écarts apparaissent en direct', async () => {
      await page.click('#ct-l-0 .ct-btn');                       // −1
      await page.waitForTimeout(60);
      eq(await page.inputValue('#ct-q-0'), '119', 'quantité décrémentée');
      eq((await page.locator('#ct-e-0').innerText()).trim(), '-1', 'écart affiché');
      includes(await page.locator('#ct-bilan').innerText(), '1 écart', 'bilan mis à jour');
      await page.fill('#ct-q-0', '118');
      await page.dispatchEvent('#ct-q-0', 'input');
      await page.waitForTimeout(60);
      eq((await page.locator('#ct-e-0').innerText()).trim(), '-2', 'saisie directe prise en compte');
      eq(await page.evaluate(() => CTRL.courant.nbEcarts), 1, 'un seul écart');
      await page.fill('#ct-q-0', '120');
      await page.dispatchEvent('#ct-q-0', 'input');
      await page.waitForTimeout(60);
      includes(await page.locator('#ct-bilan').innerText(), 'conforme', 'retour au conforme');
    });

    await test('R3 — impossible de valider sans signature', async () => {
      await clearToasts(page);
      includes(await page.locator('#ctrl-ok').innerText(), 'Faire signer', 'le bouton annonce la signature');
      await page.click('#ctrl-ok');
      await page.waitForTimeout(150);
      includes(await toasts(page), 'signature du client', 'refus explicite');
      eq(await page.evaluate(() => db.controles.length), 0, 'aucun bon enregistré');
      eq(await page.locator('#sig-client').count(), 1, 'écran toujours ouvert');
    });

    await test('R4 — double signature puis validation : bon numéroté, arrêt fait, audit', async () => {
      await page.fill('#ct-q-0', '118');
      await page.dispatchEvent('#ct-q-0', 'input');
      await signer(page, '#sig-client');
      await signer(page, '#sig-livreur');
      await page.waitForTimeout(80);
      includes(await page.locator('#ctrl-ok').innerText(), 'Valider', 'bouton prêt');
      await page.click('#ctrl-ok');
      await page.waitForTimeout(250);
      const c = await page.evaluate(() => db.controles[0]);
      ok(!!c, 'bon enregistré');
      eq(c.num, 'BL-0001', 'numérotation');
      eq(c.statut, 'signe', 'statut signé');
      eq(c.type, 'livraison', 'type');
      eq(c.lignes[0].compte, 118, 'quantité réellement reçue');
      eq(c.lignes[0].ecart, -2, 'écart conservé');
      ok(c.sigClient && c.sigClient.p.length > 0, 'signature client capturée');
      ok(c.sigLivreur && c.sigLivreur.p.length > 0, 'signature livreur capturée');
      eq(c.sigClient.nom, 'Julie Martin', 'nom du signataire');
      eq(await page.evaluate(() => db.stops[0].statut), 'fait', 'arrêt marqué fait');
      ok(await page.evaluate(() => db.audit.some(a => a.type === 'controle')), 'trace dans la piste d\'audit');
      const poids = await page.evaluate(() => JSON.stringify(db.controles[0].sigClient).length);
      ok(poids < 4000, 'signature légère (' + poids + ' octets) : transportable par lien');
    });

    await test('R5 — bon imprimable : quantités, écart, signatures, mention', async () => {
      await page.evaluate(() => ctrlPDF(db.controles[0].id));
      await page.waitForTimeout(150);
      const doc = await page.locator('#pdf-body').innerText();
      ok(/bon de livraison/i.test(doc), 'nature du document');
      includes(doc, 'BL-0001', 'numéro');
      includes(doc, 'Julie Martin', 'client');
      includes(doc, 'Chaise napoléonienne', 'article');
      includes(doc, '118', 'quantité comptée');
      includes(doc, 'reconnaît avoir compté', 'mention légale');
      eq(await page.locator('#pdf-body svg path').count(), 2, 'les deux signatures sont dessinées');
      await page.evaluate(() => closePDF());
    });

    await test('R6 — reprise : la référence est ce qui a été livré et signé, pas le devis', async () => {
      await page.evaluate(() => {
        db.stops.push({ id: 702, prenom: 'Julie', nom: 'Martin', adresse: '12 rue des Fleurs', cp: '69003', ville: 'Lyon',
          tel: '0601020304', lieu: 'Château de Bagnols', date: '2026-09-14', time: '10:00', mode: 'recuperation',
          statut: 'attente', dvId: 501, clientId: 101 });
        saveDB(); ctrlDepuisStop(702);
      });
      await page.waitForSelector('#sig-client');
      const l = await page.evaluate(() => CTRL.courant.lignes.map(x => [x.desc, x.prevu, x.origine]));
      eq(await page.evaluate(() => CTRL.courant.type), 'reprise', 'type reprise');
      eq(l[0][1], 118, 'référence = 118 chaises livrées, pas 120 du devis');
      eq(l[0][2], 'BL-0001', 'origine tracée');
      includes(await page.locator('.ct-src').innerText(), 'BL-0001', 'origine affichée au livreur');
      eq(await page.locator('#ct-m-0').count(), 1, 'motif proposé pour chaque ligne');
    });

    await test('R7 — matériel non restitué : montant chiffré, stock ajusté, facture proposée', async () => {
      await page.fill('#ct-q-0', '115');
      await page.dispatchEvent('#ct-q-0', 'input');
      await page.selectOption('#ct-m-0', 'casse');
      await page.waitForTimeout(80);
      near(await page.evaluate(() => CTRL.courant.montantEcart), 7.5, '3 chaises × 2,50 €');
      includes(await page.locator('#ct-bilan').innerText(), '7,50', 'montant affiché avant signature');
      await signer(page, '#sig-client');
      await signer(page, '#sig-livreur');
      await page.click('#ctrl-ok');
      await page.waitForTimeout(300);
      const c = await page.evaluate(() => db.controles.find(x => x.type === 'reprise'));
      eq(c.num, 'BR-0001', 'numérotation distincte');
      eq(c.lignes[0].motif, 'casse', 'motif enregistré');
      eq(await page.evaluate(() => db.stock.find(s => s.id === 201).total), 197, 'stock ajusté de −3');
      includes(await page.locator('.mo-foot').innerText(), 'Facturer', 'facturation proposée');
      await page.click('.mo-foot button.btn-primary');
      await page.waitForSelector('#f-client');
      await page.waitForSelector('.mo-body .al-info');
      const lig = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="fl-qty-"]')).map(e => e.value));
      eq(lig[0], '3', 'quantité manquante reportée sur la facture');
      includes(await page.evaluate(() => document.querySelector('[id^="fl-desc-"]').value), 'BR-0001', 'justificatif cité');
      await page.evaluate(() => closeModal());
    });

    await test('R8 — motif « à récupérer plus tard » : constaté mais non facturé', async () => {
      const r = await page.evaluate(() => {
        const c = { type: 'reprise', lignes: [
          { desc: 'Chaise napoléonienne', prevu: 10, compte: 8, motif: 'reporte' },
          { desc: 'Table ronde 150cm', prevu: 4, compte: 2, motif: 'perte' }] };
        ctrlCalc(c);
        return { m: c.montantEcart, n: c.nbEcarts };
      });
      eq(r.n, 2, 'les deux écarts sont constatés');
      near(r.m, 20, 'seules les 2 tables perdues sont chiffrées (2 × 10 €)');
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('S · Mode livreur : un téléphone qui n\'a pas la base');
  // ═══════════════════════════════════════════════════════════
  {
    await test('S1 — la mission tient dans un lien et ne contient que la mission', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const r = await app.page.evaluate(() => {
        const p = missionPayload(db.stops[0], 'livraison');
        const lien = location.origin + location.pathname + '#m=' + b64u(JSON.stringify(p));
        return { p: p, taille: lien.length, lien: lien };
      });
      eq(r.p.n, 'Julie Martin', 'client');
      eq(r.p.l.length, 2, 'matériel à contrôler');
      eq(r.p.l[0][1], 120, 'quantité prévue');
      ok(r.taille < 1500, 'lien court (' + r.taille + ' caractères) : passe en SMS ou WhatsApp');
      const brut = JSON.stringify(r.p);
      notIncludes(brut, 'DEV-0001', 'aucun document de l\'entreprise dans le lien');
      notIncludes(brut, 'montantHT', 'aucun montant');
      await app.ctx.close();
    });

    await test('S2 — le livreur ouvre le lien : mission seule, base vide, aucun accès aux données', async () => {
      const patron = await openApp(browser, { db: dbCtrl() });
      const lien = await patron.page.evaluate(() => '#m=' + b64u(JSON.stringify(missionPayload(db.stops[0], 'livraison'))));
      await patron.ctx.close();

      const livreur = await ouvrirLien(browser, { db: null }, lien);   // téléphone vierge
      await livreur.page.waitForSelector('#sig-client');
      eq(await livreur.page.evaluate(() => CTRL.livreur), true, 'mode livreur actif');
      eq(await livreur.page.evaluate(() => db.devis.length), 0, 'aucun devis sur le téléphone du livreur');
      eq(await livreur.page.evaluate(() => db.clients.length), 0, 'aucun client');
      eq(await livreur.page.evaluate(() => document.body.classList.contains('mode-livreur')), true, 'interface réduite');
      includes(await livreur.page.locator('.mo-body').innerText(), 'Mission reçue', 'consigne affichée');
      includes(await livreur.page.locator('#mo-box').innerText(), 'Julie Martin', 'client de la mission');
      eq(await livreur.page.evaluate(() => location.hash), '', 'lien nettoyé après ouverture');
      await livreur.ctx.close();
    });

    await test('S3 — le livreur compte, fait signer, et repart avec un lien de retour', async () => {
      const patron = await openApp(browser, { db: dbCtrl() });
      const lien = await patron.page.evaluate(() => '#m=' + b64u(JSON.stringify(missionPayload(db.stops[0], 'livraison'))));
      await patron.ctx.close();

      const livreur = await ouvrirLien(browser, { db: null }, lien);
      const page = livreur.page;
      await page.waitForSelector('#sig-client');
      await page.fill('#ct-q-0', '118');
      await page.dispatchEvent('#ct-q-0', 'input');
      await page.fill('#ctrl-notes', '2 chaises manquantes au chargement');
      await page.fill('#ctrl-nom-livreur', 'Marc');
      await signer(page, '#sig-client');
      await signer(page, '#sig-livreur');
      await page.click('#ctrl-ok');
      await page.waitForSelector('#ct-lien');
      const retour = await page.inputValue('#ct-lien');
      ok(/#r=/.test(retour), 'lien de retour produit');
      ok(retour.length < 9000, 'lien de retour transmissible (' + retour.length + ' caractères)');
      const c = await page.evaluate(() => db.controles[0]);
      eq(c.statut, 'signe', 'bon signé conservé sur le téléphone du livreur');
      eq(c.lignes[0].compte, 118, 'comptage');
      eq(c.notes, '2 chaises manquantes au chargement', 'observation');
      global.__retour = retour;
      await livreur.ctx.close();
    });

    await test('S4 — le patron ouvre le lien reçu : bon intégré, arrêt fait, stock ajusté', async () => {
      const hash = '#' + String(global.__retour).split('#')[1];
      const app = await ouvrirLien(browser, { db: dbCtrl() }, hash);
      const page = app.page;
      await page.waitForTimeout(400);
      const c = await page.evaluate(() => db.controles[0]);
      ok(!!c, 'bon importé');
      eq(c.statut, 'signe', 'signé');
      eq(c.num, 'BL-0001', 'numéroté à l\'arrivée');
      eq(c.lignes[0].compte, 118, 'quantités du livreur');
      eq(c.lignes[0].ecart, -2, 'écart recalculé');
      ok(c.sigClient && c.sigClient.p.length > 0, 'signature client transportée');
      eq(c.source, 'livreur', 'origine tracée');
      eq(await page.evaluate(() => db.stops[0].statut), 'fait', 'arrêt marqué fait');
      eq(await page.evaluate(() => location.hash), '', 'lien nettoyé');
      await page.evaluate(() => { go('controles'); });
      await page.waitForTimeout(120);
      includes(await page.locator('#ctrl-list').innerText(), 'BL-0001', 'visible dans les bons signés');
      ok(/reçu du livreur/i.test(await page.locator('#ctrl-list').innerText()), 'origine affichée');
      await app.ctx.close();
    });

    await test('S5 — import manuel d\'un lien collé, et refus d\'un lien abîmé', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const page = app.page;
      await clearToasts(page);
      await page.evaluate(() => { go('controles'); ctrlImporter(); });
      await page.waitForSelector('#ct-imp');
      await page.fill('#ct-imp', 'https://exemple.fr/#r=CECI-NEST-PAS-UN-BON');
      await page.click('.mo-foot button:has-text("Importer")');
      await page.waitForTimeout(150);
      includes(await toasts(page), 'illisible', 'lien abîmé refusé');
      eq(await page.evaluate(() => db.controles.length), 0, 'rien n\'est enregistré');
      await page.fill('#ct-imp', global.__retour);
      await page.click('.mo-foot button:has-text("Importer")');
      await page.waitForTimeout(250);
      eq(await page.evaluate(() => db.controles.length), 1, 'bon valide importé');
      await app.ctx.close();
    });

    await test('S6 — un même bon importé deux fois ne crée pas de doublon', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const r = await app.page.evaluate(lien => {
        const p = JSON.parse(unb64u(/#r=([A-Za-z0-9\-_]+)/.exec(lien)[1]));
        retourAppliquer(p); retourAppliquer(p);
        return { n: db.controles.length, stock: db.stock.find(s => s.id === 201).total };
      }, global.__retour);
      eq(r.n, 1, 'un seul bon');
      eq(r.stock, 200, 'stock non ajusté deux fois (livraison : aucun mouvement)');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('T · Connecteur, réglages et non-régression');
  // ═══════════════════════════════════════════════════════════
  {
    await test('T1 — avec connecteur : mission publiée, lien court, retour automatique', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const stock = {};
      const retours = [];
      await app.ctx.route(CONNECTEUR + '/**', route => {
        const u = new URL(route.request().url());
        const m = /^\/mission\/([^/]+)(\/retour)?$/.exec(u.pathname);
        if (u.pathname === '/mission' && route.request().method() === 'POST') {
          const b = JSON.parse(route.request().postData() || '{}');
          stock[b.code] = b.mission;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, code: b.code }) });
        }
        if (m && m[2]) { retours.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
        if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mission: stock[m[1]] || null }) });
        if (u.pathname === '/retours') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ retours: retours, now: Date.now() }) });
        return route.fulfill({ status: 404, body: '{}' });
      });
      await app.page.evaluate(u => msgSaveParams({ url: u, token: 'jeton-test' }), CONNECTEUR);
      await app.page.evaluate(() => ctrlEnvoyerMission(701));
      await app.page.waitForSelector('#ct-lien');
      const lien = await app.page.inputValue('#ct-lien');
      ok(/#mc=/.test(lien), 'lien court par code');
      ok(lien.length < 220, 'lien vraiment court (' + lien.length + ' caractères)');
      eq(Object.keys(stock).length, 1, 'mission déposée sur le connecteur');
      const code = Object.keys(stock)[0];
      eq(stock[code].n, 'Julie Martin', 'contenu de la mission');

      // Le livreur récupère la mission par le code, signe, et le retour part tout seul
      const livreur = await ouvrirLien(browser, { db: null }, '#mc=' + code + '~' + encodeURIComponent(CONNECTEUR), async a => {
        await a.ctx.route(CONNECTEUR + '/**', route => {
          const u = new URL(route.request().url());
          const m = /^\/mission\/([^/]+)(\/retour)?$/.exec(u.pathname);
          if (m && m[2]) { retours.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
          if (m) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mission: stock[m[1]] || null }) });
          return route.fulfill({ status: 404, body: '{}' });
        });
      });
      await livreur.page.waitForSelector('#sig-client', { timeout: 5000 });
      await livreur.page.fill('#ctrl-nom-livreur', 'Marc');
      await livreur.page.fill('#ct-q-0', '119');
      await livreur.page.dispatchEvent('#ct-q-0', 'input');
      await signer(livreur.page, '#sig-client');
      await signer(livreur.page, '#sig-livreur');
      await livreur.page.click('#ctrl-ok');
      await livreur.page.waitForTimeout(400);
      eq(retours.length, 1, 'bon signé transmis automatiquement');
      ok(/transmis|est parti/i.test(await livreur.page.locator('#mo-box').innerText()), 'confirmation au livreur');
      await livreur.ctx.close();

      // Le patron le récupère à la synchronisation suivante
      const r = await app.page.evaluate(() => ctrlSync(true));
      eq(r.ok, true, 'synchronisation réussie');
      eq(r.n, 1, 'un bon reçu');
      eq(await app.page.evaluate(() => db.controles[0].lignes[0].compte), 119, 'quantités du livreur intégrées');
      eq(await app.page.evaluate(() => db.stops[0].statut), 'fait', 'arrêt clôturé automatiquement');
      await app.ctx.close();
    });

    await test('T2 — sans connecteur : tout fonctionne quand même, hors ligne', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      await app.page.evaluate(() => ctrlEnvoyerMission(701));
      await app.page.waitForSelector('#ct-lien');
      const lien = await app.page.inputValue('#ct-lien');
      ok(/#m=/.test(lien), 'repli sur le lien complet');
      includes(await app.page.locator('.mo-body').innerText(), 'aucun serveur configuré', 'situation annoncée');
      eq(app.netCalls.filter(c => c !== 'ban' && c !== 'proxy').length, 0, 'aucun appel réseau');
      await app.ctx.close();
    });

    await test('T3 — réglages du contrôle : signature livreur facultative', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const page = app.page;
      await page.evaluate(() => { go('settings'); sTab('controle', null); });
      await page.waitForSelector('#ct-set-livreur', { state: 'attached' });
      eq(await page.inputValue('#ct-set-livreur'), 'Marc', 'livreur par défaut affiché');
      await page.evaluate(() => { document.getElementById('ct-set-sig').checked = false; saveCtrlSettings(); });
      eq(await page.evaluate(() => db.settings.controle.sigLivreur), false, 'réglage enregistré');
      await page.evaluate(() => ctrlDepuisStop(701));
      await page.waitForSelector('#sig-client');
      eq(await page.locator('#sig-livreur').count(), 0, 'pavé livreur masqué');
      await signer(page, '#sig-client');
      await page.waitForTimeout(80);
      await clearToasts(page);
      await page.click('#ctrl-ok');
      await page.waitForTimeout(300);
      eq(await page.evaluate(() => db.controles.length), 1, 'validation possible avec la seule signature client — retour : ' + (await toasts(page)));
      await app.ctx.close();
    });

    await test('T4 — base ancienne : réglages, compteurs et tableau créés', async () => {
      const d = dbCtrl(); delete d.settings.controle; delete d.controles;
      const app = await openApp(browser, { db: d });
      const s = await app.page.evaluate(() => ({ c: db.settings.controle, n: Array.isArray(db.controles), bl: db.counters.bl, br: db.counters.br }));
      eq(s.c.actif, true, 'contrôle actif par défaut');
      eq(s.c.sigLivreur, true, 'double signature par défaut');
      eq(s.n, true, 'tableau des bons créé');
      eq(s.bl, 1, 'compteur des bons de livraison');
      eq(s.br, 1, 'compteur des bons de reprise');
      await app.ctx.close();
    });

    await test('T5 — photos : ajout, restitution, suppression', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const r = await app.page.evaluate(() => {
        CTRL.courant = ctrlCreer(db.stops[0], 'livraison');
        localStorage.setItem('ph:ph-test', 'data:image/jpeg;base64,AAAA');
        CTRL.courant.photos.push({ id: 'ph-test', ts: Date.now() });
        const avant = ctrlPhotoGet('ph-test');
        ctrlPhotoSuppr('ph-test');
        return { avant: avant, apres: ctrlPhotoGet('ph-test'), n: CTRL.courant.photos.length };
      });
      ok(r.avant.length > 10, 'photo restituée');
      eq(r.apres, '', 'photo supprimée du téléphone');
      eq(r.n, 0, 'retirée du bon');
      await app.ctx.close();
    });

    await test('T5b — rappel de sauvegarde : alerte, export, silence ensuite', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const page = app.page;
      await page.waitForTimeout(1500);
      eq(await page.evaluate(() => document.getElementById('sauve-bandeau').style.display), 'flex', 'alerte affichée quand rien n\'a jamais été sauvegardé');
      includes(await page.locator('#sauve-bandeau').innerText(), 'que sur cet appareil', 'risque expliqué');
      const r = await page.evaluate(() => {
        const e = sauvegardeEtat();
        db.settings.dernierExport = Date.now() - 3 * 86400000; saveDB();
        const e2 = sauvegardeEtat();
        db.settings.dernierExport = Date.now() - 9 * 86400000; saveDB();
        return { jamais: e.urgent, recent: sauvegardeEtat.call(null) && e2.urgent, vieux: sauvegardeEtat().urgent, j: sauvegardeEtat().jours };
      });
      eq(r.jamais, true, 'jamais sauvegardé → alerte');
      eq(r.recent, false, 'sauvegarde de 3 jours → silence');
      eq(r.vieux, true, 'sauvegarde de 9 jours → alerte');
      eq(r.j, 9, 'ancienneté calculée');
      await app.ctx.close();
    });

    await test('T6 — non-régression : devis, tournée et assistant intacts', async () => {
      const app = await openApp(browser, { db: dbCtrl() });
      const page = app.page;
      await page.evaluate(() => { go('devis'); modalDevis(); });
      await page.waitForSelector('#dv-client');
      await page.selectOption('#dv-client', '101');
      const id = await page.evaluate(() => document.querySelector('[id^="dl-qty-"]').id.replace('dl-qty-', ''));
      await page.evaluate(i => { document.getElementById('dl-desc-' + i).value = 'Chaise napoléonienne'; }, id);
      await page.fill('#dl-qty-' + id, '100');
      await page.fill('#dl-prix-' + id, '2.5');
      await page.evaluate(() => calcDvTotal());
      await page.click('button:has-text("Créer le devis")');
      await page.waitForTimeout(200);
      eq(await page.evaluate(() => db.devis.length), 2, 'devis créé normalement');
      const r = await page.evaluate(() => TimNLU.parse('Devis pour Julie Martin, 120 chaises', assistCtx()));
      eq(r.type, 'devis', 'assistant de saisie toujours opérationnel');
      const errs = app.errors.filter(e => !/SpeechRecognition/.test(e));
      eq(errs.length, 0, 'aucune erreur console : ' + errs.join(' | '));
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  await browser.close();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  let nOk = 0, nKo = 0, nChecks = 0;
  results.forEach(s => s.tests.forEach(t => { nChecks += t.checks; t.ok ? nOk++ : nKo++; }));

  const lines = [];
  lines.push('# Tim Event — Rapport de tests (Phase 5 · Contrôle et bons signés)');
  lines.push('');
  lines.push(`Exécuté le ${new Date().toLocaleString('fr-FR')} · Chromium headless · ${dur} s`);
  lines.push('');
  lines.push(`**${nOk + nKo} scénarios · ${nChecks} assertions · ${nOk} réussis · ${nKo} échoués**`);
  lines.push('');
  results.forEach(s => {
    lines.push('## ' + s.section); lines.push('');
    s.tests.forEach(t => {
      lines.push(`- ${t.ok ? '✅' : '❌'} ${t.name} _(${t.checks} assertions)_`);
      if (!t.ok) t.msgs.forEach(m => lines.push(`    - ⚠️ ${m}`));
    });
    lines.push('');
  });
  fs.writeFileSync(path.join(__dirname, '..', 'rapport-controle.md'), lines.join('\n'), 'utf8');

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${nOk} réussis / ${nOk + nKo} scénarios · ${nChecks} assertions · ${dur}s`);
  console.log('═'.repeat(60));
  process.exit(nKo ? 1 : 0);
})();
