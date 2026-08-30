# Tim Event — Rapport de non-régression (Phase 2 · Livraison)

Exécuté le 30/08/2026 18:58:29 · Chromium headless · 66.1 s

**79 scénarios · 418 assertions · 79 réussis · 0 échoués**

## A · Moteur de calcul (fonction pure)

- ✅ A1 — matrice modes × distances × montants × prix négocié (480 cas) conforme à l'oracle _(3 assertions)_
- ✅ A2 — 64 combinaisons de suppléments × 3 modes conformes à l'oracle _(2 assertions)_
- ✅ A3 — retrait : aucun montant (ni course ni suppléments de livraison) _(6 assertions)_
- ✅ A4 — livraison 30 km : prix = arrondi_sup(coût × 1,25) et marge cohérente _(7 assertions)_
- ✅ A5 — aller-retour : 4 trajets, manutention 105 min _(4 assertions)_
- ✅ A6 — seuil de livraison offerte : bornes 899,99 / 900 / seuil 0 _(6 assertions)_
- ✅ A7 — rayon max : bornes 119,9 / 120 / 120,1 _(5 assertions)_
- ✅ A8 — prix négocié : prime sur le calcul, sur l'offre et sur le hors zone _(6 assertions)_
- ✅ A9 — marge négative détectée uniquement quand elle est subie _(5 assertions)_
- ✅ A10 — seuil d'alerte de marge (15 % par défaut, paramétrable) _(3 assertions)_
- ✅ A11 — suppléments : franchise d'attente, minimum de nappage, cumul _(8 assertions)_
- ✅ A12 — l'attente allonge le temps donc le coût de revient _(2 assertions)_
- ✅ A13 — saisies aberrantes : négatifs, vides, texte — aucun NaN, aucun montant négatif _(20 assertions)_
- ✅ A14 — paramètres extrêmes : vitesse 0, arrondis 0, marge négative, rayon 0 _(12 assertions)_
- ✅ A15 — TVA du poste livraison alignée sur le taux du document _(5 assertions)_
- ✅ A16 — fonction pure : déterministe et sans effet de bord sur l'entrée _(3 assertions)_

## B · Section « Livraison » du formulaire de devis

- ✅ B1 — la section existe, retrait par défaut, corps replié _(7 assertions)_
- ✅ B2 — bascule livraison : corps déplié + adresse pré-remplie depuis la fiche client _(4 assertions)_
- ✅ B3 — prix affiché en direct et répercuté sur les totaux du devis _(6 assertions)_
- ✅ B4 — cases suppléments : lignes détaillées et total recalculé à chaque clic _(11 assertions)_
- ✅ B5 — vue admin : distance, km, temps, coût, marge €/% et prix retenu _(11 assertions)_
- ✅ B6 — prix négocié : remplace le prix calculé et recalcule la marge _(6 assertions)_
- ✅ B7 — marge négative : indicateur rouge + enregistrement bloqué _(7 assertions)_
- ✅ B8 — distance à 0 : enregistrement bloqué, sauf prix négocié _(4 assertions)_
- ✅ B9 — hors zone : alerte, aucun montant automatique, devis enregistrable et tracé _(6 assertions)_
- ✅ B10 — livraison offerte au-delà du seuil : 0 € client, coût absorbé côté admin _(6 assertions)_
- ✅ B11 — offerte + suppléments : seuls les suppléments sont facturés _(4 assertions)_
- ✅ B12 — bascule livraison → retrait : le poste livraison est entièrement annulé _(8 assertions)_
- ✅ B13 — module désactivé : section absente, devis existant préservé _(3 assertions)_
- ✅ B14 — TVA : le poste livraison suit le taux du document (0 % et 20 %) _(3 assertions)_

## C · Persistance figée et cycle de vie du devis

- ✅ C1 — enregistrement : copie figée du résultat ET des paramètres _(29 assertions)_
- ✅ C2 — un changement de barème ne modifie pas un devis déjà émis _(2 assertions)_
- ✅ C3 — réouverture : tous les champs sont restaurés à l'identique _(12 assertions)_
- ✅ C4 — aller-retour enregistrer/rouvrir/enregistrer : résultat idempotent _(4 assertions)_
- ✅ C5 — modification d'un devis : passage livraison → retrait remet le montant à jour _(3 assertions)_
- ✅ C6 — duplication d'un devis : la livraison suit _(3 assertions)_
- ✅ C7 — remises articles + livraison : le total reste cohérent _(5 assertions)_

## D · Document client (PDF)

