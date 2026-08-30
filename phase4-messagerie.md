# Tim Event — Phase 4 « Messagerie unifiée » : répondre depuis l'app

Ce document accompagne `index.html`, le connecteur `connecteur/worker.js` et la suite
`tests/messagerie.js`. Il dit **ce qui est réellement possible canal par canal**, comment
l'assistant traite le premier niveau, et comment brancher le tout.

---

## 1. La réalité des trois canaux (vérifiée en août 2026)

| Canal | Peut-on recevoir et répondre depuis une app tierce ? | Ce qu'il faut |
|---|---|---|
| **WhatsApp** | **Oui**, via la WhatsApp Business Platform (Cloud API) | Compte Meta Business vérifié, un numéro dédié à l'API (il quitte l'application WhatsApp Business), un serveur qui reçoit les webhooks, jeton permanent |
| **Instagram** | **Oui**, via l'*Instagram API with Instagram Login* | Compte **professionnel** (Business ou Creator) — aucune Page Facebook nécessaire sur ce chemin —, App Review Meta avec vérification d'entreprise, webhook. Le client doit avoir écrit en premier |
| **TikTok** | **Pas en direct.** L'API publique TikTok n'expose aucun point d'entrée de messagerie. La *Business Messaging API* existe mais elle est réservée aux comptes autorisés passant par une plateforme partenaire agréée | Soit un partenaire agréé (abonnement mensuel), soit le mode manuel intégré à l'app |

Deux règles communes à Meta, qui structurent l'écran :

- **Le client doit écrire en premier.** Aucune prospection sortante n'est possible par ces API.
- **Fenêtre de 24 h.** Après le dernier message du client, vous répondez librement et
  gratuitement pendant 24 h. Passé ce délai, seul un **modèle approuvé** passe, et il est
  facturé (les messages entrants, eux, sont toujours gratuits). L'application affiche le temps
  restant et refuse d'envoyer un texte libre hors fenêtre, pour éviter l'échec d'envoi et la
  facturation surprise.

Sources : documentation Meta *Instagram API with Instagram Login → Messaging*, WhatsApp
Business Platform (facturation au message depuis juillet 2025), TikTok API for Business
(*Business Messaging API*, accès partenaire).

---

## 2. L'architecture retenue

L'application reste **un fichier statique** : elle ne peut ni recevoir un webhook, ni détenir
un jeton Meta sans l'exposer. On ajoute donc une pièce minuscule et unique :

```
WhatsApp ─┐
Instagram ─┼─► webhook ─► CONNECTEUR (Cloudflare Worker + KV) ◄── API JSON ── Tim Event (index.html)
TikTok ───┘   (partenaire ou saisie manuelle)
```

Le connecteur (`connecteur/worker.js`, ~230 lignes) :

- vérifie la signature `X-Hub-Signature-256` de chaque webhook Meta et répond 200 immédiatement ;
- normalise WhatsApp et Instagram dans **un seul format de conversation** ;
- stocke dans KV, purge au bout de 90 jours ;
- expose à l'application, derrière un jeton `Bearer` : `GET /etat`, `GET /threads?since=`,
  `POST /send`, `POST /entrant` (pour TikTok via partenaire, Zapier, ou un formulaire) ;
- garde les jetons Meta côté serveur : l'application n'en voit jamais aucun.

Sans connecteur, l'écran Messagerie reste utile : conversations saisies à la main (TikTok, SMS,
appel entrant), qualification, fiche de synthèse, brouillons de réponse.

---

## 3. L'assistant de premier niveau

À chaque message reçu, avant vous :

1. **Il qualifie** — nature de la demande (prix, disponibilité, livraison, modification, SAV,
   paiement, catalogue), date de l'événement, nombre de convives, lieu, matériel reconnu au
   catalogue, budget évoqué, urgence. Il réutilise le moteur de compréhension de la Phase 3 :
   mêmes dates, mêmes quantités, mêmes articles.
2. **Il signale ce qui manque** — date, quantités, lieu, téléphone.
3. **Il rédige une réponse** : salutation, reformulation de ce qui a été compris (pour que le
   client corrige tout de suite), annonce de la suite, et **au plus deux questions** sur ce qui
   manque, signée à votre nom. Vous relisez, vous corrigez, vous envoyez.

Exemple produit automatiquement :

> Bonjour Camille, merci pour votre message.
> Je note votre demande pour le samedi 12 septembre 2026 (Château de Bagnols) : 120 × chaise
> napoléonienne, 10 × table ronde 150cm.
> Je vous prépare un devis chiffré.
> Pour aller plus vite, pouvez-vous me préciser le lieu de l'événement et le téléphone ?
> Tim Event

**Accusé de réception automatique** (désactivé par défaut) : si vous l'activez, ce message
part **une seule fois par conversation**, uniquement si personne n'a encore répondu, avec la
mention « — Réponse automatique » et, hors horaires, la précision que vous répondrez à la
réouverture. Tout le reste attend votre validation : c'est volontaire — un robot qui négocie un
mariage à votre place vous coûterait plus cher qu'il ne vous ferait gagner.

---

## 4. La fiche de synthèse

Un bouton, et vous avez tout pour appeler : nom, téléphone cliquable, canal, nature de la
demande, date de l'événement, convives, lieu, matériel demandé, **estimation au catalogue**,
budget évoqué, informations manquantes, et un résumé en une phrase.

En bas, les actions qui évitent la re-saisie — elles réutilisent les ponts de la Phase 3 :

- **📞 Appeler** (lien direct) · **💬 Répondre** (retour à la conversation)
- **👤 Créer le client** — fiche pré-remplie, puis la conversation se rattache automatiquement
  au client par le téléphone
