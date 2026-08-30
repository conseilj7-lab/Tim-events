# Tim Event — Rapport de tests (Phase 4 · Messagerie unifiée)

Exécuté le 30/08/2026 18:57:12 · Chromium headless · 8.0 s

**24 scénarios · 113 assertions · 24 réussis · 0 échoués**

## N · Messagerie : boîte unique et qualification

- ✅ N1 — écran, menu et compteur en place _(4 assertions)_
- ✅ N2 — conversation saisie à la main, qualifiée immédiatement _(10 assertions)_
- ✅ N3 — priorité et informations manquantes signalées _(5 assertions)_
- ✅ N4 — réponse de premier niveau : accuse, reformule, questionne, signe _(8 assertions)_
- ✅ N5 — fenêtre de 24 h : ouverte, puis fermée _(5 assertions)_
- ✅ N6 — fiche de synthèse : coordonnées, besoin, actions _(13 assertions)_
- ✅ N7 — conversion en devis : client à créer, lignes reprises _(8 assertions)_
- ✅ N8 — conversion en client puis rapprochement automatique _(5 assertions)_

## O · Connecteur : synchronisation, envoi, pannes

- ✅ O1 — synchronisation : conversation importée et qualifiée _(8 assertions)_
- ✅ O2 — deuxième synchronisation : aucun doublon _(3 assertions)_
- ✅ O3 — envoi via le connecteur, dans la fenêtre _(8 assertions)_
- ✅ O4 — réponse proposée par l'assistant avant envoi _(3 assertions)_
- ✅ O5 — fenêtre fermée : envoi libre bloqué, message conservé _(2 assertions)_
- ✅ O6 — connecteur en panne : brouillon conservé, aucune perte _(5 assertions)_
- ✅ O7 — jeton invalide : refus propre _(2 assertions)_

## P · Premier niveau automatique et réglages

- ✅ P1 — accusé automatique désactivé par défaut _(2 assertions)_
- ✅ P2 — accusé automatique activé : un seul envoi, mention obligatoire _(5 assertions)_
- ✅ P3 — accusé bloqué si une réponse humaine existe déjà _(1 assertions)_
- ✅ P4 — réglages : enregistrement, test de connexion, canaux _(3 assertions)_
- ✅ P5 — démonstration hors connecteur _(3 assertions)_

## Q · Robustesse et non-régression

- ✅ Q1 — base sans messagerie : réglages et tableau recréés _(4 assertions)_
- ✅ Q2 — messages hostiles ou malformés : aucune injection, aucun plantage _(4 assertions)_
- ✅ Q3 — aucun appel réseau hors connecteur déclaré _(1 assertions)_
- ✅ Q4 — devis saisi à la main : comportement inchangé _(1 assertions)_
