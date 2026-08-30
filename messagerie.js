/* Tim Event — suite de non-régression « Messagerie unifiée » (Phase 4) */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const {
  chromium, results, section, test, ok, eq, near, includes, notIncludes,
  N, baseDB, openApp, toasts, clearToasts
} = L;

const CONNECTEUR = 'https://connecteur.test';

function dbMsg(over) {
  const d = baseDB();
  d.stock = [
    { id: 201, nom: 'Chaise napoléonienne', categorie: 'Mobilier', unite: 'unité', total: 200, reserve: 0, seuil: 20, prix: 2.5 },
    { id: 202, nom: 'Table ronde 150cm', categorie: 'Mobilier', unite: 'unité', total: 20, reserve: 0, seuil: 4, prix: 10 },
    { id: 205, nom: 'Arche florale', categorie: 'Décoration', unite: 'unité', total: 3, reserve: 0, seuil: 1, prix: 120 }
  ];
  d.tarifs = [
    { id: 1, nom: 'Chaise napoléonienne', unite: 'unité', prix: 2.5 },
    { id: 3, nom: 'Table ronde 150cm', unite: 'unité', prix: 10 },
    { id: 4, nom: 'Nappage blanc', unite: 'unité', prix: 5 },
    { id: 9, nom: 'Arche florale', unite: 'unité', prix: 120 }
  ];
  d.threads = [];
  d.settings.messagerie = { actif: true, url: '', token: 'jeton-test', canaux: { whatsapp: true, instagram: true, tiktok: false }, accuse: false, signature: 'Tim Event', horaires: { debut: '00:00', fin: '23:59' }, dernierSync: 0 };
  return Object.assign(d, over || {});
}

// Connecteur simulé : renvoie ce qu'on lui demande, journalise les envois
async function brancher(app, opts) {
  opts = opts || {};
  const envois = [];
  await app.ctx.route(CONNECTEUR + '/**', route => {
    const req = route.request();
    const u = new URL(req.url());
    const auth = req.headers()['authorization'] || '';
    if (auth !== 'Bearer jeton-test') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"non autorisé"}' });
    if (opts.hs) return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"ko"}' });
    if (u.pathname === '/etat') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, canaux: ['whatsapp', 'instagram'] }) });
    if (u.pathname === '/threads') {
      const since = Number(u.searchParams.get('since') || 0);
      const threads = (opts.threads || []).map(t => Object.assign({}, t, { messages: (t.messages || []).filter(m => m.ts > since) }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ threads, now: Date.now() }) });
    }
    if (u.pathname === '/send') {
      const body = JSON.parse(req.postData() || '{}');
      envois.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'srv-' + envois.length }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"inconnu"}' });
  });
  await app.page.evaluate(u => { msgSaveParams({ url: u, token: 'jeton-test' }); }, CONNECTEUR);
  return envois;
}

