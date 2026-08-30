# Tim Event — Rapport de tests (Phase 5 · Contrôle et bons signés)

Exécuté le 30/08/2026 18:56:59 · Chromium headless · 18.7 s

**21 scénarios · 121 assertions · 21 réussis · 0 échoués**

## R · Contrôle de livraison : compter, constater, signer

- ✅ R1 — le contrôle part de l'arrêt de tournée, avec le matériel du devis _(8 assertions)_
- ✅ R2 — comptage : les écarts apparaissent en direct _(6 assertions)_
- ✅ R3 — impossible de valider sans signature _(4 assertions)_
- ✅ R4 — double signature puis validation : bon numéroté, arrêt fait, audit _(13 assertions)_
- ✅ R5 — bon imprimable : quantités, écart, signatures, mention _(7 assertions)_
- ✅ R6 — reprise : la référence est ce qui a été livré et signé, pas le devis _(5 assertions)_
- ✅ R7 — matériel non restitué : montant chiffré, stock ajusté, facture proposée _(8 assertions)_
- ✅ R8 — motif « à récupérer plus tard » : constaté mais non facturé _(2 assertions)_

## S · Mode livreur : un téléphone qui n'a pas la base

- ✅ S1 — la mission tient dans un lien et ne contient que la mission _(6 assertions)_
- ✅ S2 — le livreur ouvre le lien : mission seule, base vide, aucun accès aux données _(7 assertions)_
- ✅ S3 — le livreur compte, fait signer, et repart avec un lien de retour _(5 assertions)_
- ✅ S4 — le patron ouvre le lien reçu : bon intégré, arrêt fait, stock ajusté _(11 assertions)_
- ✅ S5 — import manuel d'un lien collé, et refus d'un lien abîmé _(3 assertions)_
- ✅ S6 — un même bon importé deux fois ne crée pas de doublon _(2 assertions)_

## T · Connecteur, réglages et non-régression

- ✅ T1 — avec connecteur : mission publiée, lien court, retour automatique _(10 assertions)_
- ✅ T2 — sans connecteur : tout fonctionne quand même, hors ligne _(3 assertions)_
- ✅ T3 — réglages du contrôle : signature livreur facultative _(4 assertions)_
- ✅ T4 — base ancienne : réglages, compteurs et tableau créés _(5 assertions)_
- ✅ T5 — photos : ajout, restitution, suppression _(3 assertions)_
- ✅ T5b — rappel de sauvegarde : alerte, export, silence ensuite _(6 assertions)_
- ✅ T6 — non-régression : devis, tournée et assistant intacts _(3 assertions)_