- ✅ D1 — ligne « Livraison et reprise » + distance en sous-titre _(6 assertions)_
- ✅ D2 — suppléments en lignes séparées _(4 assertions)_
- ✅ D3 — invariant du bloc de totaux : sous-total − remises + livraison = total HT _(7 assertions)_
- ✅ D4 — livraison offerte : ligne à 0 € avec la mention _(2 assertions)_
- ✅ D5 — retrait sans supplément : aucune ligne livraison ; hors zone : aucune ligne _(2 assertions)_
- ✅ D6 — prix négocié : c'est lui qui est imprimé _(3 assertions)_

## E · Chaîne aval : facture, tournée, bon de commande

- ✅ E1 — devis → facture : lignes, livraison au prix retenu, adresse reprise _(6 assertions)_
- ✅ E2 — facture d'un devis en retrait : aucune ligne parasite _(1 assertions)_
- ✅ E3 — tournée : l'arrêt reprend l'adresse de livraison du devis _(5 assertions)_
- ✅ E4 — tournée : sans adresse de livraison, on garde la fiche client _(2 assertions)_
- ✅ E5 — bon de commande depuis un devis avec livraison _(2 assertions)_
- ✅ E6 — export Factur-X d'une facture issue d'un devis avec livraison _(4 assertions)_

## F · Distance : géocodage, proxy, cache, pannes

- ✅ F1 — autocomplétion BAN alimente la liste de suggestions _(2 assertions)_
- ✅ F2 — calcul via le proxy : km, source, coordonnées et mise en cache _(7 assertions)_
- ✅ F3 — proxy injoignable : message clair, saisie manuelle possible, pas de blocage _(5 assertions)_
- ✅ F4 — sans proxy configuré : repli manuel annoncé _(1 assertions)_
- ✅ F5 — BAN en panne : aucune exception, repli manuel _(1 assertions)_
- ✅ F6 — géocodage du dépôt depuis l'écran Paramètres _(2 assertions)_

## G · Écran de paramétrage livraison

- ✅ G1 — enregistrement des paramètres et prise en compte immédiate _(10 assertions)_
- ✅ G2 — valeurs par défaut restaurées _(2 assertions)_
- ✅ G3 — case « module actif » pilote l'affichage dans le devis _(4 assertions)_
- ✅ G4 — TVA livraison verrouillée sur le taux société _(3 assertions)_

## H · Non-régression du reste de l'application

- ✅ H1 — navigation : les 14 écrans s'ouvrent sans erreur _(15 assertions)_
- ✅ H2 — clients : création, modification, suppression _(3 assertions)_
- ✅ H3 — devis sans livraison : totaux et remises inchangés (référence historique) _(5 assertions)_
- ✅ H4 — réservations : création et impact sur le stock _(2 assertions)_
- ✅ H5 — facture directe, paiement et statuts d'encaissement _(5 assertions)_
- ✅ H6 — export/import JSON : aller-retour intégral avec livraison _(3 assertions)_
- ✅ H7 — export CSV généré sans erreur _(2 assertions)_
- ✅ H8 — tableau de bord et comptabilité intègrent la livraison sans double comptage _(3 assertions)_
- ✅ H9 — piste d'audit alimentée par les actions livraison _(1 assertions)_
- ✅ H10 — verrouillage PIN : session valide requise _(3 assertions)_

## I · Migration et robustesse des données

- ✅ I1 — base sans paramètres livraison : valeurs par défaut injectées _(4 assertions)_
- ✅ I2 — devis émis avec l'ancien moteur : montants et PDF préservés _(9 assertions)_
- ✅ I3 — base partiellement corrompue : l'app démarre quand même _(2 assertions)_
- ✅ I4 — cache de distances : réutilisé, jamais corrompu _(5 assertions)_

## J · Saisies limites et robustesse du formulaire

- ✅ J1 — 48 saisies aléatoires dans le formulaire : aucun NaN, aucune erreur, totaux cohérents _(3 assertions)_
- ✅ J2 — valeurs extrêmes : 0,1 km, 1 milliard de km, prix négocié à 7 chiffres _(7 assertions)_
- ✅ J3 — bascules rapides entre les trois modes : état toujours cohérent _(8 assertions)_
- ✅ J4 — gardes existantes du devis toujours actives (client, lignes) _(4 assertions)_
- ✅ J5 — deux devis successifs : numérotation et montants indépendants _(8 assertions)_
- ✅ J6 — enchaînement complet : devis livré → accepté → facturé → encaissé _(4 assertions)_
