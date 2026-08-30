# Tim Event — Phase 3 « Assistant de saisie » : dicter au lieu de remplir

Ce document accompagne `index.html` (application complète, un seul fichier) et la suite
`tests/assistant.js`. Il décrit **ce que l'assistant comprend**, **ce qu'il ne fait jamais**,
et **comment le régler**.

---

## 1. Le principe : comprendre → vérifier → pré-remplir → tu valides

Une note vocale ou deux lignes écrites remplacent le formulaire. L'assistant suit toujours
les quatre mêmes temps :

1. **Capture** — dictée par le micro de l'application, micro du clavier (iPhone / Android),
   ou saisie au clavier. Le texte reste modifiable avant analyse.
2. **Compréhension** — un moteur français **local** identifie la nature de l'acte, extrait
   client, dates, quantités, articles, livraison, montants. Aucun appel réseau, aucune donnée
   qui sort de l'appareil, fonctionne hors ligne.
3. **Fiche de vérification** — l'assistant affiche ce qu'il a compris, champ par champ, avec
   un niveau de confiance, les lignes chiffrées, les **questions** quand il hésite, et le
   **texte non utilisé** pour que rien ne disparaisse en silence.
4. **Pré-remplissage** — le formulaire habituel s'ouvre déjà rempli, avec un bandeau de
   rappel. **Rien n'est enregistré tant que tu n'as pas appuyé sur « Enregistrer ».**

Conséquence importante : l'assistant n'écrit jamais directement dans la base. Il passe par
les mêmes écrans, donc **toutes les règles de Phase 2 restent actives** — contrôle de stock,
marge négative bloquante, TVA du document, minimum de commande, numérotation, piste d'audit.
Un devis dicté et un devis tapé produisent exactement le même enregistrement.

---

## 2. Les actes de gestion couverts

| Acte | Exemple de dictée | Écran ouvert |
|---|---|---|
| **Devis** | « Devis pour Julie Martin, mariage le 12 septembre, 120 chaises napoléoniennes et 10 tables rondes, livraison et reprise au 12 rue des Fleurs 69003 Lyon, nappage pour 120 convives, créneau imposé, 10 % de remise » | Nouveau devis |
| **Réservation** | « Réserve 80 chaises et 8 tables rondes pour Paul Durand samedi prochain au château de Bagnols » | Nouvelle réservation |
| **Fiche client** | « Nouvelle cliente Sophie Bernard, 14 avenue Jean Jaurès 69007 Lyon, 06 12 34 56 78, sophie point bernard arobase gmail point com » | Nouveau client |
| **Facture** | « Facture les 100 chaises à Julie Martin » | Nouvelle facture |
| **Encaissement** | « Paul Durand a payé 1 200 € par virement hier » | Enregistrer un paiement |
| **Arrêt de tournée** | « Planifie une livraison chez Julie Martin demain à 8h30, 120 chaises » | Nouvel arrêt |
| **Bon de commande** | « Prépare un bon de commande pour Julie Martin, 120 chaises et 10 tables rondes » | Nouveau bon |
| **Article de stock** | « Nouvel article de stock : parasol chauffant, 45 € » | Nouvel article |
| **Ajustement de stock** | « J'ai reçu 50 chaises napoléoniennes » · « 5 nappages blancs cassés » | Ajuster |
| **Changement de statut** | « Le devis DEV-0002 est accepté » | Appliqué directement (action réversible, tracée) |

Une note qui contient plusieurs actes (« Réserve 80 chaises pour Julie samedi. Ensuite
planifie la livraison vendredi à 9h. ») traite le premier et propose les suivants en un clic.

---

## 3. Ce que le moteur sait lire

