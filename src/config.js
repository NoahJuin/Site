// Configuration centrale : boutique, produit, offres et variables d'environnement.
// Les prix sont en centimes pour éviter toute erreur d'arrondi.

const env = process.env;

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const SHOP = {
  name: env.SHOP_NAME || 'Dormea',
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  supportEmail: env.SUPPORT_EMAIL || 'contact@dormea.fr',
  adminEmail: env.ADMIN_EMAIL || env.SUPPORT_EMAIL || 'contact@dormea.fr',
  // Informations légales obligatoires (mentions légales / CGV).
  companyName: env.COMPANY_NAME || '[Raison sociale]',
  companyAddress: env.COMPANY_ADDRESS || '[Adresse du siège]',
  companySiret: env.COMPANY_SIRET || '[SIRET]',
  companyVat: env.COMPANY_VAT || '[TVA intracommunautaire ou « TVA non applicable, art. 293 B du CGI »]',
  publisherName: env.PUBLISHER_NAME || '[Directeur de la publication]',
  hostName: env.HOST_NAME || '[Hébergeur — nom, adresse, téléphone]',
  mediator: env.MEDIATOR || '[Médiateur de la consommation — nom et site web]',
  shippingCountries: (env.SHIPPING_COUNTRIES || 'FR,BE,LU,MC').split(',').map((c) => c.trim()).filter(Boolean),
  shippingDaysMin: Number(env.SHIPPING_DAYS_MIN || 6),
  shippingDaysMax: Number(env.SHIPPING_DAYS_MAX || 10),
  returnDays: 30,
};

const PRODUCT = {
  id: 'dormea-bandeau-bluetooth',
  name: 'Bandeau de sommeil Bluetooth Dormea',
  shortName: 'Bandeau Dormea',
  tagline: 'Votre musique, sans écouteurs qui font mal.',
  description:
    'Bandeau occultant ultra-doux avec écouteurs Bluetooth extra-plats intégrés. ' +
    'Écoutez musique, podcasts ou bruit blanc pour vous endormir, même allongé sur le côté.',
  // Coût d'achat fournisseur estimé par unité (sert au calcul de marge dans l'admin).
  unitCost: Number(env.UNIT_COST_CENTS || 950),
  variants: [
    { id: 'noir', label: 'Noir minuit', hex: '#1d1f2b', supplierVid: env.SUPPLIER_VID_NOIR || '' },
    { id: 'gris', label: 'Gris perle', hex: '#9aa0ad', supplierVid: env.SUPPLIER_VID_GRIS || '' },
    { id: 'bleu', label: 'Bleu nuit', hex: '#28366b', supplierVid: env.SUPPLIER_VID_BLEU || '' },
  ],
  offers: [
    { id: 'solo', qty: 1, price: 3490, label: '1 bandeau', note: 'Pour essayer' },
    { id: 'duo', qty: 2, price: 5990, label: '2 bandeaux', note: 'Vous + votre moitié', badge: 'Le plus choisi' },
    { id: 'trio', qty: 3, price: 7990, label: '3 bandeaux', note: 'Idéal à offrir', badge: 'Meilleur prix' },
  ],
};

function findOffer(id) {
  return PRODUCT.offers.find((o) => o.id === id);
}

function findVariant(id) {
  return PRODUCT.variants.find((v) => v.id === id);
}

const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 3000),
  databasePath: env.DATABASE_PATH || 'data/shop.db',
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || '',
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
    // Durée de vie d'une session de paiement avant relance panier abandonné (min. 30 min chez Stripe).
    sessionMinutes: Math.max(30, Number(env.CHECKOUT_SESSION_MINUTES || 60)),
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || `${SHOP.name} <${SHOP.supportEmail}>`,
  },
  supplier: {
    // mock | email | cj
    provider: env.SUPPLIER_PROVIDER || 'mock',
    email: env.SUPPLIER_EMAIL || '',
    cjApiKey: env.CJ_API_KEY || '',
    cjBaseUrl: env.CJ_BASE_URL || 'https://developers.cjdropshipping.com/api2.0/v1',
    cjLogistic: env.CJ_LOGISTIC_NAME || 'CJPacket Ordinary',
    cjFromCountry: env.CJ_FROM_COUNTRY || 'CN',
  },
  jobs: {
    enabled: bool(env.ENABLE_SCHEDULER, true),
    intervalMinutes: Number(env.JOBS_INTERVAL_MINUTES || 30),
    maxFulfillmentAttempts: Number(env.MAX_FULFILLMENT_ATTEMPTS || 5),
    reviewRequestDaysAfterShipping: Number(env.REVIEW_REQUEST_DAYS || 14),
    dailyReportHour: Number(env.DAILY_REPORT_HOUR || 8),
  },
  reviews: {
    // Les avis d'acheteurs vérifiés sont publiés automatiquement, positifs comme négatifs.
    autoApprove: bool(env.AUTO_APPROVE_REVIEWS, true),
  },
  analytics: {
    metaPixelId: env.META_PIXEL_ID || '',
    tiktokPixelId: env.TIKTOK_PIXEL_ID || '',
    ga4Id: env.GA4_ID || '',
  },
};

module.exports = { config, SHOP, PRODUCT, findOffer, findVariant, bool };
