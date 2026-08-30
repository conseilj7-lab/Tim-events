# Tim Event — Phase 5 « Contrôle et bons signés » : compter à deux, faire signer

Ce document accompagne `index.html`, le connecteur `connecteur/worker.js` et la suite
`tests/controle.js`. Il explique comment un litige sur le nombre de chaises devient
impossible à tenir, et comment un livreur travaille sans avoir accès à votre base.

---

## 1. D'où vient le litige

Toujours du même endroit : le matériel est déposé, personne ne compte à deux, personne ne
signe. Trois jours plus tard, c'est votre parole contre celle du client, et vous payez.

La réponse tient en trois points, appliqués à chaque arrêt de tournée :

1. **On compte devant le client**, article par article, sur le téléphone.
2. **L'écart est constaté sur-le-champ** — pas au retour au dépôt.
3. **Le client signe les quantités réellement comptées**, avec l'heure et le nom du signataire.

Le bon signé devient la référence : à la reprise, ce n'est pas le devis qui fait foi, c'est
**ce que le client a reconnu avoir reçu**.

---

## 2. Le déroulé sur le terrain

Sur l'arrêt de tournée, deux boutons : **📦 Contrôler et faire signer** et **📤 Livreur**.

L'écran de comptage reprend le matériel du devis, de la réservation ou du bon de commande :

| Article | Prévu | Reçu | Écart |
|---|---|---|---|
| Chaise napoléonienne | 120 | **118** | −2 |
| Table ronde 150cm | 10 | **10** | ✓ |

- Gros boutons **− / +** et saisie directe : utilisable debout, une main occupée.
- L'écart s'affiche **en direct**, la ligne passe en alerte, le bilan se met à jour.
- **+ Article non prévu** pour ce que vous ajoutez sur place.
- Observations libres, photos facultatives (utiles pour la casse constatée).
- Mention imprimée avant la signature, paramétrable.
- **Deux pavés de signature** : le client et le livreur. La double signature protège aussi
  le livreur, qu'on accuse parfois d'avoir mal chargé.

Sans signature, **rien ne s'enregistre** : le bouton annonce « Faire signer pour valider ».

Une fois signé : le bon est numéroté (BL-0001, BR-0001), l'arrêt de tournée passe en « fait »,
la piste d'audit est alimentée, et le document imprimable est disponible — quantités, écarts,
mention, les deux signatures avec nom et horodatage.

---

## 3. La reprise : là où l'argent se perd

Au retour, l'écran ne part **pas** du devis mais du bon de livraison signé.

> Référence : 118 chaises livrées et signées (BL-0001) — pas les 120 du devis.

Pour chaque ligne, un motif : cassé, perdu, conservé par le client, à récupérer plus tard.
Le manquant est **chiffré au tarif catalogue** et affiché avant la signature :

> ⚠️ 1 écart constaté — matériel non restitué : **7,50 € HT**

À la validation :

- le **stock est ajusté** automatiquement (−3 chaises, motif tracé) ;
- une **facture pré-remplie** est proposée, avec le numéro du bon signé comme justificatif ;
- « à récupérer plus tard » est constaté mais **jamais facturé**.

Vous gardez la main : la facturation est proposée, jamais imposée.

---

## 4. Le livreur n'a pas votre base — et n'en a pas besoin

C'est le point que vous avez soulevé : tout est sur votre iPhone. Le livreur reçoit donc
**une mission, pas un accès**.

```
Votre iPhone ──── lien de mission (WhatsApp / SMS) ────► téléphone du livreur
      ▲                                                        │
      └──────── bon signé (retour automatique ou lien) ◄────────┘
```

- Le lien contient **uniquement** : client, adresse, téléphone, créneau, matériel à contrôler.
  Aucun devis, aucun montant, aucun autre client. Vérifié par les tests.
- Le livreur ouvre le lien : l'application s'affiche en **mode livreur** — menu masqué, une
  seule mission à l'écran. Sa base reste vide.
- Il compte, fait signer, valide. **Tout fonctionne hors ligne** : sur place, le réseau est
  souvent mauvais.
- Le retour se fait de deux façons :
  - **avec connecteur** : le bon signé part tout seul, vous le récupérez à la synchronisation
    suivante (lien de mission très court, moins de 220 caractères) ;
  - **sans connecteur** : le livreur vous renvoie un lien par WhatsApp ou SMS ; vous l'ouvrez
    ou vous le collez dans « 📥 Importer un bon ». Même résultat.