| Famille | Exemples reconnus |
|---|---|
| **Dates** | demain, après-demain, hier, lundi prochain, le 12 septembre, 12/09/2026, dans 3 semaines, la semaine prochaine, début / mi / fin septembre, le 15 (jour seul) |
| **Heures** | 8h30, à 8 h, huit heures et demie, midi, 18 heures, 14:15, 6h du soir |
| **Nombres** | 120, quatre-vingts, quatre-vingt-dix-sept, cent vingt, deux cent cinquante, mille deux cents |
| **Montants** | 1 250,50 € HT, deux mille euros, deux euros cinquante, 10 % de remise, remise de 50 € |
| **Coordonnées** | 06 12 34 56 78, +33 6 …, julie@test.fr, « point » et « arobase » dictés, 12 rue des Fleurs 69003 Lyon (accents et majuscules restitués), SIREN / SIRET |
| **Articles** | pluriels, synonymes (« nappe » → nappage, « sono », « lumière »), fautes de dictée tolérées (« napoleonnienne »), prix ligne (« 20 chaises à 2 € ») |
| **Livraison** | retrait / livraison / livraison + reprise, « ils viennent chercher », « on livre et on reprend », distance en km, prix négocié (« je lui fais la livraison à 60 € ») |
| **Suppléments** | nappage pour N convives, étage sans ascenseur (avec le niveau), créneau horaire imposé, reprise le dimanche soir, portage long, N heures d'attente |
| **Divers** | nom d'événement (mariage, séminaire, baptême…), lieu (château, domaine, salle…), validité (« valable 15 jours »), acompte, mode de règlement, référence document (DEV-0002, FAC-0001) |

Trois pièges classiques sont traités explicitement : **« 2 heures d'attente »** n'est pas une
heure de rendez-vous, **« reprise le dimanche soir »** n'est pas une date d'événement, et une
date sans année suit le **sens de l'acte** — « payé le 28 août » dit un 29 août reste dans
l'année en cours, alors que « devis pour le 15 janvier » vise l'année suivante.

---

## 4. Les garde-fous

- **Aucune écriture silencieuse.** Le moteur d'analyse est une fonction pure : mêmes entrées →
  mêmes sorties, aucune modification de la base pendant l'analyse (testé).
- **Ambiguïté = question, jamais un choix arbitraire.** Deux clients homonymes, un « nappage »
  qui peut être blanc ou doré, un article absent du catalogue : l'assistant demande. Un article
  inconnu n'est jamais remplacé par un article approchant.
- **Champs obligatoires signalés en amont** : client manquant (l'application est bloquée avec
  un message), nom d'événement pour une réservation, créneau horaire pour un arrêt de tournée.
- **Transparence** : la ligne « Non utilisé » liste ce que l'assistant n'a pas su exploiter.
- **Confiance affichée** en pourcentage ; sous 75 %, le bandeau du formulaire invite à
  contrôler montants et dates.
- **Piste d'audit** : chaque pré-remplissage écrit une entrée `assistant` avec le début de la
  phrase dictée.
- **Réservations** : seules les lignes rattachées à un article de stock sont injectées ; les
  autres sont signalées, pour ne jamais réserver le mauvais matériel.

---

## 5. La dictée en pratique

- **Bouton 🎙️** dans la barre du haut, dans le menu, et bouton flottant sur mobile.
- **Navigateurs** : la dictée intégrée utilise l'API Web Speech (Chrome, Edge, Safari iOS ≥ 14.5).
  Elle nécessite en général une connexion : la reconnaissance se fait côté navigateur/OS.
- **Hors ligne ou navigateur non compatible** : le micro du clavier iPhone/Android écrit
  directement dans la zone de texte, avec exactement le même résultat. L'assistant le rappelle
  au lieu d'échouer.
- **Note vocale déjà enregistrée** (WhatsApp, dictaphone) : elle n'est pas transcrite par
  l'application. Deux options : la lire à voix haute pendant la dictée, ou brancher le service
  optionnel décrit au §7 pour la transcription.

---

## 6. Correspondances apprises

Quand tu lèves une ambiguïté (« nappages » → *Nappage doré / champagne*), le choix est
enregistré dans `settings.assistant.alias`. La dictée suivante ne repose plus la question.
Les correspondances sont listées et supprimables dans **Paramètres → Assistant**, et suivent
l'export / import JSON.

---

## 7. Renfort IA — optionnel, désactivé par défaut

Sans URL renseignée, **rien ne sort de l'appareil** : c'est le réglage d'usine. Si tu veux
couvrir les formulations très inhabituelles, tu peux brancher un service (le même
Cloudflare Worker que le proxy de distance, par exemple). Il n'est appelé que lorsque
l'analyse locale échoue ou doute (confiance < 60 %), et son résultat **complète** l'analyse
locale sans jamais l'écraser ; la fiche de vérification reste obligatoire.

Contrat attendu — `POST {iaUrl}` :

