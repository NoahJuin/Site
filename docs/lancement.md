# Checklist de lancement

Cochez dans l'ordre. Tout le code est prêt : il ne reste que ce qui demande **vos** comptes, **vos** papiers et **votre** produit.

## Semaine 1 — Produit et statut

- [ ] **Créer votre micro-entreprise** sur [formalites.entreprises.gouv.fr](https://formalites.entreprises.gouv.fr) (gratuit, environ 15 jours pour le SIRET). Activité : vente en ligne.
- [ ] **Commander 2 ou 3 échantillons** chez CJdropshipping (recherche « sleep headphones headband ») ou sur AliExpress. Comparez le confort sur le côté, l'autonomie réelle et la qualité du tissu.
- [ ] Noter le **coût livré en France** du meilleur, à renseigner dans `UNIT_COST_CENTS`.
- [ ] Vérifier que les caractéristiques du site correspondent au produit reçu (`views/index.html`, `src/support.js`). Sinon, corrigez les textes.
- [ ] **Filmer 5 vidéos** avec les échantillons (scripts dans `docs/marketing.md`) et prendre 5 à 6 photos pour remplacer les illustrations de `public/img/`.

## Semaine 2 — Comptes (environ 2 heures)

- [ ] **Nom de domaine** (OVH, Gandi, Namecheap… ~10 €/an) → `BASE_URL`.
- [ ] **Stripe** : créer et activer le compte, puis récupérer la clé secrète → `STRIPE_SECRET_KEY`.
- [ ] **Stripe** : créer le coupon -10 % (Catalogue de produits → Coupons), puis le code promo `BIENVENUE10` limité aux premières commandes → `WELCOME_CODE=BIENVENUE10`.
- [ ] **Fournisseur** : clé API CJ → `CJ_API_KEY`, identifiants des 3 couleurs → `SUPPLIER_VID_*`, et un solde approvisionné. *(Sinon, mode e-mail : `SUPPLIER_PROVIDER=email` + `SUPPLIER_EMAIL`.)*
- [ ] **E-mails** : compte Brevo (gratuit) → `SMTP_*`. Configurer SPF et DKIM sur le domaine (Brevo vous guide).
- [ ] **Assistant client IA** *(optionnel, recommandé)* : clé API sur [console.anthropic.com](https://console.anthropic.com) → `ANTHROPIC_API_KEY`. Comptez quelques centimes par conversation.
- [ ] **Médiateur de la consommation** : adhérer à un médiateur (obligatoire, ~50 à 150 €/an, par exemple CM2C, Medicys ou CNPM) → `MEDIATOR`.
- [ ] Renseigner `COMPANY_NAME`, `COMPANY_ADDRESS`, `COMPANY_SIRET`, `COMPANY_VAT`, `PUBLISHER_NAME` et `HOST_NAME`.

## Semaine 2 — Mise en ligne (environ 30 minutes)

- [ ] **Render** : New → Blueprint → choisir le dépôt GitHub. `render.yaml` crée le site et le disque.
- [ ] Saisir toutes les variables ci-dessus dans Render (modèle : `.env.example`).
- [ ] Brancher le domaine (Render → Settings → Custom Domain).
- [ ] **Webhook Stripe** : endpoint `https://votre-domaine.fr/webhooks/stripe`, avec les 4 événements listés dans le README → `STRIPE_WEBHOOK_SECRET`.
- [ ] Ouvrir `/admin` (identifiant `admin`, mot de passe = `ADMIN_PASSWORD`, généré par Render).

## Avant la première pub — tests (30 minutes)

- [ ] **Commande réelle** de 34,90 € avec votre propre carte : vérifiez l'e-mail de confirmation, la commande chez le fournisseur et la page `/suivi`. Remboursez-vous ensuite depuis Stripe.
- [ ] Vérifier l'arrivée du numéro de suivi et de l'e-mail d'expédition dans les jours qui suivent.
- [ ] Tester la pop-up de bienvenue et le code `BIENVENUE10` au paiement.
- [ ] Poser 3 questions à l'assistant (livraison, retours, suivi de commande).
- [ ] Vérifier le site sur votre téléphone.

## Lancement

- [ ] **Pixel Meta** (Gestionnaire d'événements) → `META_PIXEL_ID`, et/ou **pixel TikTok** → `TIKTOK_PIXEL_ID`.
- [ ] **Google Merchant Center** : ajouter le flux `https://votre-domaine.fr/feed.xml`.
- [ ] **Google Search Console** : soumettre `https://votre-domaine.fr/sitemap.xml`.
- [ ] Lancer le plan de test de 14 jours (`docs/marketing.md`, section 5).
- [ ] Chaque matin : lire le rapport quotidien par e-mail. Si une commande est en erreur, l'alerte arrive aussi par e-mail.

## Ce qui tourne ensuite tout seul

Paiements, commandes fournisseur, numéros de suivi, e-mails clients, relances de panier, codes de bienvenue,
demandes d'avis, réponses aux questions des clients (assistant IA), rapport quotidien et sauvegardes de la base.

Votre rôle : **créer des vidéos, piloter le budget pub, répondre aux e-mails que l'assistant vous transmet**.