- Le bon signé reste sur le téléphone du livreur : il peut le renvoyer plus tard.
- Un même bon importé deux fois **ne crée pas de doublon** et n'ajuste pas le stock deux fois.

La signature pèse moins de 4 Ko : elle voyage dans un simple lien, sans serveur d'images.

---

## 5. Ce que vos données craignent encore

Votre base entière vit sur un seul téléphone. Un écran cassé, un vol, une réinitialisation, et
l'entreprise repart de zéro. L'application affiche désormais une **alerte de sauvegarde** en
tête du tableau de bord dès que le dernier export date de plus de sept jours — ou n'a jamais eu
lieu — avec un bouton qui exporte le fichier en un geste. Rangez-le dans iCloud ou envoyez-le
vous-même par mail : c'est trente secondes par semaine contre des années de données.

La suite logique, si vous voulez aller plus loin : une **sauvegarde chiffrée automatique** vers
le connecteur (chiffrement dans le navigateur, mot de passe jamais transmis). Le connecteur est
déjà en place, il ne manque que l'endpoint et l'écran de restauration.

---

## 6. Réglages (Paramètres → 📦 Contrôle)

- **Livreur par défaut** et **son téléphone** (bouton WhatsApp direct pour envoyer la mission).
- **Exiger aussi la signature du livreur** — activé par défaut.
- **Autoriser les photos** — stockées à part pour ne pas alourdir chaque sauvegarde.
- **Proposer la facturation du matériel non restitué** — le stock est ajusté dans tous les cas.
- **Mention imprimée avant signature** — à faire relire par votre assureur ou votre comptable
  si vous voulez la durcir.

---

## 7. Installer le relais des missions (facultatif)

Le connecteur de la Phase 4 gagne trois routes ; rien d'autre à déployer :

```
POST /mission                 (jeton entreprise)  dépose la mission, valable 7 jours
GET  /mission/:code           (le code fait clé)  le livreur récupère sa mission
POST /mission/:code/retour    (le code fait clé)  le livreur renvoie le bon signé
GET  /retours?since=…         (jeton entreprise)  vous récupérez les bons signés
```

Les codes de mission sont aléatoires et expirent au bout de sept jours ; les bons signés sont
conservés trente jours côté connecteur, définitivement dans votre application.

---

## 8. Rejouer les tests

```bash
node tests/nonreg.js          # 79 scénarios  Phase 2 (livraison)
node tests/assistant.js       # 33 scénarios  Phase 3 (assistant de saisie)
node tests/messagerie.js      # 24 scénarios  Phase 4 (messagerie)
node tests/controle.js        # 21 scénarios  Phase 5 (contrôle)
node tests/shots-controle.js  # captures de contrôle
```

La suite Phase 5 signe réellement à la souris sur le pavé tactile, vérifie la numérotation, le
document imprimable et ses deux signatures dessinées, la reprise fondée sur le bon de livraison,
le chiffrage des manquants, l'ajustement du stock, la facturation proposée, le mode livreur sur
un téléphone vierge, le retour par lien et par connecteur, le refus d'un lien abîmé, l'absence
de doublon, et le rappel de sauvegarde.

Dernière exécution : **157 scénarios, 851 assertions, 0 échec**.

---

## 9. Limites connues et suite

- **Pas de géolocalisation** du point de signature : c'est faisable (l'heure et le nom y sont
  déjà), mais cela demande l'accord du livreur et une mention au client.
- **Photos hors lien** : elles restent sur le téléphone du livreur ; sans connecteur, il faut
  les envoyer à part. Un stockage R2 côté connecteur réglerait cela.
- **Un livreur à la fois** par mission ; pas d'attribution ni de suivi d'équipe.
- **Pas de valeur probante horodatée** au sens juridique fort (pas de tiers de confiance).
  Pour un litige ordinaire, un bon signé nominatif et horodaté suffit très largement ; pour des
  montants importants, parlez-en à votre assureur.
- Pistes : signature sur photo du matériel livré, comparaison automatique livraison/reprise sur
  plusieurs événements, et relance automatique des bons non retournés en fin de journée.