```jsonc
// requête
{ "texte": "…", "today": "2026-08-29",
  "clients":   [{ "id": 101, "nom": "Julie Martin", "societe": "" }],
  "catalogue": [{ "tarifId": 1, "stockId": 201, "nom": "Chaise napoléonienne", "prix": 2.5 }],
  "types": ["client","reservation","devis","facture","paiement","arret","bon","stock","ajustement","statut"] }

// réponse
{ "intention": {
    "type": "devis", "conf": 0.9,
    "champs":  { "clientId": 101, "date": "2026-09-12", "nomEv": "Mariage" },
    "lignes":  [{ "qty": 120, "desc": "Chaise napoléonienne", "prixUnit": 2.5, "tarifId": 1, "stockId": 201 }],
    "livraison": { "mode": "aller_retour", "distanceKm": 42, "supplements": { "creneauImpose": true } } } }
```

Délai maximum : 9 secondes, puis repli silencieux sur l'analyse locale.

---

## 8. Réglages (Paramètres → 🎙️ Assistant)

- **Assistant actif** — masque ou affiche les points d'entrée.
- **Ouvrir la fiche automatiquement** — hors service par défaut ; une fois activé, la fiche
  s'ouvre seule quand la confiance dépasse 85 % et qu'aucune question n'est en attente
  (annulable pendant 1,2 s).
- **Langue de dictée** — fr-FR par défaut.
- **Renfort IA** — case + URL (§7).
- **Correspondances apprises** — consultation et suppression.

---

## 9. Rejouer les tests

```bash
npm i -D playwright && npx playwright install chromium
node tests/nonreg.js            # 79 scénarios Phase 2  → rapport-tests.md
node tests/assistant.js         # 32 scénarios Phase 3  → rapport-assistant.md
node tests/shots-assistant.js   # captures de contrôle  → shots/
```

Comme en Phase 2, l'application réelle est lancée dans Chromium, la BAN et le mini-proxy sont
simulés, aucun appel réseau ne sort. La suite Phase 3 couvre trois familles :

- **K · moteur pur** — nature de l'acte sur 18 formulations, nombres, dates, heures, montants,
  coordonnées, catalogue, clients, devis complet, modes de livraison, bascule d'année selon le
  sens temporel de l'acte, notes multi-actes, déterminisme, 14 saisies aberrantes ;
- **L · interface** — panneau, fiche de vérification, pré-remplissage des 9 formulaires,
  enregistrement réel avec les bons montants, ambiguïtés et apprentissage, blocages ;
- **M · non-régression** — base sans réglages assistant, 60 dictées aléatoires, devis saisi à
  la main inchangé, export / import JSON.

Dernière exécution : **112 scénarios, 617 assertions, 0 échec** (79 Phase 2 + 33 Phase 3).

---

## 10. Limites connues et suite possible

- La dictée intégrée dépend du navigateur ; sur un navigateur ancien, seul le micro du clavier
  fonctionne (l'assistant le dit clairement).
- Les **notes vocales enregistrées** ne sont pas transcrites sans service externe (§7).
- L'assistant traite **un acte principal par dictée** ; les actes secondaires sont proposés
  ensuite, un par un.
- L'**étage sans ascenseur** n'est facturé que si « sans ascenseur » est prononcé : dire
  « 3e étage » seul ne déclenche aucun supplément, volontairement.
- Le **statut** est appliqué directement quand la référence est claire (DEV-0002) ; sinon
  l'assistant ouvre le sélecteur de statut plutôt que de deviner le document.
- Pistes suivantes : dictée d'une **recherche** (« montre-moi les devis en attente de Julie »),
  transcription des notes vocales via le Worker, et lecture d'un **bon de commande photographié**.

---

## 11. Où se trouve le code

Tout est dans `index.html`. Pour maintenir la modification sur une future version de
l'application, le dossier `build/` contient les sources séparées et le script d'injection :

```bash
node build/merge.js     # assemble le moteur (build/nlu.js + build/nlu2.js)
python3 build/splice.py # injecte CSS + HTML + JS dans index.orig.html → index.html
```

Repères dans le fichier : le moteur est encadré par les marqueurs `ASSIST-NLU-START` /
`ASSIST-NLU-END` (fonction pure, testable isolément), l'interface suit immédiatement
(`ASSIST`, `assistOpen`, `assistFill*`).
