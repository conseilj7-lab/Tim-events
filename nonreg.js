/* Tim Event — suite de non-régression Phase 2 (livraison) + app complète */
const fs = require('fs');
const path = require('path');
const L = require('./lib.js');
const {
  chromium, results, section, test, ok, eq, near, includes, notIncludes,
  N, r2, oracleLivraison, refParams, baseDB, openApp,
  openDevisModal, openEditDevis, setLine, fillLiv, readTotals, money, toasts, clearToasts
} = L;

const SAVE_DV = 'button:has-text("Créer le devis")';
const SAVE_EDIT = '.mo-foot button:has-text("Enregistrer")';

(async () => {
  const browser = await chromium.launch();
  const t0 = Date.now();

  // ═══════════════════════════════════════════════════════════
  section('A · Moteur de calcul (fonction pure)');
  // ═══════════════════════════════════════════════════════════
  {
    const app = await openApp(browser);
    const P = refParams();
    const evalLiv = (cases, params) => app.page.evaluate(([cs, p]) => cs.map(c => computeLivraison(c, p)), [cases, params || P]);

    await test('A1 — matrice modes × distances × montants × prix négocié (480 cas) conforme à l\'oracle', async () => {
      const modes = ['retrait', 'livraison', 'aller_retour'];
      const dists = [0, 0.4, 12.7, 45, 119.9, 120, 120.1, 350];
      const monts = [0, 100, 899.99, 900, 5000];
      const negos = [null, 0, 25, 300];
      const cases = [];
      modes.forEach(m => dists.forEach(d => monts.forEach(mo => negos.forEach(ng => {
        cases.push({ mode: m, distanceKm: d, montantLocationHT: mo, prixNegocieHT: ng, supplements: {} });
      }))));
      const got = await evalLiv(cases);
      eq(got.length, cases.length, 'nombre de résultats');
      let bad = 0;
      got.forEach((g, i) => {
        const e = oracleLivraison(cases[i], P);
        const c = cases[i];
        const tag = `[${c.mode} ${c.distanceKm}km ${c.montantLocationHT}€ nego=${c.prixNegocieHT}]`;
        if (Math.abs(g.totalHT - e.totalHT) > 0.005 || g.offerte !== e.offerte || g.horsZone !== e.horsZone ||
          g.motifPrix !== e.motifPrix || Math.abs(g.prixRetenuHT - e.prixRetenuHT) > 0.005 ||
          g.margeNegative !== e.margeNegative) {
          if (bad++ < 6) ok(false, `${tag} moteur ${JSON.stringify({ t: g.totalHT, p: g.prixRetenuHT, m: g.motifPrix, o: g.offerte, hz: g.horsZone, mn: g.margeNegative })} ≠ oracle ${JSON.stringify({ t: e.totalHT, p: e.prixRetenuHT, m: e.motifPrix, o: e.offerte, hz: e.horsZone, mn: e.margeNegative })}`);
        }
        if (Object.values(g).some(v => typeof v === 'number' && !isFinite(v))) ok(false, `${tag} valeur non finie`);
      });
      ok(bad === 0, bad ? `${bad} cas divergents` : '');
      if (bad === 0) ok(true, '');
    });

    await test('A2 — 64 combinaisons de suppléments × 3 modes conformes à l\'oracle', async () => {
      const flags = ['nappage', 'etage', 'creneau', 'dimanche', 'portage', 'attente'];
      const cases = [];
      for (let mask = 0; mask < 64; mask++) {
        const sup = {};
        if (mask & 1) sup.nappage = { convives: 80 };
        if (mask & 2) sup.etageSansAsc = { niveaux: 3 };
        if (mask & 4) sup.creneauImpose = true;
        if (mask & 8) sup.repriseDimanche = true;
        if (mask & 16) sup.portageLong = true;
        if (mask & 32) sup.attente = { heures: 2 };
        ['retrait', 'livraison', 'aller_retour'].forEach(m => {
          cases.push({ mode: m, distanceKm: 30, montantLocationHT: 400, supplements: sup, prixNegocieHT: null });
        });
      }
      const got = await evalLiv(cases);
      let bad = 0;
      got.forEach((g, i) => {
        const e = oracleLivraison(cases[i], P);
        if (Math.abs(g.supplementsHT - e.supplementsHT) > 0.005 || Math.abs(g.totalHT - e.totalHT) > 0.005) {
          if (bad++ < 5) ok(false, `combo ${i} : sup ${g.supplementsHT}/${e.supplementsHT}, total ${g.totalHT}/${e.totalHT}`);
        }
        if (Math.abs(g.totalHT - r2(g.prixRetenuHT + g.supplementsHT)) > 0.005 && !g.horsZone) {
          if (bad++ < 5) ok(false, `combo ${i} : total ≠ prix retenu + suppléments`);
        }
      });
      ok(bad === 0, bad ? `${bad} combinaisons divergentes` : '');
      if (bad === 0) ok(true, '');
    });

    await test('A3 — retrait : aucun montant (ni course ni suppléments de livraison)', async () => {
      const [r] = await evalLiv([{ mode: 'retrait', distanceKm: 80, montantLocationHT: 200, supplements: { creneauImpose: true, portageLong: true } }]);
      eq(r.prixRetenuHT, 0, 'prix livraison');
      eq(r.supplementsHT, 0, 'suppléments de livraison neutralisés');
      eq(r.totalHT, 0, 'total HT');
      eq(r.totalTTC, 0, 'total TTC');
      eq(r.margeNegative, false, 'aucune alerte marge en retrait');
      eq(r.motifPrix, 'retrait', 'motif');
    });

    await test('A4 — livraison 30 km : prix = arrondi_sup(coût × 1,25) et marge cohérente', async () => {
      const [r] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 300, supplements: {} }]);
      const km = 60, tempsH = 50 / 60 + 60 / 55;
      const cout = km * 0.494 + tempsH * 21.94 + 15;
      near(r.kmParcourus, km, 'km parcourus (2 trajets)');
      near(r.coutRevient, r2(cout), 'coût de revient');
      eq(r.prixBaseHT % 10, 0, 'prix arrondi à 10 €');
      ok(r.prixBaseHT >= cout * 1.25 - 1e-9, 'prix ≥ coût × 1,25');
      ok(r.prixBaseHT < cout * 1.25 + 10, 'arrondi au palier immédiatement supérieur');
      near(r.margeEur, r2(r.prixRetenuHT - r.coutRevient), 'marge € = prix − coût');
      near(r.margePct, r2((r.prixRetenuHT - r.coutRevient) / r.coutRevient * 100), 'marge %');
    });

    await test('A5 — aller-retour : 4 trajets, manutention 105 min', async () => {
      const [ar] = await evalLiv([{ mode: 'aller_retour', distanceKm: 30, montantLocationHT: 300, supplements: {} }]);
      const [li] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 300, supplements: {} }]);
      eq(ar.trajets, 4, 'trajets A/R');
      near(ar.kmParcourus, 120, 'km A/R');
      near(ar.tempsH, r2(105 / 60 + 120 / 55), 'temps A/R');
      ok(ar.prixRetenuHT > li.prixRetenuHT, 'A/R plus cher que livraison seule');
    });

    await test('A6 — seuil de livraison offerte : bornes 899,99 / 900 / seuil 0', async () => {
      const [a, b] = await evalLiv([
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 899.99, supplements: {} },
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 900, supplements: {} }]);
      eq(a.offerte, false, '899,99 € → non offerte');
      eq(b.offerte, true, '900 € → offerte');
      eq(b.prixRetenuHT, 0, 'prix offert = 0');
      ok(b.coutAbsorbe > 0, 'coût absorbé renseigné');
      eq(b.margeNegative, false, 'offerte ≠ marge négative bloquante');
      const [c] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 0, supplements: {} }], refParams({ seuilLivraisonOfferte: 0 }));
      eq(c.offerte, false, 'seuil 0 = jamais offerte (et non « toujours »)');
    });

    await test('A7 — rayon max : bornes 119,9 / 120 / 120,1', async () => {
      const [a, b, c] = await evalLiv([
        { mode: 'livraison', distanceKm: 119.9, montantLocationHT: 100, supplements: {} },
        { mode: 'livraison', distanceKm: 120, montantLocationHT: 100, supplements: {} },
        { mode: 'livraison', distanceKm: 120.1, montantLocationHT: 100, supplements: {} }]);
      eq(a.horsZone, false, '119,9 km dans la zone');
      eq(b.horsZone, false, '120 km inclus (borne)');
      eq(c.horsZone, true, '120,1 km hors zone');
      eq(c.totalHT, 0, 'hors zone : aucun montant automatique');
      eq(c.margeNegative, false, 'hors zone : pas d\'alerte marge');
    });

    await test('A8 — prix négocié : prime sur le calcul, sur l\'offre et sur le hors zone', async () => {
      const [neg, off, hz] = await evalLiv([
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 100, prixNegocieHT: 55, supplements: {} },
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 5000, prixNegocieHT: 55, supplements: {} },
        { mode: 'livraison', distanceKm: 300, montantLocationHT: 100, prixNegocieHT: 420, supplements: {} }]);
      eq(neg.prixRetenuHT, 55, 'prix négocié appliqué');
      eq(neg.motifPrix, 'negocie', 'motif négocié');
      eq(off.offerte, false, 'un prix négocié annule l\'offre automatique');
      eq(off.prixRetenuHT, 55, 'prix négocié conservé au-delà du seuil');
      eq(hz.horsZone, true, 'toujours signalé hors zone');
      eq(hz.totalHT, 420, 'hors zone chiffré si prix négocié (devis sur mesure)');
    });

    await test('A9 — marge négative détectée uniquement quand elle est subie', async () => {
      const [bas, nul, off] = await evalLiv([
        { mode: 'aller_retour', distanceKm: 60, montantLocationHT: 200, prixNegocieHT: 10, supplements: {} },
        { mode: 'aller_retour', distanceKm: 60, montantLocationHT: 200, prixNegocieHT: 0, supplements: {} },
        { mode: 'aller_retour', distanceKm: 60, montantLocationHT: 5000, supplements: {} }]);
      eq(bas.margeNegative, true, '10 € pour un coût supérieur → marge négative');
      ok(bas.margeEur < 0, 'marge € négative');
      eq(nul.margeNegative, true, 'prix négocié à 0 → marge négative');
      eq(off.margeNegative, false, 'livraison offerte → décision commerciale, pas d\'erreur');
      ok(off.coutAbsorbe > 0, 'coût absorbé affiché à la place');
    });

    await test('A10 — seuil d\'alerte de marge (15 % par défaut, paramétrable)', async () => {
      const [r] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 100, prixNegocieHT: 999, supplements: {} }]);
      eq(r.margeAlerte, false, 'grosse marge → pas d\'alerte');
      const [r2c] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 100, supplements: {} }], refParams({ marge: 0.05, arrondi: 0 }));
      eq(r2c.margeAlerte, true, 'marge 5 % → alerte');
      const [r3] = await evalLiv([{ mode: 'livraison', distanceKm: 30, montantLocationHT: 100, supplements: {} }], refParams({ marge: 0.05, arrondi: 0, seuilAlerteMarge: 2 }));
      eq(r3.margeAlerte, false, 'seuil d\'alerte abaissé à 2 % → plus d\'alerte');
    });

    await test('A11 — suppléments : franchise d\'attente, minimum de nappage, cumul', async () => {
      const cases = [
        { s: { attente: { heures: 0.5 } }, exp: 0, lbl: '30 min = franchise → 0 €' },
        { s: { attente: { heures: 1.5 } }, exp: 35, lbl: '1 h 30 → 1 h facturée' },
        { s: { attente: { heures: 3 } }, exp: 87.5, lbl: '3 h → 2,5 h facturées' },
        { s: { nappage: { convives: 10 } }, exp: 100, lbl: '10 convives → minimum 100 €' },
        { s: { nappage: { convives: 200 } }, exp: 240, lbl: '200 convives → 240 €' },
        { s: { nappage: { convives: 0 } }, exp: 0, lbl: '0 convive → rien' },
        { s: { etageSansAsc: { niveaux: 3 } }, exp: 120, lbl: '3 niveaux → 120 €' },
        { s: { creneauImpose: true, repriseDimanche: true, portageLong: true }, exp: 170, lbl: 'cumul forfaits' }
      ];
      const got = await evalLiv(cases.map(c => ({ mode: 'livraison', distanceKm: 10, montantLocationHT: 0, supplements: c.s })));
      got.forEach((g, i) => near(g.supplementsHT, cases[i].exp, cases[i].lbl));
    });

    await test('A12 — l\'attente allonge le temps donc le coût de revient', async () => {
      const [sans, avec] = await evalLiv([
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 100, supplements: {} },
        { mode: 'livraison', distanceKm: 30, montantLocationHT: 100, supplements: { attente: { heures: 2.5 } } }]);
      near(avec.tempsH - sans.tempsH, 2, 'temps + 2 h (franchise 30 min déduite)');
      ok(avec.coutRevient > sans.coutRevient, 'coût de revient plus élevé');
    });

    await test('A13 — saisies aberrantes : négatifs, vides, texte — aucun NaN, aucun montant négatif', async () => {
      const cases = [
        { mode: 'livraison', distanceKm: -50, montantLocationHT: -100, supplements: { nappage: { convives: -10 }, etageSansAsc: { niveaux: -2 }, attente: { heures: -3 } }, prixNegocieHT: -80 },
        { mode: 'aller_retour', distanceKm: '', montantLocationHT: '', supplements: {}, prixNegocieHT: '' },
        { mode: 'aller_retour', distanceKm: 'abc', montantLocationHT: 'xx', supplements: { nappage: { convives: 'zz' } }, prixNegocieHT: 'oui' },
        { mode: 'livraison', distanceKm: null, montantLocationHT: null, supplements: null, prixNegocieHT: null },
        { mode: undefined, distanceKm: 10, montantLocationHT: 10, supplements: {} },
        {}
      ];
      const got = await evalLiv(cases);
      got.forEach((g, i) => {
        Object.entries(g).forEach(([k, v]) => { if (typeof v === 'number' && !isFinite(v)) ok(false, `cas ${i} : ${k} non fini`); });
        ok(g.totalHT >= 0, `cas ${i} : total HT jamais négatif (${g.totalHT})`);
        ok(g.prixRetenuHT >= 0, `cas ${i} : prix retenu jamais négatif`);
        ok(g.distanceKm >= 0, `cas ${i} : distance ramenée à ≥ 0`);
      });
      eq(got[0].distanceManquante, true, 'distance négative traitée comme manquante');
      eq(got[1].distanceManquante, true, 'distance vide traitée comme manquante');
    });

    await test('A14 — paramètres extrêmes : vitesse 0, arrondis 0, marge négative, rayon 0', async () => {
      const variants = [
        ['vitesse 0', refParams({ vitesseMoyenne: 0 })],
        ['arrondis 0', refParams({ arrondi: 0, arrondiMin: 0 })],
        ['marge −50 %', refParams({ marge: -0.5 })],
        ['rayon 0', refParams({ rayonMax: 0 })],
        ['nb trajets 0', refParams({ nbTrajetsAR: 0, nbTrajetsLivraison: 0 })],
        ['coûts 0', refParams({ coutKm: 0, coutHoraire: 0, coutStructure: 0 })]
      ];
      for (const [lbl, p] of variants) {
        const [g] = await app.page.evaluate(([c, p]) => [computeLivraison(c, p)], [{ mode: 'aller_retour', distanceKm: 30, montantLocationHT: 100, supplements: { attente: { heures: 2 } } }, p]);
        Object.entries(g).forEach(([k, v]) => { if (typeof v === 'number' && !isFinite(v)) ok(false, `${lbl} : ${k} non fini`); });
        ok(g.totalHT >= 0, `${lbl} : total ≥ 0`);
        const e = oracleLivraison({ mode: 'aller_retour', distanceKm: 30, montantLocationHT: 100, supplements: { attente: { heures: 2 } } }, p);
        near(g.totalHT, e.totalHT, `${lbl} : total conforme à l'oracle`);
      }
    });

    await test('A15 — TVA du poste livraison alignée sur le taux du document', async () => {
      for (const taux of [0, 5.5, 10, 20]) {
        const [g] = await app.page.evaluate(([c, p]) => [computeLivraison(c, p)], [{ mode: 'livraison', distanceKm: 30, montantLocationHT: 100, supplements: { creneauImpose: true } }, refParams({ tva: taux })]);
        near(g.totalTTC, r2(g.totalHT * (1 + taux / 100)), `TTC à ${taux} %`);
      }
      const aligne = await app.page.evaluate(() => { db.settings.tvaRate = 20; db.settings.livraison.tva = 5; return livParams().tva; });
      eq(aligne, 20, 'livParams() force la TVA du document (et ignore une valeur périmée)');
      await app.page.evaluate(() => { db.settings.tvaRate = 0; });
    });

    await test('A16 — fonction pure : déterministe et sans effet de bord sur l\'entrée', async () => {
      const res = await app.page.evaluate(p => {
        const input = { mode: 'aller_retour', distanceKm: 42.4, montantLocationHT: 500, supplements: { nappage: { convives: 60 }, attente: { heures: 2 } }, prixNegocieHT: 180 };
        const snap = JSON.stringify(input);
        const a = computeLivraison(input, p), b = computeLivraison(input, p);
        const pSnap = JSON.stringify(p);
        return { same: JSON.stringify(a) === JSON.stringify(b), inputIntact: JSON.stringify(input) === snap, paramsIntact: JSON.stringify(p) === pSnap, a };
      }, P);
      eq(res.same, true, 'deux appels identiques donnent le même résultat');
      eq(res.inputIntact, true, 'l\'objet d\'entrée n\'est pas modifié');
      eq(res.paramsIntact, true, 'les paramètres ne sont pas modifiés');
    });

    await app.ctx.close();
  }

  // ═══════════════════════════════════════════════════════════
  section('B · Section « Livraison » du formulaire de devis');
  // ═══════════════════════════════════════════════════════════
  {
    await test('B1 — la section existe, retrait par défaut, corps replié', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      ok(await app.page.isVisible('#dv-liv-mr'), 'bouton Retrait dépôt');
      ok(await app.page.isVisible('#dv-liv-ml'), 'bouton Livraison');
      ok(await app.page.isVisible('#dv-liv-mar'), 'bouton Livraison + reprise');
      eq(await app.page.inputValue('#dv-liv-mode'), 'retrait', 'mode par défaut');
      eq(await app.page.isVisible('#dv-liv-body'), false, 'corps masqué en retrait');
      eq(await app.page.evaluate(() => document.getElementById('dv-liv-result').innerHTML), '', 'aucun encart de prix');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('B2 — bascule livraison : corps déplié + adresse pré-remplie depuis la fiche client', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await app.page.click('#dv-liv-ml');
      eq(await app.page.isVisible('#dv-liv-body'), true, 'corps visible');
      eq(await app.page.inputValue('#dv-liv-addr'), '12 rue des Fleurs, 69003 Lyon', 'adresse client reprise');
      // ne doit pas écraser une saisie existante
      await app.page.fill('#dv-liv-addr', 'Château de Bagnols');
      await app.page.click('#dv-liv-mar');
      eq(await app.page.inputValue('#dv-liv-addr'), 'Château de Bagnols', 'saisie manuelle conservée au changement de mode');
      eq(await app.page.inputValue('#dv-liv-mode'), 'aller_retour', 'mode A/R actif');
      await app.ctx.close();
    });

    await test('B3 — prix affiché en direct et répercuté sur les totaux du devis', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      const avant = await readTotals(app.page);
      near(money(avant.ht), 250, 'total HT sans livraison');
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      const apres = await readTotals(app.page);
      near(money(apres.ht), r2(250 + res.totalHT), 'total HT = articles + livraison');
      near(money(apres.st), 250, 'sous-total articles inchangé');
      const box = await app.page.textContent('#dv-liv-result');
      includes(box, 'Livraison — ', 'libellé client');
      includes(box, '30 km · aller simple', 'distance en sous-titre (format FR)');
      includes(box, 'Vue interne', 'encart admin présent');
      await app.ctx.close();
    });

    await test('B4 — cases suppléments : lignes détaillées et total recalculé à chaque clic', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 20 });
      const base = await app.page.evaluate(() => window._dvLiv.res.totalHT);
      await fillLiv(app.page, { sup: { nappage: 80, etage: 2, creneau: true, dimanche: true, portage: true, attente: 2 } });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.supplements.length, 6, '6 lignes de suppléments');
      near(res.supplementsHT, 100 + 80 + 50 + 80 + 40 + 52.5, 'somme des suppléments (nappage au minimum de 100 €)');
      near(res.totalHT, r2(res.prixRetenuHT + res.supplementsHT), 'total livraison = prix + suppléments');
      ok(res.totalHT > base, 'total augmenté');
      const box = await app.page.textContent('#dv-liv-result');
      ['Mise en place et nappage', 'Étage sans ascenseur', 'Créneau horaire imposé', 'Reprise le dimanche soir', 'Portage long', 'Attente sur place']
        .forEach(lbl => includes(box, lbl, 'ligne « ' + lbl + ' »'));
      // décocher revient à l'état initial
      await app.page.setChecked('#dv-liv-nap', false); await app.page.setChecked('#dv-liv-eta', false);
      await app.page.setChecked('#dv-liv-cre', false); await app.page.setChecked('#dv-liv-dim', false);
      await app.page.setChecked('#dv-liv-por', false); await app.page.setChecked('#dv-liv-att', false);
      await app.page.evaluate(() => calcDvTotal());
      near(await app.page.evaluate(() => window._dvLiv.res.totalHT), base, 'retour à l\'état initial après décochage');
      await app.ctx.close();
    });

    await test('B5 — vue admin : distance, km, temps, coût, marge €/% et prix retenu', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4 });
      const box = await app.page.textContent('#dv-liv-result');
      const res = await app.page.evaluate(() => window._dvLiv.res);
      includes(box, 'Distance / km parcourus', 'ligne distance');
      includes(box, '42,4 km / 169,6 km', 'km parcourus (4 trajets), format français');
      includes(box, 'Temps estimé', 'ligne temps');
      includes(box, String(res.tempsH).replace('.', ',') + ' h', 'valeur du temps');
      includes(box, 'Coût de revient', 'ligne coût de revient');
      includes(box, 'Prix calculé (barème)', 'ligne prix calculé');
      includes(box, 'Prix retenu', 'ligne prix retenu');
      includes(box, 'Marge livraison', 'ligne marge');
      includes(box, String(res.margePct).replace('.', ',') + ' %', 'marge en %');
      includes(box, 'Minimum de commande', 'minimum de commande');
      notIncludes(await app.page.textContent('#dv-liv-result'), 'NaN', 'aucun NaN affiché');
      await app.ctx.close();
    });

    await test('B6 — prix négocié : remplace le prix calculé et recalcule la marge', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      const calc = await app.page.evaluate(() => window._dvLiv.res);
      await fillLiv(app.page, { nego: 120 });
      const nego = await app.page.evaluate(() => window._dvLiv.res);
      eq(nego.prixRetenuHT, 120, 'prix retenu = prix négocié');
      eq(nego.motifPrix, 'negocie', 'origine du prix');
      near(nego.margeEur, r2(120 - calc.coutRevient), 'marge recalculée sur le prix négocié');
      const totals = await readTotals(app.page);
      near(money(totals.ht), r2(80 + 120), 'total du devis avec le prix négocié');
      includes(await app.page.textContent('#dv-liv-nego-msg'), 'Prix négocié appliqué', 'message sous le champ');
      // champ vidé → retour au prix calculé
      await fillLiv(app.page, { nego: null });
      eq(await app.page.evaluate(() => window._dvLiv.res.prixRetenuHT), calc.prixBaseHT, 'champ vide → prix du barème');
      await app.ctx.close();
    });

    await test('B7 — marge négative : indicateur rouge + enregistrement bloqué', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 60, nego: 5 });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.margeNegative, true, 'marge négative détectée');
      const style = await app.page.getAttribute('#dv-liv-nego', 'style');
      includes(style, '--err', 'bordure rouge sur le champ prix négocié');
      includes(await app.page.textContent('#dv-liv-result'), 'enregistrement bloqué', 'avertissement dans la vue interne');
      await clearToasts(app.page);
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 0, 'aucun devis créé');
      includes(await toasts(app.page), 'Marge négative', 'message d\'erreur affiché');
      ok(await app.page.isVisible('#dv-client'), 'la fenêtre reste ouverte pour correction');
      // correction → enregistrement possible
      await fillLiv(app.page, { nego: 400 });
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 1, 'devis créé après correction');
      await app.ctx.close();
    });

    await test('B8 — distance à 0 : enregistrement bloqué, sauf prix négocié', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 0 });
      await clearToasts(app.page);
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 0, 'devis refusé sans distance');
      includes(await toasts(app.page), 'Distance à 0 km', 'message explicite');
      await fillLiv(app.page, { nego: 90 });
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 1, 'accepté avec un prix négocié');
      eq(await app.page.evaluate(() => db.devis[0].livraison.prixRetenuHT), 90, 'prix négocié enregistré');
      await app.ctx.close();
    });

    await test('B9 — hors zone : alerte, aucun montant automatique, devis enregistrable et tracé', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 250 });
      includes(await app.page.textContent('#dv-liv-result'), 'Hors zone', 'alerte hors zone');
      near(money((await readTotals(app.page)).ht), 80, 'aucun montant de livraison ajouté');
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      eq(dv.livraison.horsZone, true, 'hors zone figé sur le devis');
      eq(dv.livraison.totalHT, 0, 'montant livraison à 0');
      near(dv.montantHT, 80, 'total du devis = articles seuls');
      const audit = await app.page.evaluate(() => JSON.stringify(db.audit));
      includes(audit, 'hors zone', 'entrée de piste d\'audit pour l\'admin');
      await app.ctx.close();
    });

    await test('B10 — livraison offerte au-delà du seuil : 0 € client, coût absorbé côté admin', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Pack mariage', qty: 1, prix: 1200 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 25 });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.offerte, true, 'offerte');
      eq(res.totalHT, 0, 'rien facturé');
      const box = await app.page.textContent('#dv-liv-result');
      includes(box, 'Offerte', 'mention « Offerte »');
      includes(box, 'Coût absorbé', 'coût absorbé visible côté admin');
      near(money((await readTotals(app.page)).ht), 1200, 'total inchangé');
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 1, 'enregistrement non bloqué');
      await app.ctx.close();
    });

    await test('B11 — offerte + suppléments : seuls les suppléments sont facturés', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Pack', qty: 1, prix: 1500 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 25, sup: { nappage: 100, creneau: true } });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.prixRetenuHT, 0, 'livraison offerte');
      near(res.supplementsHT, 170, 'suppléments 120 + 50');
      near(res.totalHT, 170, 'total = suppléments seuls');
      near(money((await readTotals(app.page)).ht), 1670, 'total devis');
      await app.ctx.close();
    });

    await test('B12 — bascule livraison → retrait : le poste livraison est entièrement annulé', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30, sup: { nappage: 50, portage: true } });
      ok(await app.page.evaluate(() => window._dvLiv.res.totalHT) > 0, 'poste livraison chiffré avant bascule');
      await app.page.click('#dv-liv-mr');
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.mode, 'retrait', 'mode retrait');
      eq(res.prixRetenuHT, 0, 'aucun prix de course');
      eq(res.supplementsHT, 0, 'suppléments de livraison neutralisés');
      near(money((await readTotals(app.page)).ht), 80, 'total = articles seuls');
      eq(await app.page.isVisible('#dv-liv-body'), false, 'les cases suppléments sont masquées, cohérent avec le calcul');
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      eq(dv.livraison.mode, 'retrait', 'copie figée en retrait');
      near(dv.montantHT, 80, 'montant enregistré');
      await app.ctx.close();
    });

    await test('B13 — module désactivé : section absente, devis existant préservé', async () => {
      const app = await openApp(browser);
      // 1) devis avec livraison
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.click(SAVE_DV);
      const before = await app.page.evaluate(() => ({ ht: db.devis[0].montantHT, liv: JSON.stringify(db.devis[0].livraison) }));
      // 2) désactivation du module
      await app.page.evaluate(() => { db.settings.livraison.actif = false; saveDB(); });
      await openDevisModal(app.page, 101);
      eq(await app.page.evaluate(() => !!document.getElementById('dv-liv-mode')), false, 'section retirée du formulaire');
      await app.page.evaluate(() => closeModal());
      // 3) modification du devis existant → snapshot conservé
      const id = await app.page.evaluate(() => db.devis[0].id);
      await openEditDevis(app.page, id);
      await app.page.click(SAVE_EDIT);
      const after = await app.page.evaluate(() => ({ ht: db.devis[0].montantHT, liv: JSON.stringify(db.devis[0].livraison) }));
      near(after.ht, before.ht, 'montant du devis inchangé');
      eq(after.liv, before.liv, 'copie figée de la livraison conservée');
      await app.ctx.close();
    });

    await test('B14 — TVA : le poste livraison suit le taux du document (0 % et 20 %)', async () => {
      const app = await openApp(browser, { db: baseDB({ settings: { nom: 'Tim Event', tvaRate: 20, livraison: { depot: { label: 'D', lat: 45.77, lon: 4.88 } } } }) });
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.tvaTaux, 20, 'taux repris du document');
      const tot = await readTotals(app.page);
      near(money(tot.ttc), r2((80 + res.totalHT) * 1.2), 'TTC cohérent (une seule TVA)');
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      near(dv.montantTTC, r2(dv.montantHT * 1.2), 'TTC stocké cohérent avec le HT stocké');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('C · Persistance figée et cycle de vie du devis');
  // ═══════════════════════════════════════════════════════════
  {
    await test('C1 — enregistrement : copie figée du résultat ET des paramètres', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4, addr: '3 place Bellecour, 69002 Lyon', sup: { nappage: 60, creneau: true } });
      await app.page.click(SAVE_DV);
      const L2 = await app.page.evaluate(() => db.devis[0].livraison);
      ['moteur', 'mode', 'motifPrix', 'distanceKm', 'distanceSource', 'trajets', 'kmParcourus', 'tempsH',
        'coutRevient', 'prixBaseHT', 'prixRetenuHT', 'minimumHT', 'supplements', 'supplementsHT',
        'selection', 'totalHT', 'totalTTC', 'tvaTaux', 'margeEur', 'margePct', 'params', 'emisLe', 'adresse']
        .forEach(k => ok(L2[k] !== undefined, 'champ figé « ' + k + ' »'));
      eq(L2.moteur, 'v2', 'version de moteur tracée');
      eq(L2.adresse, '3 place Bellecour, 69002 Lyon', 'adresse figée');
      eq(L2.params.coutKm, 0.494, 'barème figé (coût km)');
      eq(L2.params.marge, 0.25, 'barème figé (marge)');
      eq(L2.selection.nappage.convives, 60, 'saisie des suppléments figée');
      ok(/\d{4}-\d{2}-\d{2}T/.test(L2.emisLe), 'horodatage d\'émission');
      await app.ctx.close();
    });

    await test('C2 — un changement de barème ne modifie pas un devis déjà émis', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.click(SAVE_DV);
      const avant = await app.page.evaluate(() => JSON.parse(JSON.stringify(db.devis[0])));
      // Doublement du barème
      await app.page.evaluate(() => { const L = db.settings.livraison; L.coutKm = 2; L.coutHoraire = 60; L.coutStructure = 90; saveDB(); go('devis'); });
      const apres = await app.page.evaluate(() => JSON.parse(JSON.stringify(db.devis[0])));
      eq(JSON.stringify(apres), JSON.stringify(avant), 'devis émis strictement inchangé');
      // un nouveau devis applique le nouveau barème
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      const neuf = await app.page.evaluate(() => window._dvLiv.res);
      ok(neuf.prixRetenuHT > avant.livraison.prixRetenuHT, 'nouveau devis au nouveau tarif');
      await app.ctx.close();
    });

    await test('C3 — réouverture : tous les champs sont restaurés à l\'identique', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4, addr: '3 place Bellecour, 69002 Lyon', sup: { nappage: 60, etage: 2, creneau: true, dimanche: true, portage: true, attente: 3 }, nego: 400 });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await openEditDevis(app.page, id);
      eq(await app.page.inputValue('#dv-liv-mode'), 'aller_retour', 'mode');
      eq(await app.page.inputValue('#dv-liv-addr'), '3 place Bellecour, 69002 Lyon', 'adresse');
      eq(N(await app.page.inputValue('#dv-liv-dist')), 42.4, 'distance');
      eq(N(await app.page.inputValue('#dv-liv-nego')), 400, 'prix négocié');
      for (const [id2, lbl] of [['dv-liv-nap', 'nappage'], ['dv-liv-eta', 'étage'], ['dv-liv-cre', 'créneau'], ['dv-liv-dim', 'dimanche'], ['dv-liv-por', 'portage'], ['dv-liv-att', 'attente']]) {
        eq(await app.page.isChecked('#' + id2), true, 'case ' + lbl + ' cochée');
      }
      eq(N(await app.page.inputValue('#dv-liv-nap-c')), 60, 'convives');
      eq(N(await app.page.inputValue('#dv-liv-att-h')), 3, 'heures d\'attente');
      await app.ctx.close();
    });

    await test('C4 — aller-retour enregistrer/rouvrir/enregistrer : résultat idempotent', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4, sup: { nappage: 60, attente: 2 } });
      await app.page.click(SAVE_DV);
      const a = await app.page.evaluate(() => { const d = db.devis[0]; const c = JSON.parse(JSON.stringify(d.livraison)); delete c.emisLe; return { liv: c, ht: d.montantHT, ttc: d.montantTTC }; });
      const id = await app.page.evaluate(() => db.devis[0].id);
      await openEditDevis(app.page, id);
      await app.page.click(SAVE_EDIT);
      const b = await app.page.evaluate(() => { const d = db.devis[0]; const c = JSON.parse(JSON.stringify(d.livraison)); delete c.emisLe; return { liv: c, ht: d.montantHT, ttc: d.montantTTC }; });
      eq(JSON.stringify(b.liv), JSON.stringify(a.liv), 'copie figée identique après réenregistrement');
      near(b.ht, a.ht, 'montant HT identique');
      near(b.ttc, a.ttc, 'montant TTC identique');
      eq(await app.page.evaluate(() => db.devis.length), 1, 'pas de doublon de devis');
      await app.ctx.close();
    });

    await test('C5 — modification d\'un devis : passage livraison → retrait remet le montant à jour', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await openEditDevis(app.page, id);
      await app.page.click('#dv-liv-mr');
      await app.page.click(SAVE_EDIT);
      const dv = await app.page.evaluate(() => db.devis[0]);
      eq(dv.livraison.mode, 'retrait', 'mode retrait enregistré');
      near(dv.montantHT, 80, 'montant ramené aux articles');
      near(dv.montantTTC, 80, 'TTC ramené (TVA 0 %)');
      await app.ctx.close();
    });

    await test('C6 — duplication d\'un devis : la livraison suit', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 30, sup: { creneau: true } });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await app.page.evaluate(i => dupDv(i), id);
      const [a, b] = await app.page.evaluate(() => db.devis.map(d => ({ ht: d.montantHT, liv: JSON.stringify(d.livraison), ref: d.ref })));
      eq(b.liv, a.liv, 'copie figée dupliquée à l\'identique');
      near(b.ht, a.ht, 'montant identique');
      ok(a.ref !== b.ref, 'références distinctes');
      await app.ctx.close();
    });

    await test('C7 — remises articles + livraison : le total reste cohérent', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Tables', qty: 10, prix: 100, rem: 10, remT: 'pct' });
      await app.page.fill('#dv-remg', '50');
      await app.page.click('#dv-rge');            // remise globale en €
      await app.page.fill('#dv-remg', '50');
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.evaluate(() => calcDvTotal());
      const res = await app.page.evaluate(() => window._dvLiv.res);
      const tot = await readTotals(app.page);
      near(money(tot.st), 1000, 'sous-total articles brut');
      near(money(tot.ht), r2(1000 - 100 - 50 + res.totalHT), 'HT = articles − remises + livraison');
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      near(dv.montantHTBrut, 1000, 'brut stocké');
      near(dv.remiseMt, 150, 'remises stockées');
      near(dv.montantHT, r2(850 + res.totalHT), 'montant HT stocké');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('D · Document client (PDF)');
  // ═══════════════════════════════════════════════════════════
  {
    const pdfOf = async (page, id) => {
      await page.evaluate(i => previewDoc('devis', i), id);
      return page.evaluate(() => document.getElementById('pdf-body').innerText);
    };

    await test('D1 — ligne « Livraison et reprise » + distance en sous-titre', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4 });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      await app.page.click(SAVE_DV);
      const txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[0].id));
      includes(txt, 'Livraison et reprise', 'libellé client');
      includes(txt, '42,4 km · aller simple', 'distance en sous-titre');
      includes(txt, res.prixRetenuHT.toFixed(2).replace('.', ','), 'montant de la ligne');
      notIncludes(txt, 'Coût de revient', 'aucune donnée interne dans le PDF');
      notIncludes(txt, 'Marge', 'aucune marge dans le PDF');
      notIncludes(txt, 'Vue interne', 'aucun encart admin dans le PDF');
      await app.ctx.close();
    });

    await test('D2 — suppléments en lignes séparées', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 20, sup: { nappage: 80, creneau: true, attente: 2 } });
      await app.page.click(SAVE_DV);
      const txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[0].id));
      includes(txt, 'Mise en place et nappage', 'ligne nappage');
      includes(txt, 'Créneau horaire imposé', 'ligne créneau');
      includes(txt, 'Attente sur place', 'ligne attente');
      includes(txt, '100,00', 'montant nappage (80 × 1,20 relevé au minimum de 100 €)');
      await app.ctx.close();
    });

    await test('D3 — invariant du bloc de totaux : sous-total − remises + livraison = total HT', async () => {
      const app = await openApp(browser);
      const scenarios = [
        { rem: 0, mode: 'livraison', dist: 30, sup: {} },
        { rem: 10, mode: 'aller_retour', dist: 30, sup: { creneau: true } },
        { rem: 0, mode: 'retrait', dist: 0, sup: {} },
        { rem: 25, mode: 'livraison', dist: 15, sup: { nappage: 50, attente: 2 } }
      ];
      for (const s of scenarios) {
        await openDevisModal(app.page, 101);
        await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
        if (s.rem) await app.page.fill('#dv-remg', String(s.rem));
        await fillLiv(app.page, { mode: s.mode, dist: s.dist, sup: s.sup });
        await app.page.click(SAVE_DV);
        const id = await app.page.evaluate(() => db.devis[db.devis.length - 1].id);
        const dv = await app.page.evaluate(i => db.devis.find(d => d.id === i), id);
        const txt = await pdfOf(app.page, id);
        const lbl = `[remise ${s.rem}% ${s.mode}]`;
        const lignes = txt.split('\n');
        const nums = lbl => {
          for (let i = 0; i < lignes.length; i++) {
            if (!new RegExp('^\\s*' + lbl).test(lignes[i])) continue;
            const m = (lignes[i] + ' ' + (lignes[i + 1] || '')).match(/(\d[\d\s]*,\d{2})\s*€?\s*$/m)
              || (lignes[i] + ' ' + (lignes[i + 1] || '')).match(/(\d[\d\s]*,\d{2})/);
            if (m) return N(m[1].replace(/\s/g, '').replace(',', '.'));
          }
          return null;
        };
        const totalHT = nums('Total HT') != null ? nums('Total HT') : nums('Total');
        near(totalHT, dv.montantHT, lbl + ' Total HT du PDF = montant stocké');
        const st = nums('Sous-total articles'), liv = nums('Livraison');
        if (st != null) {
          const remise = nums('Remises') || 0;
          near(st - remise + (liv || 0), totalHT, lbl + ' sous-total − remises + livraison = total HT');
        }
        await app.page.evaluate(() => closePDF());
      }
      await app.ctx.close();
    });

    await test('D4 — livraison offerte : ligne à 0 € avec la mention', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Pack', qty: 1, prix: 1500 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 25 });
      await app.page.click(SAVE_DV);
      const txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[0].id));
      includes(txt, 'Livraison offerte', 'mention offerte');
      includes(txt, '0,00', 'ligne à 0 €');
      await app.ctx.close();
    });

    await test('D5 — retrait sans supplément : aucune ligne livraison ; hors zone : aucune ligne', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await app.page.click(SAVE_DV);
      let txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[0].id));
      notIncludes(txt, 'Livraison', 'aucune ligne livraison en retrait');
      await app.page.evaluate(() => closePDF());
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 300 });
      await app.page.click(SAVE_DV);
      txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[1].id));
      notIncludes(txt, 'aller simple', 'hors zone : pas de ligne de course');
      await app.ctx.close();
    });

    await test('D6 — prix négocié : c\'est lui qui est imprimé', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 42.4, nego: 260 });
      await app.page.click(SAVE_DV);
      const txt = await pdfOf(app.page, await app.page.evaluate(() => db.devis[0].id));
      includes(txt, '260,00', 'prix négocié imprimé');
      const dv = await app.page.evaluate(() => db.devis[0]);
      near(dv.montantHT, 250 + 260, 'total du devis cohérent');
      notIncludes(txt, 'négocié', 'le client ne voit pas la mention interne');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('E · Chaîne aval : facture, tournée, bon de commande');
  // ═══════════════════════════════════════════════════════════
  {
    await test('E1 — devis → facture : lignes, livraison au prix retenu, adresse reprise', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 30, addr: '9 rue de la Paix, 69001 Lyon', sup: { creneau: true }, nego: 175 });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await app.page.evaluate(i => { go('factures'); modalFacture(i); }, id);
      await app.page.waitForSelector('#f-client');
      const lignes = await app.page.evaluate(() => Array.from(document.querySelectorAll('[id^="fl-qty-"]')).map(e => {
        const i = e.id.replace('fl-qty-', '');
        return { desc: document.getElementById('fl-desc-' + i).value, qty: parseFloat(e.value), prix: parseFloat(document.getElementById('fl-prix-' + i).value) };
      }));
      eq(lignes.length, 3, '1 article + livraison + supplément');
      includes(lignes[1].desc, 'Livraison et reprise', 'libellé livraison');
      eq(lignes[1].prix, 175, 'prix négocié repris (et non le barème)');
      includes(lignes[2].desc, 'Créneau', 'supplément repris');
      eq(await app.page.inputValue('#f-livr'), '9 rue de la Paix, 69001 Lyon', 'adresse de livraison reprise');
      await app.page.click('button:has-text("Créer la facture")');
      const fac = await app.page.evaluate(() => db.factures[0]);
      const dv = await app.page.evaluate(() => db.devis[0]);
      near(fac.montantHT, dv.montantHT, 'montant facturé = montant du devis');
      await app.ctx.close();
    });

    await test('E2 — facture d\'un devis en retrait : aucune ligne parasite', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await app.page.evaluate(i => { go('factures'); modalFacture(i); }, id);
      await app.page.waitForSelector('#f-client');
      const n = await app.page.evaluate(() => document.querySelectorAll('[id^="fl-qty-"]').length);
      eq(n, 1, 'une seule ligne (l\'article)');
      await app.ctx.close();
    });

    await test('E3 — tournée : l\'arrêt reprend l\'adresse de livraison du devis', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 12, addr: '25 avenue Jean Jaurès, 69007 Lyon' });
      await app.page.click('#dv-lvc');                       // bloquer un créneau
      await app.page.fill('#dv-lvh', '09:30');
      await app.page.click(SAVE_DV);
      const stop = await app.page.evaluate(() => db.stops[0]);
      ok(!!stop, 'arrêt de tournée créé');
      eq(stop.adresse, '25 avenue Jean Jaurès', 'rue extraite de l\'adresse de livraison');
      eq(stop.cp, '69007', 'code postal extrait');
      eq(stop.ville, 'Lyon', 'ville extraite');
      eq(stop.time, '09:30', 'créneau conservé');
      await app.ctx.close();
    });

    await test('E4 — tournée : sans adresse de livraison, on garde la fiche client', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await app.page.click('#dv-lvc');
      await app.page.fill('#dv-lvh', '11:00');
      await app.page.click(SAVE_DV);
      const stop = await app.page.evaluate(() => db.stops[0]);
      eq(stop.adresse, '12 rue des Fleurs', 'adresse client conservée (retrait)');
      eq(stop.cp, '69003', 'CP client');
      await app.ctx.close();
    });

    await test('E5 — bon de commande depuis un devis avec livraison', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 12 });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await app.page.evaluate(i => bcFromDoc('devis', i), id);
      await app.page.waitForSelector('#bc-client, #bc-lieu', { timeout: 3000 }).catch(() => { });
      ok(await app.page.evaluate(() => !!document.getElementById('mo-box')), 'fenêtre BC ouverte');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('E6 — export Factur-X d\'une facture issue d\'un devis avec livraison', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 102);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30, sup: { creneau: true } });
      await app.page.click(SAVE_DV);
      const id = await app.page.evaluate(() => db.devis[0].id);
      await app.page.evaluate(i => { go('factures'); modalFacture(i); }, id);
      await app.page.waitForSelector('#f-client');
      await app.page.click('button:has-text("Créer la facture")');
      const xml = await app.page.evaluate(() => facturXXML(db.factures[0]));
      includes(xml, '<rsm:CrossIndustryInvoice', 'XML CII généré');
      includes(xml, 'Livraison', 'ligne livraison présente dans le XML');
      notIncludes(xml, 'NaN', 'aucun NaN dans le XML');
      const totalXml = (xml.match(/<ram:GrandTotalAmount>([\d.]+)</) || [])[1];
      const fac = await app.page.evaluate(() => db.factures[0]);
      if (totalXml) near(N(totalXml), r2(fac.montantHT), 'total XML = total facture (TVA 0 %)');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('F · Distance : géocodage, proxy, cache, pannes');
  // ═══════════════════════════════════════════════════════════
  {
    const withProxy = () => baseDB({ settings: { nom: 'Tim Event', tvaRate: 0, livraison: { proxyUrl: 'https://proxy.test/distance', depot: { label: 'Dépôt', lat: 45.77, lon: 4.88 } } } });

    await test('F1 — autocomplétion BAN alimente la liste de suggestions', async () => {
      const app = await openApp(browser, { db: withProxy() });
      await openDevisModal(app.page, 101);
      await app.page.click('#dv-liv-ml');
      await app.page.fill('#dv-liv-addr', '3 place Bellecour Lyon');
      await app.page.evaluate(() => dvLivAddrInput());
      await app.page.waitForFunction(() => document.getElementById('dv-liv-sug').options.length > 0, { timeout: 4000 });
      const opts = await app.page.evaluate(() => Array.from(document.getElementById('dv-liv-sug').options).map(o => o.value));
      ok(opts.length >= 1, 'suggestions reçues');
      includes(opts[0], 'Bellecour', 'suggestion pertinente');
      await app.ctx.close();
    });

    await test('F2 — calcul via le proxy : km, source, coordonnées et mise en cache', async () => {
      const app = await openApp(browser, { db: withProxy(), proxyKm: 37.8 });
      await openDevisModal(app.page, 101);
      await app.page.click('#dv-liv-ml');
      await app.page.fill('#dv-liv-addr', '3 place Bellecour, 69002 Lyon');
      await app.page.click('#dv-liv-geo');
      await app.page.waitForFunction(() => parseFloat(document.getElementById('dv-liv-dist').value) > 0, { timeout: 5000 });
      eq(N(await app.page.inputValue('#dv-liv-dist')), 37.8, 'distance renseignée');
      eq(await app.page.inputValue('#dv-liv-distsrc'), 'proxy', 'source = proxy');
      ok(N(await app.page.inputValue('#dv-liv-lat')) > 0, 'latitude mémorisée');
      includes(await app.page.textContent('#dv-liv-distmsg'), '37,8 km', 'message de confirmation');
      const cache = await app.page.evaluate(() => db.distanceCache);
      eq(Object.keys(cache).length, 1, 'distance mise en cache');
      const nProxy = app.netCalls.filter(x => x === 'proxy').length;
      // 2e appel : doit venir du cache
      await app.page.click('#dv-liv-geo');
      await app.page.waitForTimeout(300);
      eq(app.netCalls.filter(x => x === 'proxy').length, nProxy, 'aucun nouvel appel au proxy (cache)');
      eq(await app.page.inputValue('#dv-liv-distsrc'), 'cache', 'source = cache');
      await app.ctx.close();
    });

    await test('F3 — proxy injoignable : message clair, saisie manuelle possible, pas de blocage', async () => {
      const app = await openApp(browser, { db: withProxy(), proxyDown: true });
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await app.page.click('#dv-liv-ml');
      await app.page.fill('#dv-liv-addr', '3 place Bellecour, 69002 Lyon');
      await app.page.click('#dv-liv-geo');
      await app.page.waitForFunction(() => /injoignable|manuelle|non calculée/i.test(document.getElementById('dv-liv-distmsg').textContent), { timeout: 5000 });
      includes(await app.page.textContent('#dv-liv-distmsg'), 'saisissez les km', 'consigne de repli');
      eq(N(await app.page.inputValue('#dv-liv-dist')), 0, 'distance laissée à 0');
      await app.page.fill('#dv-liv-dist', '18');
      await app.page.evaluate(() => calcDvTotal());
      ok(await app.page.evaluate(() => window._dvLiv.res.totalHT) > 0, 'saisie manuelle opérationnelle');
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 1, 'devis enregistrable malgré la panne');
      eq(await app.page.evaluate(() => db.devis[0].livraison.distanceSource), 'manuel', 'source « manuel » tracée');
      await app.ctx.close();
    });

    await test('F4 — sans proxy configuré : repli manuel annoncé', async () => {
      const app = await openApp(browser);   // proxyUrl vide
      await openDevisModal(app.page, 101);
      await app.page.click('#dv-liv-ml');
      await app.page.fill('#dv-liv-addr', '3 place Bellecour, 69002 Lyon');
      await app.page.click('#dv-liv-geo');
      await app.page.waitForFunction(() => /manuelle/i.test(document.getElementById('dv-liv-distmsg').textContent), { timeout: 5000 });
      includes(await app.page.textContent('#dv-liv-distmsg'), 'proxy', 'cause indiquée');
      await app.ctx.close();
    });

    await test('F5 — BAN en panne : aucune exception, repli manuel', async () => {
      const app = await openApp(browser, { db: withProxy(), banDown: true });
      await openDevisModal(app.page, 101);
      await app.page.click('#dv-liv-ml');
      await app.page.fill('#dv-liv-addr', 'Adresse inconnue');
      await app.page.click('#dv-liv-geo');
      await app.page.waitForFunction(() => document.getElementById('dv-liv-distmsg').textContent.length > 5, { timeout: 5000 });
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('F6 — géocodage du dépôt depuis l\'écran Paramètres', async () => {
      const app = await openApp(browser, { db: withProxy() });
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      await app.page.fill('#lv-depot', '1 rue du Dépôt, 69100 Villeurbanne');
      await app.page.click('button:has-text("Localiser cette adresse")');
      await app.page.waitForFunction(() => /✓/.test(document.getElementById('lv-depot-msg').textContent), { timeout: 5000 });
      ok(N(await app.page.inputValue('#lv-depotLat')) > 0, 'latitude renseignée');
      ok(N(await app.page.inputValue('#lv-depotLon')) > 0, 'longitude renseignée');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('G · Écran de paramétrage livraison');
  // ═══════════════════════════════════════════════════════════
  {
    await test('G1 — enregistrement des paramètres et prise en compte immédiate', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      await app.page.fill('#lv-coutKm', '1.2');
      await app.page.fill('#lv-marge', '40');
      await app.page.fill('#lv-arrondi', '5');
      await app.page.fill('#lv-seuilLivraisonOfferte', '1500');
      await app.page.fill('#lv-rayonMax', '80');
      await app.page.fill('#lv-seuilAlerteMarge', '25');
      await app.page.fill('#lv-sup-creneauImpose-montant', '65');
      await app.page.click('#st-livraison button:has-text("💾 Enregistrer")');
      const L2 = await app.page.evaluate(() => db.settings.livraison);
      eq(L2.coutKm, 1.2, 'coût km');
      eq(L2.marge, 0.4, 'marge convertie en ratio');
      eq(L2.arrondi, 5, 'arrondi');
      eq(L2.seuilLivraisonOfferte, 1500, 'seuil offert');
      eq(L2.rayonMax, 80, 'rayon max');
      eq(L2.seuilAlerteMarge, 25, 'seuil d\'alerte');
      eq(L2.supplements.creneauImpose.montant, 65, 'supplément créneau');
      // rechargement de l'écran : valeurs relues
      await app.page.evaluate(() => renderLivraison());
      eq(N(await app.page.inputValue('#lv-marge')), 40, 'marge réaffichée en %');
      // prise en compte dans un devis
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30, sup: { creneau: true } });
      const res = await app.page.evaluate(() => window._dvLiv.res);
      eq(res.prixBaseHT % 5, 0, 'arrondi à 5 € appliqué');
      near(res.supplementsHT, 65, 'nouveau tarif de supplément appliqué');
      await app.ctx.close();
    });

    await test('G2 — valeurs par défaut restaurées', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); db.settings.livraison.coutKm = 9; renderLivraison(); });
      await app.page.evaluate(() => resetLivraison());
      eq(await app.page.evaluate(() => db.settings.livraison.coutKm), 0.494, 'barème par défaut restauré');
      eq(N(await app.page.inputValue('#lv-coutKm')), 0.494, 'champ réaffiché');
      await app.ctx.close();
    });

    await test('G3 — case « module actif » pilote l\'affichage dans le devis', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      eq(await app.page.isChecked('#lv-actif'), true, 'actif par défaut');
      await app.page.setChecked('#lv-actif', false);
      await app.page.click('#st-livraison button:has-text("💾 Enregistrer")');
      eq(await app.page.evaluate(() => db.settings.livraison.actif), false, 'désactivation enregistrée');
      await openDevisModal(app.page, 101);
      eq(await app.page.evaluate(() => !!document.getElementById('dv-liv-mode')), false, 'section masquée');
      await app.page.evaluate(() => closeModal());
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      await app.page.setChecked('#lv-actif', true);
      await app.page.click('#st-livraison button:has-text("💾 Enregistrer")');
      await openDevisModal(app.page, 101);
      eq(await app.page.evaluate(() => !!document.getElementById('dv-liv-mode')), true, 'section réaffichée');
      await app.ctx.close();
    });

    await test('G4 — TVA livraison verrouillée sur le taux société', async () => {
      const app = await openApp(browser, { db: baseDB({ settings: { nom: 'Tim Event', tvaRate: 20, livraison: {} } }) });
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      eq(N(await app.page.inputValue('#lv-tva')), 20, 'champ aligné sur le taux société');
      eq(await app.page.isDisabled('#lv-tva'), true, 'champ non modifiable');
      await app.page.click('#st-livraison button:has-text("💾 Enregistrer")');
      eq(await app.page.evaluate(() => db.settings.livraison.tva), 20, 'valeur synchronisée à l\'enregistrement');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('H · Non-régression du reste de l\'application');
  // ═══════════════════════════════════════════════════════════
  {
    await test('H1 — navigation : les 14 écrans s\'ouvrent sans erreur', async () => {
      const app = await openApp(browser);
      const pages = ['dashboard', 'calendar', 'clients', 'reservations', 'stock', 'tournee', 'bons', 'devis', 'factures', 'documents', 'encaissement', 'compta', 'audit', 'settings'];
      for (const p of pages) {
        await app.page.evaluate(x => go(x), p);
        eq(await app.page.evaluate(x => document.getElementById('page-' + x).classList.contains('active'), p), true, 'écran ' + p);
      }
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('H2 — clients : création, modification, suppression', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('clients'); modalClient(); });
      await app.page.fill('#m-prenom', 'Léa'); await app.page.fill('#m-nom', 'Bernard');
      await app.page.fill('#m-tel', '0611223344'); await app.page.fill('#m-email', 'lea@test.fr');
      await app.page.click('.mo-foot button:has-text("Enregistrer")');
      eq(await app.page.evaluate(() => db.clients.length), 3, 'client créé');
      const id = await app.page.evaluate(() => db.clients[2].id);
      await app.page.evaluate(i => modalClient(i), id);
      await app.page.fill('#m-ville', 'Villeurbanne');
      await app.page.click('.mo-foot button:has-text("Enregistrer")');
      eq(await app.page.evaluate(() => db.clients[2].ville), 'Villeurbanne', 'modification enregistrée');
      await app.page.evaluate(i => delClient(i), id);
      eq(await app.page.evaluate(() => db.clients.length), 2, 'suppression effective');
      await app.ctx.close();
    });

    await test('H3 — devis sans livraison : totaux et remises inchangés (référence historique)', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5, rem: 10, remT: 'pct' });
      await app.page.evaluate(() => addDvLine());
      await setLine(app.page, 1, { desc: 'Tables', qty: 10, prix: 8, rem: 5, remT: 'eur' });
      await app.page.fill('#dv-remg', '10');
      await app.page.evaluate(() => calcDvTotal());
      const tot = await readTotals(app.page);
      near(money(tot.st), 330, 'sous-total brut 250 + 80');
      near(money(tot.ht), r2((225 + 75) * 0.9), 'HT après remises lignes puis remise globale 10 %');
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      near(dv.montantHT, 270, 'montant enregistré');
      near(dv.remiseMt, 60, 'remises totales');
      eq(dv.livraison.mode, 'retrait', 'livraison neutre par défaut');
      await app.ctx.close();
    });

    await test('H4 — réservations : création et impact sur le stock', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('reservations'); modalReservation(); });
      await app.page.waitForSelector('#r-client');
      await app.page.selectOption('#r-client', '101');
      await app.page.fill('#r-ev', 'Anniversaire');
      const ids = await app.page.evaluate(() => Array.from(document.querySelectorAll('[id^="rl-qty-"]')).map(e => e.id.replace('rl-qty-', '')));
      if (ids.length) await app.page.fill('#rl-qty-' + ids[0], '20');
      await app.page.evaluate(() => calcResTotal());
      await app.page.click('.mo-foot button:has-text("Enregistrer")');
      eq(await app.page.evaluate(() => db.reservations.length), 1, 'réservation créée');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('H5 — facture directe, paiement et statuts d\'encaissement', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('factures'); modalFacture(); });
      await app.page.waitForSelector('#f-client');
      await app.page.selectOption('#f-client', '101');
      const ids = await app.page.evaluate(() => Array.from(document.querySelectorAll('[id^="fl-qty-"]')).map(e => e.id.replace('fl-qty-', '')));
      await app.page.fill('#fl-desc-' + ids[0], 'Prestation');
      await app.page.fill('#fl-qty-' + ids[0], '1');
      await app.page.fill('#fl-prix-' + ids[0], '1000');
      await app.page.evaluate(() => calcFacTotal());
      await app.page.click('button:has-text("Créer la facture")');
      eq(await app.page.evaluate(() => db.factures.length), 1, 'facture créée');
      const fid = await app.page.evaluate(() => db.factures[0].id);
      eq(await app.page.evaluate(i => encStatut(db.factures.find(f => f.id === i)), fid), 'dette', 'statut initial : dette');
      await app.page.evaluate(i => { db.paiements.push({ id: 1, factureId: i, montant: 400, date: today(), mode: 'virement' }); saveDB(); }, fid);
      eq(await app.page.evaluate(i => encStatut(db.factures.find(f => f.id === i)), fid), 'partielle', 'paiement partiel');
      await app.page.evaluate(i => { db.paiements.push({ id: 2, factureId: i, montant: 600, date: today(), mode: 'cb' }); saveDB(); }, fid);
      eq(await app.page.evaluate(i => encStatut(db.factures.find(f => f.id === i)), fid), 'soldee', 'facture soldée');
      await app.page.evaluate(() => go('encaissement'));
      includes(await app.page.textContent('#enc-pipe'), '1000', 'tableau de bord encaissement à jour');
      await app.ctx.close();
    });

    await test('H6 — export/import JSON : aller-retour intégral avec livraison', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 30, sup: { creneau: true } });
      await app.page.click(SAVE_DV);
      const dump = await app.page.evaluate(() => JSON.stringify(db));
      const restored = await app.page.evaluate(j => {
        localStorage.setItem('tim_ev', j);
        const d = loadDB();
        return { devis: d.devis.length, liv: JSON.stringify(d.devis[0].livraison), params: !!d.devis[0].livraison.params, ht: d.devis[0].montantHT };
      }, dump);
      eq(restored.devis, 1, 'devis restauré');
      eq(restored.params, true, 'barème figé restauré');
      near(restored.ht, await app.page.evaluate(() => db.devis[0].montantHT), 'montant restauré');
      await app.ctx.close();
    });

    await test('H7 — export CSV généré sans erreur', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 12 });
      await app.page.click(SAVE_DV);
      const res = await app.page.evaluate(() => {
        let captured = null;
        const orig = URL.createObjectURL;
        URL.createObjectURL = b => { captured = b; return 'blob:fake'; };
        const a = document.createElement('a'); const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { };
        try { exportCSV(); } finally { URL.createObjectURL = orig; HTMLAnchorElement.prototype.click = click; }
        return !!captured;
      });
      eq(res, true, 'fichier CSV produit');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('H8 — tableau de bord et comptabilité intègrent la livraison sans double comptage', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      await app.page.evaluate(() => go('devis'));
      const tbody = await app.page.textContent('#dv-tbody');
      includes(tbody, dv.montantHT.toFixed(2).replace('.', ','), 'montant listé = montant stocké');
      includes(tbody, '🚚', 'rappel visuel du poste livraison');
      await app.page.evaluate(() => { go('dashboard'); go('compta'); });
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('H9 — piste d\'audit alimentée par les actions livraison', async () => {
      const app = await openApp(browser);
      await app.page.evaluate(() => { go('settings'); sTab('livraison', document.querySelector('.tab')); });
      await app.page.click('#st-livraison button:has-text("💾 Enregistrer")');
      const audit = await app.page.evaluate(() => JSON.stringify(db.audit));
      includes(audit, 'Paramètres livraison', 'entrée « paramètres livraison »');
      await app.ctx.close();
    });

    await test('H10 — verrouillage PIN : session valide requise', async () => {
      const app = await openApp(browser, { db: baseDB() });
      // ouverture normale (session injectée) → app visible
      eq(await app.page.evaluate(() => document.getElementById('app').style.display !== 'none'), true, 'app déverrouillée avec session');
      const locked = await openApp(browser, { db: baseDB(), noSession: true });
      eq(await locked.page.evaluate(() => document.getElementById('app').style.display), 'none', 'app verrouillée sans session');
      ok(await locked.page.isVisible('#lock-screen'), 'écran de verrouillage affiché');
      await locked.ctx.close();
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('I · Migration et robustesse des données');
  // ═══════════════════════════════════════════════════════════
  {
    await test('I1 — base sans paramètres livraison : valeurs par défaut injectées', async () => {
      const old = { clients: [], devis: [], factures: [], reservations: [], settings: { nom: 'Ancien', tvaRate: 0 }, counters: { dv: 1, fac: 1 } };
      const app = await openApp(browser, { db: old });
      const L2 = await app.page.evaluate(() => db.settings.livraison);
      eq(L2.coutKm, 0.494, 'barème par défaut');
      eq(L2.seuilAlerteMarge, 15, 'nouveau paramètre ajouté par migration');
      eq(await app.page.evaluate(() => typeof db.distanceCache), 'object', 'cache de distances créé');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      await app.ctx.close();
    });

    await test('I2 — devis émis avec l\'ancien moteur : montants et PDF préservés', async () => {
      const legacy = baseDB({
        devis: [{
          id: 9001, ref: 'DEV-0001', clientId: 101, type: 'devis', nomEv: 'Ancien mariage',
          dateCreation: '2025-06-01', dateEv: '2025-07-01', validite: '2025-07-01', notes: '',
          lignes: [{ desc: 'Chaises', qty: 100, prixUnit: 2.5, rem: 0, remT: 'pct', total: 250 }],
          remGlob: 0, remGlobT: 'pct', montantHTBrut: 250, remiseMt: 0,
          montantHT: 400, montantTTC: 400, statut: 'en attente',
          livraison: {   // ancien format : pas de champ moteur/prixRetenuHT
            mode: 'aller_retour', offerte: false, horsZone: false, distanceKm: 42.4, distanceSource: 'manuel',
            adresse: '3 place Bellecour', trajets: 4, kmParcourus: 169.6, tempsH: 4.83,
            coutRevient: 120, prixBaseHT: 150, minimumHT: 350, sousMinimum: true,
            supplements: [{ code: 'creneauImpose', label: 'Créneau horaire imposé', montant: 50 }],
            supplementsHT: 50, selection: { creneauImpose: true },
            totalHT: 200, totalTTC: 240, prixNegocieHT: null, margeEur: 30, margePct: 25,
            params: { coutKm: 0.494, rayonMax: 120 }, emisLe: '2025-06-01T10:00:00.000Z'
          }
        }], counters: { dv: 2, fac: 1, bc: 1 }
      });
      const app = await openApp(browser, { db: legacy });
      eq(await app.page.evaluate(() => db.devis[0].montantHT), 400, 'montant historique intact');
      await app.page.evaluate(() => previewDoc('devis', 9001));
      const txt = await app.page.evaluate(() => document.getElementById('pdf-body').innerText);
      includes(txt, 'Livraison et reprise', 'ligne livraison imprimée');
      includes(txt, '150,00', 'ancien prix (barème) conservé, pas de recalcul');
      includes(txt, 'Créneau horaire imposé', 'supplément imprimé');
      includes(txt, '400,00', 'total HT du PDF = montant historique');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      // réouverture pour édition : les champs se remplissent
      await app.page.evaluate(() => closePDF());
      await openEditDevis(app.page, 9001);
      eq(await app.page.inputValue('#dv-liv-mode'), 'aller_retour', 'mode relu');
      eq(N(await app.page.inputValue('#dv-liv-dist')), 42.4, 'distance relue');
      eq(await app.page.isChecked('#dv-liv-cre'), true, 'supplément relu');
      await app.ctx.close();
    });

    await test('I3 — base partiellement corrompue : l\'app démarre quand même', async () => {
      const app = await openApp(browser, { rawStorage: { tim_ev: '{"clients":[],"settings":{"livraison":{"supplements":{}}},"devis":null}' }, db: null });
      eq(await app.page.evaluate(() => typeof db.settings.livraison.supplements.nappage), 'object', 'suppléments recomplétés');
      ok(await app.page.evaluate(() => document.getElementById('app') !== null), 'application chargée');
      await app.ctx.close();
    });

    await test('I4 — cache de distances : réutilisé, jamais corrompu', async () => {
      const db2 = baseDB({ settings: { nom: 'T', tvaRate: 0, livraison: { proxyUrl: 'https://proxy.test/distance', depot: { label: 'D', lat: 45.77, lon: 4.88 } } } });
      const app = await openApp(browser, { db: db2, proxyKm: 55.5 });
      const r1 = await app.page.evaluate(async () => await resolveDistanceKm('3 place Bellecour, 69002 Lyon', livParams()));
      eq(r1.source, 'proxy', 'premier appel via proxy');
      eq(r1.km, 55.5, 'distance renvoyée');
      const r2b = await app.page.evaluate(async () => await resolveDistanceKm('3 place Bellecour, 69002 Lyon', livParams()));
      eq(r2b.source, 'cache', 'second appel servi par le cache');
      eq(r2b.km, 55.5, 'même valeur');
      const keys = await app.page.evaluate(() => Object.keys(db.distanceCache));
      eq(keys.length, 1, 'une seule entrée de cache');
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  section('J · Saisies limites et robustesse du formulaire');
  // ═══════════════════════════════════════════════════════════
  {
    // saisie « au clavier » réelle : on force la valeur puis on déclenche l'événement input
    const type = (page, id, v) => page.evaluate(([i, x]) => {
      const e = document.getElementById(i); if (!e) return;
      if (e.type === 'checkbox') { e.checked = !!x; e.dispatchEvent(new Event('change', { bubbles: true })); }
      else { e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); }
    }, [id, v]);

    await test('J1 — 48 saisies aléatoires dans le formulaire : aucun NaN, aucune erreur, totaux cohérents', async () => {
      const app = await openApp(browser);
      const dists = ['0', '0.1', '7', '42.4', '119.9', '120.1', '999', '-12', 'abc', '', '12,5', '1e9'];
      const negos = ['', '0', '50', '9999', '-30', 'x'];
      const modes = ['livraison', 'aller_retour'];
      let n = 0;
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 40, prix: 2.5 });
      for (const m of modes) {
        await app.page.click('#dv-liv-m' + (m === 'livraison' ? 'l' : 'ar'));
        for (const d of dists) {
          for (const g of [negos[n % negos.length], negos[(n + 3) % negos.length]]) {
            await type(app.page, 'dv-liv-dist', d);
            await type(app.page, 'dv-liv-nego', g);
            await type(app.page, 'dv-liv-nap', n % 2 === 0);
            await type(app.page, 'dv-liv-att-h', String((n % 5) - 1));
            n++;
            const st = await app.page.evaluate(() => ({
              res: window._dvLiv.res,
              box: document.getElementById('dv-liv-result').textContent,
              ht: document.getElementById('dv-ht').textContent,
              ttc: document.getElementById('dv-ttc').textContent
            }));
            const tag = `[${m} dist="${d}" nego="${g}"]`;
            if (/NaN|Infinity|undefined/.test(st.box + st.ht + st.ttc)) ok(false, tag + ' affichage corrompu : ' + st.box.slice(0, 80));
            if (!(st.res.totalHT >= 0)) ok(false, tag + ' total livraison négatif : ' + st.res.totalHT);
            if (money(st.ht) < 100 - 0.001) ok(false, tag + ' total du devis inférieur aux articles : ' + st.ht);
          }
        }
      }
      eq(n, 48, '48 combinaisons jouées');
      eq(app.errors.length, 0, 'aucune erreur JS : ' + app.errors.join(' | '));
      ok(true, 'aucun affichage corrompu');
      await app.ctx.close();
    });

    await test('J2 — valeurs extrêmes : 0,1 km, 1 milliard de km, prix négocié à 7 chiffres', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 0.1 });
      let r = await app.page.evaluate(() => window._dvLiv.res);
      ok(r.totalHT > 0, '0,1 km : un prix plancher est calculé');
      eq(r.distanceManquante, false, '0,1 km n\'est pas « distance manquante »');
      await type(app.page, 'dv-liv-dist', '1000000000');
      r = await app.page.evaluate(() => window._dvLiv.res);
      eq(r.horsZone, true, '1 milliard de km : hors zone');
      eq(r.totalHT, 0, 'aucun montant aberrant');
      await type(app.page, 'dv-liv-dist', '50');
      await type(app.page, 'dv-liv-nego', '9999999');
      r = await app.page.evaluate(() => window._dvLiv.res);
      eq(r.prixRetenuHT, 9999999, 'prix négocié élevé accepté');
      ok(r.margePct > 1000, 'marge cohérente');
      notIncludes(await app.page.textContent('#dv-liv-result'), 'NaN', 'affichage propre');
      await app.ctx.close();
    });

    await test('J3 — bascules rapides entre les trois modes : état toujours cohérent', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30, sup: { creneau: true } });
      const seq = ['mr', 'mar', 'ml', 'mr', 'ml', 'mar', 'mr'];
      for (const b of seq) await app.page.click('#dv-liv-' + b);
      let r = await app.page.evaluate(() => window._dvLiv.res);
      eq(r.mode, 'retrait', 'dernier mode appliqué');
      eq(r.totalHT, 0, 'aucun résidu de calcul');
      near(money((await readTotals(app.page)).ht), 25, 'total revenu aux articles');
      await app.page.click('#dv-liv-mar');
      r = await app.page.evaluate(() => window._dvLiv.res);
      eq(r.mode, 'aller_retour', 'retour en A/R');
      eq(r.distanceKm, 30, 'distance conservée');
      eq(r.supplements.length, 1, 'supplément conservé');
      eq(await app.page.inputValue('#dv-liv-mode'), 'aller_retour', 'champ caché synchronisé');
      const cls = await app.page.getAttribute('#dv-liv-mar', 'class');
      includes(cls, 'btn-primary', 'bouton actif mis en évidence');
      await app.ctx.close();
    });

    await test('J4 — gardes existantes du devis toujours actives (client, lignes)', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page);            // aucun client sélectionné
      await clearToasts(app.page);
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 0, 'devis sans client refusé');
      includes(await toasts(app.page), 'Client requis', 'message « client requis »');
      await app.page.selectOption('#dv-client', '101');
      await setLine(app.page, 0, { qty: 0, prix: 0 });
      await clearToasts(app.page);
      await app.page.click(SAVE_DV);
      eq(await app.page.evaluate(() => db.devis.length), 0, 'devis sans ligne refusé');
      includes(await toasts(app.page), 'au moins une ligne', 'message « ligne requise »');
      await app.ctx.close();
    });

    await test('J5 — deux devis successifs : numérotation et montants indépendants', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 101);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 10, prix: 2.5 });
      await fillLiv(app.page, { mode: 'livraison', dist: 30 });
      await app.page.click(SAVE_DV);
      await openDevisModal(app.page, 102);
      await setLine(app.page, 0, { desc: 'Tables', qty: 5, prix: 8 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 10, sup: { creneau: true } });
      await app.page.click(SAVE_DV);
      const dvs = await app.page.evaluate(() => db.devis.map(d => ({ ref: d.ref, ht: d.montantHT, mode: d.livraison.mode, km: d.livraison.distanceKm, cli: d.clientId })));
      eq(dvs.length, 2, 'deux devis');
      eq(dvs[0].ref, 'DEV-0001', 'première référence');
      eq(dvs[1].ref, 'DEV-0002', 'seconde référence incrémentée');
      eq(dvs[0].mode, 'livraison', 'mode du devis 1');
      eq(dvs[1].mode, 'aller_retour', 'mode du devis 2');
      eq(dvs[0].km, 30, 'distance du devis 1');
      eq(dvs[1].km, 10, 'distance du devis 2 (aucune contamination)');
      ok(dvs[0].ht !== dvs[1].ht, 'montants distincts');
      await app.ctx.close();
    });

    await test('J6 — enchaînement complet : devis livré → accepté → facturé → encaissé', async () => {
      const app = await openApp(browser);
      await openDevisModal(app.page, 102);
      await setLine(app.page, 0, { desc: 'Chaises', qty: 100, prix: 2.5 });
      await fillLiv(app.page, { mode: 'aller_retour', dist: 35, addr: '4 rue Neuve, 69001 Lyon', sup: { creneau: true } });
      await app.page.click(SAVE_DV);
      const dv = await app.page.evaluate(() => db.devis[0]);
      await app.page.evaluate(i => setDvStatut(i, 1), dv.id);
      eq(await app.page.evaluate(() => db.devis[0].statut), 'accepté', 'devis accepté');
      await app.page.evaluate(i => { go('factures'); modalFacture(i); }, dv.id);
      await app.page.waitForSelector('#f-client');
      await app.page.click('button:has-text("Créer la facture")');
      const fac = await app.page.evaluate(() => db.factures[0]);
      near(fac.montantHT, dv.montantHT, 'facture au montant du devis (livraison comprise)');
      await app.page.evaluate(i => { db.paiements.push({ id: 7, factureId: i, montant: 100, date: today(), mode: 'virement' }); saveDB(); go('encaissement'); }, fac.id);
      eq(await app.page.evaluate(i => encStatut(db.factures.find(f => f.id === i)), fac.id), 'partielle', 'encaissement partiel');
      await app.page.evaluate(() => { go('documents'); go('compta'); go('dashboard'); });
      eq(app.errors.length, 0, 'aucune erreur JS sur toute la chaîne : ' + app.errors.join(' | '));
      await app.ctx.close();
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Rapport
  // ═══════════════════════════════════════════════════════════
  await browser.close();
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  let nOk = 0, nKo = 0, nChecks = 0;
  results.forEach(s => s.tests.forEach(t => { nChecks += t.checks; t.ok ? nOk++ : nKo++; }));

  const lines = [];
  lines.push('# Tim Event — Rapport de non-régression (Phase 2 · Livraison)');
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
  fs.writeFileSync(path.join(__dirname, '..', 'rapport-tests.md'), lines.join('\n'), 'utf8');

  console.log('\n' + '═'.repeat(60));
  console.log(`  ${nOk} réussis / ${nOk + nKo} scénarios · ${nChecks} assertions · ${dur}s`);
  console.log('═'.repeat(60));
  process.exit(nKo ? 1 : 0);
})();