const threadWA = (txt, minutes) => ({
  canal: 'whatsapp', extId: '33612345678', nom: 'Camille Rousseau', tel: '+33612345678',
  messages: [{ id: 'wamid.1', sens: 'in', texte: txt, ts: Date.now() - (minutes || 10) * 60000, auteur: 'client' }]
});

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();

  // ═══════════════════════════════════════════════════════════
  section('N · Messagerie : boîte unique et qualification');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser, { db: dbMsg() });
    const page = app.page;

    await test('N1 — écran, menu et compteur en place', async () => {
      eq(await page.locator('.s-item:has-text("Messagerie")').count(), 1, 'entrée de menu');
      await page.evaluate(() => go('messagerie'));
      await page.waitForSelector('#mg-list');
      eq(await page.locator('#page-messagerie.active').count(), 1, 'écran affiché');
      includes(await page.locator('#mg-list').innerText(), 'Aucune conversation', 'liste vide au départ');
      includes(await page.locator('#mg-filters').innerText(), 'Connecteur non configuré', 'absence de connecteur signalée');
    });

    await test('N2 — conversation saisie à la main, qualifiée immédiatement', async () => {
      await page.evaluate(() => {
        msgNouveau();
        document.getElementById('mn-canal').value = 'tiktok';
        document.getElementById('mn-nom').value = 'Camille Rousseau';
        document.getElementById('mn-tel').value = '06 12 34 56 78';
        document.getElementById('mn-msg').value = "Bonjour, je me marie le 12 septembre au château de Bagnols, il me faudrait 120 chaises napoléoniennes et 10 tables rondes. Vous livrez ? Quel prix ?";
        msgNouveauSave();
      });
      await page.waitForTimeout(150);
      const t = await page.evaluate(() => db.threads[0]);
      ok(!!t, 'conversation créée');
      eq(t.canal, 'tiktok', 'canal');
      eq(t.fiche.besoin, 'devis', 'besoin identifié : demande de prix');
      eq(t.fiche.dateEv, '2026-09-12', 'date de l\'événement extraite');
      eq(t.fiche.nomEv, 'Mariage', 'nature de l\'événement');
      includes(t.fiche.lieu, 'Bagnols', 'lieu');
      eq(t.fiche.lignes.length, 2, 'matériel identifié');
      eq(t.fiche.lignes[0].qty, 120, 'quantité');
      eq(t.fiche.lignes[0].desc, 'Chaise napoléonienne', 'article catalogue');
      eq(t.fiche.livraison && t.fiche.livraison.mode, 'livraison', 'livraison détectée');
    });

    await test('N3 — priorité et informations manquantes signalées', async () => {
      const f = await page.evaluate(() => {
        const t = { id: 1, canal: 'instagram', nom: 'Léa Fontaine', tel: '', statut: 'nouveau', messages: [
          { id: 'x1', sens: 'in', texte: "Coucou, vous auriez des arches florales pour demain ? C'est urgent, 40 personnes", ts: Date.now(), auteur: 'client' }] };
        return msgQualifie(t);
      });
      eq(f.besoin, 'dispo', 'question de disponibilité');
      eq(f.urgence, 'haute', 'urgence détectée');
      eq(f.convives, 40, 'nombre de convives');
      ok(f.manque.indexOf('téléphone') >= 0, 'téléphone manquant signalé');
      ok(f.manque.indexOf('lieu de l\'événement') >= 0, 'lieu manquant signalé');
    });

    await test('N4 — réponse de premier niveau : accuse, reformule, questionne, signe', async () => {
      const r = await page.evaluate(() => msgReponse(db.threads[0]));
      ok(/^Bonjour Camille/.test(r), 'salutation personnalisée');
      includes(r, 'Je note votre demande', 'reformulation de la demande');
      includes(r, '12 septembre', 'date reprise');
      includes(r, '120 × chaise', 'matériel repris');
      includes(r, 'Bagnols', 'lieu repris');
      includes(r, 'devis chiffré', 'suite annoncée');
      includes(r, 'Tim Event', 'signature');
      ok(r.split('\n').length >= 4, 'message structuré');
    });

    await test('N5 — fenêtre de 24 h : ouverte, puis fermée', async () => {
      const r = await page.evaluate(() => {
        const t = { messages: [{ sens: 'in', ts: Date.now() - 3600000 }] };
        const vieux = { messages: [{ sens: 'in', ts: Date.now() - 30 * 3600000 }] };
        const jamais = { messages: [] };
        return { ouverte: msgFenetre(t).ouverte, fermee: msgFenetre(vieux).ouverte, vide: msgFenetre(jamais).ouverte,
                 libreWa: msgPeutRepondreLibre({ canal: 'whatsapp', messages: vieux.messages }),
                 libreManuel: msgPeutRepondreLibre({ canal: 'manuel', messages: vieux.messages }) };
      });
      eq(r.ouverte, true, 'message d\'il y a 1 h : fenêtre ouverte');
      eq(r.fermee, false, 'message d\'il y a 30 h : fenêtre fermée');
      eq(r.vide, false, 'aucun message entrant : pas de fenêtre');
      eq(r.libreWa, false, 'WhatsApp hors fenêtre : réponse libre interdite');
      eq(r.libreManuel, true, 'canal manuel : toujours autorisé');
    });

    await test('N6 — fiche de synthèse : coordonnées, besoin, actions', async () => {
      await page.evaluate(() => { go('messagerie'); msgFiche(db.threads[0].id); });
      await page.waitForSelector('.mg-fsum');
      const txt = await page.locator('.mo-body').innerText();
      includes(txt, 'Camille Rousseau', 'nom');
      includes(txt, '0612345678', 'téléphone cliquable');
      includes(txt, 'Demande de prix', 'besoin');
      includes(txt, '12 septembre 2026', 'date lisible');
      includes(txt, 'Bagnols', 'lieu');
      includes(txt, '120 × Chaise napoléonienne', 'matériel');
      includes(txt, '400,00 €', 'estimation catalogue 120×2,50 + 10×10');
      const foot = await page.locator('.mo-foot').innerText();
      ['Appeler', 'Répondre', 'Devis', 'Réservation', 'Tournée'].forEach(b => includes(foot, b, 'bouton ' + b));
      eq(await page.locator('.mo-foot a[href^="tel:"]').count(), 1, 'lien d\'appel direct');
    });

    await test('N7 — conversion en devis : client à créer, lignes reprises', async () => {
      await page.evaluate(() => msgVers(db.threads[0].id, 'devis'));
      await page.waitForSelector('#dv-client');
      await page.waitForSelector('.mo-body .al-info');   // bandeau posé une fois le pré-remplissage terminé
      const l = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="dl-qty-"]')).map(e => {
        const i = e.id.replace('dl-qty-', '');
        return { q: e.value, d: document.getElementById('dl-desc-' + i).value, p: document.getElementById('dl-prix-' + i).value };
      }));
      eq(l.length, 2, 'deux lignes');
      eq(l[0].q, '120', 'quantité'); eq(l[0].d, 'Chaise napoléonienne', 'article'); eq(l[0].p, '2.5', 'prix catalogue');
      eq(await page.inputValue('#dv-date-ev'), '2026-09-12', 'date de l\'événement');
      eq(await page.inputValue('#dv-ev'), 'Mariage', 'événement');
      includes(await page.locator('#dv-st').innerText(), '400,00', 'sous-total');
      const a = await page.evaluate(() => db.audit.filter(x => x.type === 'messagerie').length);
      ok(a >= 1, 'conversion tracée dans la piste d\'audit');
      await page.evaluate(() => closeModal());
    });

    await test('N8 — conversion en client puis rapprochement automatique', async () => {
      await page.evaluate(() => { go('messagerie'); msgVers(db.threads[0].id, 'client'); });
      await page.waitForSelector('#m-prenom');
      await page.waitForSelector('.mo-body .al-info');
      eq(await page.inputValue('#m-prenom'), 'Camille', 'prénom');
      eq(await page.inputValue('#m-nom'), 'Rousseau', 'nom');
      eq(await page.inputValue('#m-tel'), '0612345678', 'téléphone repris');
      await page.click('.mo-foot button:has-text("Enregistrer")');
      await page.waitForTimeout(200);
      const lie = await page.evaluate(() => { go('messagerie'); return msgRapproche(db.threads[0]); });
      const cid = await page.evaluate(() => db.clients[db.clients.length - 1].id);
      eq(lie, cid, 'la conversation est rattachée au client créé');
      await page.evaluate(() => { go('messagerie'); renderMessagerie(); });
      ok(/client connu/i.test(await page.locator('#mg-list').innerText()), 'affiché comme client connu');
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('O · Connecteur : synchronisation, envoi, pannes');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser, { db: dbMsg() });
    const page = app.page;
    const envois = await brancher(app, { threads: [threadWA('Bonjour, je cherche 80 chaises pour le 12 septembre', 10)] });

    await test('O1 — synchronisation : conversation importée et qualifiée', async () => {
      await page.evaluate(() => go('messagerie'));
      const r = await page.evaluate(() => msgSync(true));
      eq(r.ok, true, 'synchronisation réussie');
      eq(r.n, 1, 'un message reçu');
      const t = await page.evaluate(() => db.threads[0]);
      eq(t.canal, 'whatsapp', 'canal');
      eq(t.nom, 'Camille Rousseau', 'nom du contact');
      eq(t.nonLus, 1, 'message non lu');
      eq(t.statut, 'nouveau', 'statut initial');
      eq(t.fiche.lignes[0].qty, 80, 'qualification automatique à la réception');
      includes(await page.locator('#mg-list').innerText(), 'Camille Rousseau', 'affichée dans la liste');
    });

    await test('O2 — deuxième synchronisation : aucun doublon', async () => {
      const r = await page.evaluate(() => msgSync(true));
      eq(r.ok, true, 'appel réussi');
      eq(await page.evaluate(() => db.threads.length), 1, 'toujours une seule conversation');
      eq(await page.evaluate(() => db.threads[0].messages.length), 1, 'toujours un seul message');
    });

    await test('O3 — envoi via le connecteur, dans la fenêtre', async () => {
      await page.evaluate(() => msgOuvrir(db.threads[0].id));
      await page.waitForSelector('#mg-txt');
      includes(await page.locator('.mg-fen').innerText(), 'Fenêtre de réponse ouverte', 'fenêtre annoncée ouverte');
      await page.fill('#mg-txt', 'Bonjour Camille, je vous prépare le devis.');
      await page.click('button:has-text("Envoyer")');
      await page.waitForTimeout(250);
      eq(envois.length, 1, 'un envoi transmis au connecteur');
      eq(envois[0].canal, 'whatsapp', 'canal transmis');
      eq(envois[0].extId, '33612345678', 'destinataire transmis');
      includes(envois[0].texte, 'devis', 'texte transmis');
      const t = await page.evaluate(() => db.threads[0]);
      eq(t.messages.length, 2, 'message ajouté au fil');
      eq(t.messages[1].etat, 'envoye', 'marqué comme envoyé');
      eq(t.nonLus, 0, 'compteur remis à zéro');
    });

    await test('O4 — réponse proposée par l\'assistant avant envoi', async () => {
      await page.evaluate(() => msgProposer(db.threads[0].id));
      const v = await page.inputValue('#mg-txt');
      ok(/^Bonjour Camille/.test(v), 'brouillon personnalisé');
      includes(v, 'Tim Event', 'signature');
      eq(await page.evaluate(() => db.threads[0].messages.length), 2, 'rien n\'est envoyé sans clic');
    });

    await test('O5 — fenêtre fermée : envoi libre bloqué, message conservé', async () => {
      await page.evaluate(() => {
        db.threads[0].messages[0].ts = Date.now() - 30 * 3600000;
        db.threads[0].messages = [db.threads[0].messages[0]];
        saveDB(); msgOuvrir(db.threads[0].id);
      });
      await page.waitForSelector('.mg-fen.ko');
      includes(await page.locator('.mg-fen').innerText(), 'Fenêtre de 24 h fermée', 'avertissement affiché');
      includes(await page.locator('.mg-rep').innerText(), 'brouillon', 'le bouton propose un brouillon');
    });

    await test('O6 — connecteur en panne : brouillon conservé, aucune perte', async () => {
      await app.ctx.unroute(CONNECTEUR + '/**');
      await brancher(app, { hs: true });
      await clearToasts(page);
      await page.evaluate(() => {
        db.threads[0].messages[0].ts = Date.now() - 600000; saveDB(); msgOuvrir(db.threads[0].id);
      });
      await page.fill('#mg-txt', 'Message pendant la panne');
      await page.click('button:has-text("Envoyer")');
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => db.threads[0].messages[db.threads[0].messages.length - 1]);
      eq(m.texte, 'Message pendant la panne', 'message conservé');
      eq(m.etat, 'erreur', 'échec signalé');
      includes(await toasts(page), 'brouillon', 'utilisateur prévenu');
      const r = await page.evaluate(() => msgSync(true));
      eq(r.ok, false, 'synchronisation en échec signalée');
      eq(await page.evaluate(() => db.threads.length), 1, 'conversations locales intactes');
    });

    await test('O7 — jeton invalide : refus propre', async () => {
      await app.ctx.unroute(CONNECTEUR + '/**');
      await brancher(app, { threads: [] });
      await page.evaluate(() => msgSaveParams({ token: 'mauvais-jeton' }));
      const r = await page.evaluate(() => msgSync(true));
      eq(r.ok, false, 'refus détecté');
      eq(r.motif, 'injoignable', 'motif remonté');
      await page.evaluate(() => msgSaveParams({ token: 'jeton-test' }));
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('P · Premier niveau automatique et réglages');
  // ═══════════════════════════════════════════════════════════
  {
    await test('P1 — accusé automatique désactivé par défaut', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      const envois = await brancher(app, { threads: [threadWA('Bonjour, vous avez des chaises ?', 5)] });
      await app.page.evaluate(() => msgSync(false));
      await app.page.evaluate(() => msgAccuse(db.threads[0]));
      await app.page.waitForTimeout(150);
      eq(envois.length, 0, 'aucun envoi automatique sans activation');
      eq(await app.page.evaluate(() => db.settings.messagerie.accuse), false, 'réglage désactivé par défaut');
      await app.ctx.close();
    });

    await test('P2 — accusé automatique activé : un seul envoi, mention obligatoire', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      const envois = await brancher(app, { threads: [threadWA('Bonjour, je cherche 80 chaises pour le 12 septembre', 5)] });
      await app.page.evaluate(() => { msgSaveParams({ accuse: true }); return msgSync(false); });
      await app.page.evaluate(async () => { await msgAccuse(db.threads[0]); await msgAccuse(db.threads[0]); });
      await app.page.waitForTimeout(200);
      eq(envois.length, 1, 'un seul accusé, même appelé deux fois');
      includes(envois[0].texte, 'Réponse automatique', 'mention explicite');
      includes(envois[0].texte, 'Bonjour Camille', 'personnalisé');
      const t = await app.page.evaluate(() => db.threads[0]);
      eq(t.messages[t.messages.length - 1].auteur, 'assistant', 'message attribué à l\'assistant');
      const a = await app.page.evaluate(() => db.audit.filter(x => x.type === 'messagerie').length);
      ok(a >= 1, 'trace dans la piste d\'audit');
      await app.ctx.close();
    });

    await test('P3 — accusé bloqué si une réponse humaine existe déjà', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      const envois = await brancher(app, { threads: [threadWA('Bonjour', 5)] });
      await app.page.evaluate(async () => {
        msgSaveParams({ accuse: true });
        await msgSync(false);
        db.threads[0].messages.push({ id: 'moi-1', sens: 'out', texte: 'Bonjour, je vous réponds', ts: Date.now(), auteur: 'moi', etat: 'envoye' });
        saveDB();
        await msgAccuse(db.threads[0]);
      });
      await app.page.waitForTimeout(150);
      eq(envois.length, 0, 'pas de doublon avec la réponse humaine');
      await app.ctx.close();
    });

    await test('P4 — réglages : enregistrement, test de connexion, canaux', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      await brancher(app, { threads: [] });
      const page = app.page;
      await page.evaluate(() => { go('settings'); sTab('messagerie', null); });
      await page.waitForSelector('#mg-set-url', { state: 'attached' });
      await page.evaluate(() => {
        document.getElementById('mg-set-sign').value = 'Tim Event · Lyon';
        document.getElementById('mg-set-tt').checked = true;
        saveMsgSettings();
      });
      eq(await page.evaluate(() => db.settings.messagerie.signature), 'Tim Event · Lyon', 'signature enregistrée');
      eq(await page.evaluate(() => db.settings.messagerie.canaux.tiktok), true, 'canal TikTok activé');
      await page.evaluate(() => msgTest());
      await page.waitForTimeout(250);
      includes(await page.locator('#mg-set-etat').innerText(), 'joignable', 'test de connexion affiché');
      await app.ctx.close();
    });

    await test('P5 — démonstration hors connecteur', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      await app.page.evaluate(() => { go('messagerie'); msgDemo(); });
      await app.page.waitForTimeout(150);
      eq(await app.page.evaluate(() => db.threads.length), 2, 'deux conversations chargées');
      const f = await app.page.evaluate(() => db.threads.map(t => t.fiche.besoin));
      ok(f.indexOf('devis') >= 0, 'demande de prix qualifiée');
      ok(f.indexOf('dispo') >= 0, 'question de disponibilité qualifiée');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('Q · Robustesse et non-régression');
  // ═══════════════════════════════════════════════════════════
  {
    await test('Q1 — base sans messagerie : réglages et tableau recréés', async () => {
      const d = dbMsg(); delete d.settings.messagerie; delete d.threads;
      const app = await openApp(browser, { db: d });
      const m = await app.page.evaluate(() => db.settings.messagerie);
      eq(m.actif, true, 'messagerie active par défaut');
      eq(m.url, '', 'aucun connecteur par défaut');
      eq(m.accuse, false, 'aucune réponse automatique par défaut');
      eq(await app.page.evaluate(() => Array.isArray(db.threads)), true, 'tableau des conversations recréé');
      await app.ctx.close();
    });

    await test('Q2 — messages hostiles ou malformés : aucune injection, aucun plantage', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      const r = await app.page.evaluate(() => {
        const cas = ['<script>window.__pwn=1</script>', '<img src=x onerror="window.__pwn=1">',
          '', '   ', '💥💥💥', 'a'.repeat(5000), '{"json":"cassé"', 'DROP TABLE clients;'];
        let ko = 0;
        cas.forEach((c, i) => {
          try {
            const t = { id: 900 + i, canal: 'whatsapp', nom: 'Test', tel: '', statut: 'nouveau', nonLus: 1,
              messages: [{ id: 'h' + i, sens: 'in', texte: c, ts: Date.now(), auteur: 'client' }] };
            t.fiche = msgQualifie(t); t.dernier = Date.now();
            db.threads.push(t);
          } catch (e) { ko++; }
        });
        saveDB(); go('messagerie');
        db.threads.forEach(t => { try { msgThreadHTML(t); msgResume(t); msgReponse(t); } catch (e) { ko++; } });
        return { ko: ko, pwn: !!window.__pwn, n: db.threads.length };
      });
      eq(r.ko, 0, 'aucune exception');
      eq(r.pwn, false, 'aucun script injecté exécuté');
      eq(r.n, 8, 'toutes les conversations conservées');
      const errs = app.errors.filter(e => !/SpeechRecognition/.test(e));
      eq(errs.length, 0, 'aucune erreur console : ' + errs.join(' | '));
      await app.ctx.close();
    });

    await test('Q3 — aucun appel réseau hors connecteur déclaré', async () => {
      const app = await openApp(browser, { db: dbMsg() });
      const externes = [];
      await app.ctx.route('**/*', route => {
        const u = route.request().url();
        if (!/app\.test|connecteur\.test|fonts\.|data:|blob:/.test(u)) externes.push(u);
        route.continue();
      });
      await brancher(app, { threads: [threadWA('Bonjour', 5)] });
      await app.page.evaluate(async () => { go('messagerie'); await msgSync(true); msgOuvrir(db.threads[0].id); msgProposer(db.threads[0].id); });
      await app.page.waitForTimeout(400);
      eq(externes.length, 0, 'appels inattendus : ' + externes.join(', '));
      await app.ctx.close();
    });

    await test('Q4 — devis saisi à la main : comportement inchangé', async () => {
      const app = await openApp(browser, { db: dbMsg() });
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
      near(await page.evaluate(() => db.devis[0].montantHT), 250, 'montant inchangé');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  await browser.close();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  let nOk = 0, nKo = 0, nChecks = 0;
  results.forEach(s => s.tests.forEach(t => { nChecks += t.checks; t.ok ? nOk++ : nKo++; }));

  const lines = [];
  lines.push('# Tim Event — Rapport de tests (Phase 4 · Messagerie unifiée)');
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
  fs.writeFileSync(path.join(__dirname, '..', 'rapport-messagerie.md'), lines.join('\n'), 'utf8');

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${nOk} réussis / ${nOk + nKo} scénarios · ${nChecks} assertions · ${dur}s`);
  console.log('═'.repeat(60));
  process.exit(nKo ? 1 : 0);
})();