- **📄 Devis** · **📋 Réservation** · **🚚 Tournée** — formulaires pré-remplis avec la date, le
  lieu, le matériel et les prix du catalogue

Le devis issu d'une conversation WhatsApp passe donc par les mêmes règles que les autres :
stock, marge, TVA, numérotation, piste d'audit.

---

## 5. Garde-fous

- **Rien n'est envoyé sans vous**, hors accusé de réception explicitement activé.
- **Fenêtre de 24 h affichée en clair** ; hors fenêtre, le bouton devient « Enregistrer le
  brouillon » et l'application propose l'appel ou WhatsApp direct.
- **Connecteur injoignable** : le message est conservé en brouillon, jamais perdu ; la
  synchronisation échoue proprement sans toucher aux conversations locales.
- **Jeton invalide** : refus net, message explicite.
- **Messages hostiles** : tout contenu reçu est échappé avant affichage (testé avec balises
  `<script>` et `onerror`), aucune exécution possible.
- **Aucun appel réseau** en dehors du connecteur déclaré (testé).
- **Rétention** : 90 jours côté connecteur, purge automatique ; l'historique complet reste dans
  l'application, en local.

---

## 6. Installer le connecteur

```bash
npm i -g wrangler
wrangler kv namespace create MSG          # noter l'id renvoyé
# wrangler.toml : name, main = "worker.js", kv_namespaces = [{ binding = "MSG", id = "…" }]
wrangler secret put APP_TOKEN             # inventez une longue chaîne : à recopier dans l'app
wrangler secret put META_VERIFY_TOKEN     # même valeur que dans le tableau de bord Meta
wrangler secret put META_APP_SECRET
wrangler secret put WA_TOKEN              # jeton permanent WhatsApp
wrangler secret put WA_PHONE_ID
wrangler secret put IG_TOKEN
wrangler deploy
```

Puis, côté Meta (developers.facebook.com) :

1. Créer une app *Business*, ajouter les produits **WhatsApp** et **Instagram**.
2. Webhook : URL `https://votre-worker.workers.dev/webhook/meta`, jeton de vérification =
   `META_VERIFY_TOKEN`, abonnements `messages` (WhatsApp) et `messages` (Instagram).
3. Permissions : `whatsapp_business_messaging`, `instagram_business_manage_messages`,
   `instagram_business_basic`. Passer l'**App Review** avec vérification d'entreprise pour
   sortir du mode test (sans review, seuls les comptes testeurs peuvent écrire).
4. Dans Tim Event → Paramètres → 💬 Messagerie : coller l'URL du connecteur et `APP_TOKEN`,
   puis **Tester la connexion**.

---

## 7. Ce que ça coûte

- **Connecteur** : gratuit dans le palier gratuit Cloudflare pour ce volume.
- **Instagram** : aucun coût par message.
- **WhatsApp** : messages entrants gratuits, réponses libres gratuites dans les 24 h. Vous ne
  payez que les modèles envoyés hors fenêtre (marketing, utilitaire, authentification), au
  message, selon le pays. Concrètement : si vous répondez dans la journée, votre facture reste
  à zéro.
- **TikTok** : gratuit en mode manuel ; abonnement mensuel si vous passez par un partenaire.

---

## 8. TikTok : trois options honnêtes

1. **Manuel intégré** (livré) : bouton « ＋ Conversation », vous collez le message reçu,
   l'assistant qualifie et prépare la fiche et la réponse. Vous recopiez la réponse dans TikTok.
   Zéro coût, zéro dépendance.
2. **Partenaire agréé** : une plateforme disposant de la Business Messaging API relaie les
   messages vers `POST /entrant` du connecteur. L'écran fonctionne alors comme WhatsApp.
3. **Détourner le trafic** : mettre en bio et en commentaire un lien `wa.me` pour ramener les
   conversations TikTok vers WhatsApp, où tout est automatisé. C'est ce que font la plupart des
   prestataires événementiels, et c'est le meilleur rapport effort/résultat.

---

## 9. Rejouer les tests

```bash
node tests/nonreg.js        # 79 scénarios  Phase 2 (livraison)
node tests/assistant.js     # 33 scénarios  Phase 3 (assistant de saisie)
node tests/messagerie.js    # 24 scénarios  Phase 4 (messagerie)
node tests/shots-messagerie.js
```

La suite Phase 4 simule le connecteur (aucun appel réseau réel) et couvre : qualification,
priorité, fenêtre de 24 h, synchronisation sans doublon, envoi, panne du connecteur, jeton
invalide, accusé automatique (désactivé, activé, non doublé), fiche de synthèse, conversions
vers devis et client, rapprochement automatique, messages hostiles, non-régression du devis.

Dernière exécution : **136 scénarios, 730 assertions, 0 échec**.

---

## 10. Limites connues et suite

- **Pas de prospection sortante** : c'est une limite des plateformes, pas de l'application.
- **Médias** (photos, vocaux reçus) : affichés comme `[pièce jointe]`. Le stockage des fichiers
  demanderait un espace R2 côté connecteur — prochaine étape naturelle.
- **Un seul opérateur** : pas de gestion d'équipe ni d'attribution de conversation.
- **Instagram** exige que le client ait écrit en premier ; les *stories mentions* et commentaires
  ne sont pas encore repris.
- Pistes : réponse aux **commentaires** Instagram et TikTok (API disponibles pour les
  commentaires, contrairement aux DM TikTok), modèles WhatsApp approuvés pour la relance de
  devis, et rattachement automatique d'une conversation à un devis existant.
