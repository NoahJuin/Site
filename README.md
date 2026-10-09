# Dormea — boutique e-commerce automatisée

Une boutique mono-produit prête à vendre, avec tout le back-office automatisé :
paiement, transmission au fournisseur, suivi de colis, e-mails clients, relance des paniers abandonnés,
collecte d'avis vérifiés, rapport quotidien et tableau de bord.

```bash
npm install
npm run dev        # http://localhost:3000 — mode démo (paiement simulé, fournisseur simulé)
npm test           # 11 tests de bout en bout
```

Admin : `http://localhost:3000/admin` (lancez avec `ADMIN_PASSWORD=... npm run dev`).

---

## 1. Le produit : bandeau de sommeil Bluetooth

| Critère | Pourquoi ça fonctionne |
|---|---|
| **Problème clair** | Les écouteurs font mal quand on dort sur le côté et tombent dans le lit. Tout le monde comprend en 3 secondes. |
| **Démontrable en vidéo** | Format idéal pour TikTok / Reels / Meta Ads : avant (écouteurs qui gênent) → après (on s'endort avec son podcast). |
| **Marché large et récurrent** | Insomnie, partenaire qui ronfle, voyageurs, adeptes du bruit blanc et de la méditation. Pas de saisonnalité, et c'est un cadeau idéal pour Noël et la fête des mères. |
| **Marge** | Coût fournisseur livré ≈ 8–10 €, prix de vente 34,90 €. Le pack duo à 59,90 € augmente le panier moyen. |
| **Logistique facile** | Léger, plat, pas fragile, sans liquide ni batterie lourde. Peu de retours. |
| **Peu de concurrence de marque** | Pas de leader dominant en France, contrairement aux écouteurs. |

Prix pratiqués (dans `src/config.js`) : **1 = 34,90 €**, **2 = 59,90 €**, **3 = 79,90 €**, livraison offerte.
Marge brute estimée sur un duo : 59,90 − 2 × 9,50 − frais Stripe ≈ **39,75 €**.

> ⚠️ Commandez un échantillon et vérifiez les caractéristiques réelles (épaisseur, autonomie, Bluetooth, lavage)
> avant de lancer les pubs. Les textes du site doivent correspondre exactement au produit reçu.

---

## 2. Ce qui est automatisé

```
Client ──► Stripe Checkout ──► webhook ──► Commande payée
                                              │
               ┌──────────────────────────────┼──────────────────────────────┐
               ▼                              ▼                              ▼
  E-mail de confirmation        Transmission au fournisseur        Pixel « Purchase »
                                 (API CJ ou e-mail à l'agent)       (Meta / TikTok / GA4)
                                              │
            Tâches planifiées toutes les 30 min (src/jobs.js)
                                              │
       ┌──────────────────────┬───────────────┼────────────────────┬─────────────────────┐
       ▼                      ▼               ▼                    ▼                     ▼
 Nouvel essai si le     Récupération du   E-mail « colis      Demande d'avis        Rapport quotidien
 fournisseur a échoué   n° de suivi       expédié »           après livraison       à l'admin
 (+ alerte admin)                                                   │
                                                                     ▼
                                                     Avis vérifié publié sur le site
                                                     (avis ≤ 3/5 → alerte service client)
```

| Automatisation | Détail |
|---|---|
| Paiement | Stripe Checkout : CB, Apple Pay, Google Pay (et PayPal, Klarna… si activés dans Stripe), codes promo. |
| Commande fournisseur | Dès le paiement, la commande part au fournisseur, sans risque de doublon (verrou atomique, webhooks idempotents). |
| Reprise sur erreur | En cas d'échec, jusqu'à 5 nouvelles tentatives, une alerte e-mail au premier échec et une autre si la commande reste bloquée. |
| Suivi de colis | Le n° de suivi est récupéré automatiquement (CJ), puis un e-mail part au client avec un lien 17track. Le client a aussi une page `/suivi`. |
| Panier abandonné | Si le client a coché la case marketing (RGPD), un e-mail de relance part avec un lien qui reprend son panier. |
| Avis clients | Un e-mail est envoyé quelques jours après la livraison. Les avis d'acheteurs vérifiés sont publiés automatiquement (positifs comme négatifs) et les étoiles alimentent Google (JSON-LD). |
| Remboursements | Un remboursement dans Stripe passe la commande à « Remboursée » et envoie une alerte pour annuler chez le fournisseur. |
| Rapport quotidien | Chaque jour : CA de la veille, marge estimée, paniers abandonnés, erreurs. |
| SEO / Shopping | `sitemap.xml`, `robots.txt`, données structurées Produit, flux Google Merchant Center sur `/feed.xml`. |
| Publicité | Pixels Meta, TikTok et GA4 chargés uniquement après consentement cookies. Événements ViewContent, InitiateCheckout et Purchase. |

---

## 3. Mise en ligne (≈ 1 heure)

### a. Stripe
1. Créez un compte sur [stripe.com](https://stripe.com) et activez-le (pièce d'identité + IBAN).
2. Récupérez la clé secrète dans **Développeurs → Clés API** et renseignez-la dans `STRIPE_SECRET_KEY`.
3. Dans **Développeurs → Webhooks**, ajoutez l'endpoint `https://votre-domaine.fr/webhooks/stripe` avec les événements
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired` et `charge.refunded`.
   Copiez le secret de signature dans `STRIPE_WEBHOOK_SECRET`.
4. (Optionnel) Activez Apple Pay, PayPal ou Klarna dans **Paramètres → Moyens de paiement**.

### b. Fournisseur
- **Option recommandée : CJdropshipping** (`SUPPLIER_PROVIDER=cj`). Créez un compte, trouvez le produit (« sleep headphones headband »),
  faites un échantillon, puis récupérez votre clé API (**My CJ → Authorization → API**) et les `vid` des 3 couleurs
  (`SUPPLIER_VID_NOIR`, etc.). Approvisionnez votre solde CJ : les commandes sont payées automatiquement dessus.
  Faites **une vraie commande test** de bout en bout : CJ fait évoluer son API, et tout le mapping des champs se trouve dans `src/suppliers/cj.js`.
- **Option agent / AliExpress** (`SUPPLIER_PROVIDER=email`) : chaque commande est envoyée automatiquement par e-mail à `SUPPLIER_EMAIL`.
  Saisissez ensuite le n° de suivi dans l'admin : l'e-mail d'expédition part tout seul.

### c. E-mails
N'importe quel SMTP fonctionne. [Brevo](https://brevo.com) (gratuit jusqu'à 300 e-mails/jour) est un bon choix.
Configurez SPF/DKIM sur votre domaine pour ne pas tomber en spam.

### d. Hébergement
- **Render** : connectez le dépôt GitHub, et `render.yaml` crée le service et le disque persistant. Renseignez ensuite les variables marquées `sync: false`.
- **Docker** (Railway, Fly.io, VPS…) : `docker build -t dormea . && docker run -p 3000:3000 -v dormea-data:/data --env-file .env dormea`.
- La base SQLite doit être sur un **disque persistant** (`DATABASE_PATH`).

### e. Obligations légales (France)
Renseignez les variables `COMPANY_*`, `PUBLISHER_NAME`, `HOST_NAME` et `MEDIATOR` : elles alimentent les mentions légales et les CGV.
Il vous faut un statut (la micro-entreprise suffit pour démarrer) et l'adhésion à un médiateur de la consommation.
Les modèles fournis (CGV, confidentialité, retours) sont une base de départ : faites-les relire.

---

## 4. Lancer les ventes

1. **Contenu** : commandez 2 ou 3 échantillons et filmez 5 à 10 vidéos verticales (problème → démonstration → réaction).
   Remplacez les illustrations `public/img/*.svg` par de vraies photos.
2. **Pubs** : renseignez `META_PIXEL_ID` et/ou `TIKTOK_PIXEL_ID`, lancez une campagne Ventes optimisée sur « Purchase »,
   avec 20 à 30 €/jour par créa pendant 3 à 4 jours. Coupez ce qui ne vend pas et augmentez le budget sur ce qui vend.
3. **Google Shopping** : ajoutez `https://votre-domaine.fr/feed.xml` dans Merchant Center pour obtenir des fiches gratuites.
4. **Pilotage** : surveillez le rapport quotidien et le taux de conversion dans `/admin`.

Bonnes pratiques déjà intégrées : pas de faux avis, de faux compte à rebours ni de faux prix barré
(interdits par le Code de la consommation et la directive Omnibus). La réduction affichée est réelle (prix du pack par rapport au prix unitaire).

---

## 5. Structure

```
src/
  config.js          produit, offres, prix, variables d'environnement
  app.js             routes du site, checkout, webhook Stripe, SEO, flux Google
  orders.js          cycle de vie des commandes (paiement → fournisseur → suivi → avis)
  stripe.js          création des sessions de paiement + traitement des événements
  jobs.js            tâches planifiées (relances fournisseur, suivi, avis, rapport)
  emails.js          e-mails transactionnels
  admin.js           tableau de bord /admin
  suppliers/         connecteurs fournisseur : cj, email, mock
views/               pages HTML (vente, merci, suivi, avis, pages légales)
public/              CSS, JS, illustrations
test/                tests de bout en bout (node --test)
```

Pour changer de produit, modifiez `PRODUCT` dans `src/config.js`, puis les textes de `views/index.html` et les visuels.
