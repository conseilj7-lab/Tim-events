# Tim Event — Rapport de tests (Phase 3 · Assistant de saisie)

Exécuté le 30/08/2026 18:57:22 · Chromium headless · 9.7 s

**33 scénarios · 199 assertions · 33 réussis · 0 échoués**

## K · Moteur de compréhension (fonction pure)

- ✅ K1 — nature de l'acte reconnue sur 18 formulations courantes _(2 assertions)_
- ✅ K2 — nombres en toutes lettres et en chiffres _(9 assertions)_
- ✅ K3 — dates relatives, absolues et jours de la semaine _(11 assertions)_
- ✅ K4 — heures : 8h30, huit heures et demie, midi, 18 h _(7 assertions)_
- ✅ K5 — montants, pourcentages, téléphone, email, adresse _(12 assertions)_
- ✅ K6 — catalogue : pluriels, synonymes, fautes de dictée, ambiguïté _(8 assertions)_
- ✅ K7 — client : reconnaissance, homonymes, client absent _(4 assertions)_
- ✅ K8 — devis complet : lignes, livraison, suppléments, remise _(18 assertions)_
- ✅ K9 — modes de livraison et prix négocié _(7 assertions)_
- ✅ K9b — bascule d'année : un encaissement d'hier ne saute pas d'un an _(6 assertions)_
- ✅ K10 — plusieurs actes dans une même note vocale _(2 assertions)_
- ✅ K11 — fonction pure : déterministe, sans effet de bord _(2 assertions)_
- ✅ K12 — saisies aberrantes : aucun plantage, aucun NaN _(2 assertions)_

## L · Interface de l'assistant

- ✅ L1 — points d'entrée présents et ouverture du panneau _(6 assertions)_
- ✅ L2 — fiche de vérification : type, confiance, champs, lignes _(7 assertions)_
- ✅ L3 — devis pré-rempli : client, date, lignes, totaux _(11 assertions)_
- ✅ L4 — devis avec livraison : mode, distance, suppléments, prix négocié _(9 assertions)_
- ✅ L5 — le devis dicté s'enregistre avec les bons montants _(6 assertions)_
- ✅ L6 — réservation pré-remplie avec articles de stock _(12 assertions)_
- ✅ L7 — fiche client pré-remplie (client inconnu) _(8 assertions)_
- ✅ L8 — arrêt de tournée pré-rempli _(8 assertions)_
- ✅ L9 — encaissement pré-rempli sur la facture ouverte _(6 assertions)_
- ✅ L10 — bon de commande pré-rempli _(3 assertions)_
- ✅ L11 — ajustement de stock (entrée et casse) _(5 assertions)_
- ✅ L12 — changement de statut appliqué au bon document _(1 assertions)_
- ✅ L13 — ambiguïté d'article : question posée puis mémorisée _(6 assertions)_
- ✅ L14 — client manquant : l'application est bloquée avec explication _(3 assertions)_
- ✅ L15 — assistant désactivable depuis les Paramètres _(3 assertions)_
- ✅ L16 — aucune erreur JavaScript pendant toute la session _(2 assertions)_

## M · Robustesse et non-régression du reste de l'application

- ✅ M1 — base sans bloc « assistant » : valeurs par défaut injectées _(4 assertions)_
- ✅ M2 — 60 dictées aléatoires : aucune exception, aucun montant négatif _(4 assertions)_
- ✅ M3 — devis saisi à la main : comportement inchangé _(3 assertions)_
- ✅ M4 — export / import JSON : les réglages de l'assistant survivent _(2 assertions)_
