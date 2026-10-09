const path = require('node:path');
const express = require('express');
const { config, SHOP, PRODUCT, findOffer, findVariant } = require('./config');
const orders = require('./orders');
const { createCheckoutSession, handleStripeEvent } = require('./stripe');
const { render } = require('./views');
const { escapeHtml, formatPrice, trackingUrl } = require('./emails');
const { createAdminRouter } = require('./admin');

// Limiteur de débit minimaliste en mémoire (par IP et par route).
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const t = Date.now();
    const entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10000) hits.clear();
      return next();
    }
    if (++entry.count > max) return res.status(429).json({ error: 'Trop de requêtes, réessayez dans un instant.' });
    next();
  };
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function productJsonLd(reviewSummary) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: PRODUCT.name,
    description: PRODUCT.description,
    image: [`${SHOP.baseUrl}/img/product-card.png`],
    brand: { '@type': 'Brand', name: SHOP.name },
    sku: PRODUCT.id,
    offers: {
      '@type': 'Offer',
      url: SHOP.baseUrl,
      priceCurrency: 'EUR',
      price: (PRODUCT.offers[0].price / 100).toFixed(2),
      availability: 'https://schema.org/InStock',
      itemCondition: 'https://schema.org/NewCondition',
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: '0', currency: 'EUR' },
        shippingDestination: SHOP.shippingCountries.map((c) => ({ '@type': 'DefinedRegion', addressCountry: c })),
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          transitTime: { '@type': 'QuantitativeValue', minValue: SHOP.shippingDaysMin, maxValue: SHOP.shippingDaysMax, unitCode: 'DAY' },
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: SHOP.shippingCountries,
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: SHOP.returnDays,
      },
    },
  };
  if (reviewSummary.count > 0) {
    data.aggregateRating = { '@type': 'AggregateRating', ratingValue: reviewSummary.average, reviewCount: reviewSummary.count };
  }
  return safeJson(data);
}

const LEGAL_PAGES = {
  'mentions-legales': 'Mentions légales',
  cgv: 'Conditions générales de vente',
  confidentialite: 'Politique de confidentialité',
  'livraison-retours': 'Livraison, retours et remboursements',
};

function createApp(ctx) {
  const { db, stripe } = ctx;
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // Le webhook Stripe a besoin du corps brut pour vérifier la signature : il passe avant express.json().
  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!stripe || !config.stripe.webhookSecret) return res.status(503).send('Stripe non configuré');
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripe.webhookSecret);
    } catch (err) {
      return res.status(400).send(`Signature invalide : ${err.message}`);
    }
    try {
      const result = await handleStripeEvent(ctx, event);
      res.json({ received: true, result });
    } catch (err) {
      console.error('[stripe] erreur de traitement', event.type, err);
      res.status(500).send('Erreur de traitement');
    }
  });

  app.use(express.json({ limit: '20kb' }));
  app.use(express.urlencoded({ extended: false, limit: '20kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.env === 'production' ? '7d' : 0 }));

  app.get('/', (req, res) => {
    const reviewSummary = orders.publicReviews(db, 0);
    const shopData = {
      offers: PRODUCT.offers,
      variants: PRODUCT.variants.map(({ id, label, hex }) => ({ id, label, hex })),
      reviews: { count: reviewSummary.count, average: reviewSummary.average },
    };
    res.send(render('index', { jsonLd: productJsonLd(reviewSummary), shopData: safeJson(shopData) }));
  });

  app.get('/api/reviews', (req, res) => res.json(orders.publicReviews(db)));

  app.post('/api/checkout', rateLimit({ windowMs: 60e3, max: 10 }), async (req, res) => {
    let cart;
    try {
      cart = orders.buildCart(req.body || {});
    } catch (err) {
      if (err instanceof orders.ValidationError) return res.status(400).json({ error: err.message });
      throw err;
    }
    const order = orders.createPendingOrder(db, cart);
    if (!stripe) {
      if (config.env === 'production') return res.status(503).json({ error: 'Paiement indisponible.' });
      return res.json({ url: `/demo-paiement?commande=${encodeURIComponent(order.number)}` });
    }
    try {
      const session = await createCheckoutSession(stripe, order, cart);
      orders.update(db, order.id, { stripe_session_id: session.id });
      res.json({ url: session.url });
    } catch (err) {
      console.error('[stripe] création de session', err.message);
      res.status(502).json({ error: 'Le paiement est momentanément indisponible, réessayez dans un instant.' });
    }
  });

  // Mode démo (sans clé Stripe, hors production) : simule un paiement réussi.
  app.get('/demo-paiement', async (req, res) => {
    if (stripe || config.env === 'production') return res.redirect('/');
    const order = orders.getOrderBy(db, 'number', String(req.query.commande || ''));
    if (!order) return res.redirect('/');
    await orders.handlePaidSession(ctx, {
      id: `demo_${order.number}`,
      metadata: { order_id: String(order.id) },
      amount_total: order.amount_total,
      payment_intent: `demo_pi_${order.number}`,
      customer_details: { email: 'client.demo@example.com', name: 'Camille Démo', phone: '+33600000000' },
      shipping_details: {
        name: 'Camille Démo',
        address: { line1: '1 rue de la Paix', postal_code: '75002', city: 'Paris', country: 'FR' },
      },
    });
    res.redirect(`/merci?session_id=demo_${encodeURIComponent(order.number)}`);
  });

  app.get('/merci', rateLimit({ windowMs: 60e3, max: 30 }), async (req, res) => {
    const sessionId = String(req.query.session_id || '');
    let order = sessionId ? orders.getOrderBy(db, 'stripe_session_id', sessionId) : null;
    // Si le webhook n'est pas encore arrivé (ou session issue d'un lien de relance),
    // on vérifie directement auprès de Stripe.
    if (stripe && sessionId.startsWith('cs_') && (!order || ['pending', 'abandoned'].includes(order.status))) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') order = await orders.handlePaidSession(ctx, session);
      } catch (err) {
        console.error('[merci] vérification Stripe', err.message);
      }
    }
    if (!order) return res.redirect('/');
    const purchase = order.paid_at
      ? safeJson({ value: order.amount_total / 100, currency: 'EUR', transaction_id: order.number, quantity: findOffer(order.offer_id)?.qty || 1 })
      : 'null';
    res.send(
      render('merci', {
        title: `Merci pour votre commande — ${SHOP.name}`,
        order,
        total: formatPrice(order.amount_total),
        firstName: (order.customer_name || '').split(' ')[0],
        purchase,
      })
    );
  });

  app.get('/suivi', rateLimit({ windowMs: 60e3, max: 20 }), (req, res) => {
    const number = String(req.query.commande || '').trim().toUpperCase();
    const email = String(req.query.email || '').trim().toLowerCase();
    let result = '';
    if (number && email) {
      const order = orders.getOrderBy(db, 'number', number);
      if (!order || (order.email || '').toLowerCase() !== email || order.status === 'pending' || order.status === 'abandoned') {
        result = '<p class="notice notice-error">Aucune commande ne correspond à ce numéro et cet e-mail.</p>';
      } else {
        result = trackingResultHtml(order);
      }
    }
    res.send(render('suivi', { title: `Suivre ma commande — ${SHOP.name}`, number, email, result }));
  });

  app.get('/avis/:token', (req, res) => {
    const order = orders.getOrderBy(db, 'review_token', req.params.token);
    if (!order) return res.status(404).send(render('message', { title: 'Lien invalide', heading: 'Lien invalide', message: 'Ce lien d\'avis est invalide ou a expiré.' }));
    res.send(render('avis', { title: `Votre avis — ${SHOP.name}`, token: req.params.token, firstName: (order.customer_name || '').split(' ')[0], error: '' }));
  });

  app.post('/avis/:token', rateLimit({ windowMs: 60e3, max: 5 }), async (req, res) => {
    const order = orders.getOrderBy(db, 'review_token', req.params.token);
    if (!order) return res.status(404).send(render('message', { title: 'Lien invalide', heading: 'Lien invalide', message: 'Ce lien d\'avis est invalide ou a expiré.' }));
    try {
      await orders.submitReview(ctx, order, req.body);
    } catch (err) {
      if (!(err instanceof orders.ValidationError)) throw err;
      return res.status(400).send(render('avis', { title: `Votre avis — ${SHOP.name}`, token: req.params.token, firstName: req.body.name || '', error: `<p class="notice notice-error">${escapeHtml(err.message)}</p>` }));
    }
    res.send(render('message', { title: 'Merci !', heading: 'Merci pour votre avis 💜', message: 'Il aide d\'autres personnes à mieux dormir. Belle nuit !' }));
  });

  for (const [slug, title] of Object.entries(LEGAL_PAGES)) {
    app.get(`/${slug}`, (req, res) => res.send(render(slug, { title: `${title} — ${SHOP.name}`, heading: title })));
  }

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /avis/\nDisallow: /merci\nSitemap: ${SHOP.baseUrl}/sitemap.xml\n`);
  });

  app.get('/sitemap.xml', (req, res) => {
    const urls = ['/', ...Object.keys(LEGAL_PAGES).map((s) => `/${s}`), '/suivi'];
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
        .map((u) => `  <url><loc>${SHOP.baseUrl}${u}</loc></url>`)
        .join('\n')}\n</urlset>\n`
    );
  });

  // Flux produits Google Merchant Center (fiches gratuites + Google Shopping).
  app.get('/feed.xml', (req, res) => {
    const items = PRODUCT.variants
      .map(
        (v) => `  <item>
    <g:id>${escapeHtml(`${PRODUCT.id}-${v.id}`)}</g:id>
    <g:item_group_id>${escapeHtml(PRODUCT.id)}</g:item_group_id>
    <g:title>${escapeHtml(`${PRODUCT.name} — ${v.label}`)}</g:title>
    <g:description>${escapeHtml(PRODUCT.description)}</g:description>
    <g:link>${escapeHtml(SHOP.baseUrl)}/?couleur=${v.id}</g:link>
    <g:image_link>${escapeHtml(SHOP.baseUrl)}/img/product-card.png</g:image_link>
    <g:availability>in_stock</g:availability>
    <g:condition>new</g:condition>
    <g:price>${(PRODUCT.offers[0].price / 100).toFixed(2)} EUR</g:price>
    <g:brand>${escapeHtml(SHOP.name)}</g:brand>
    <g:color>${escapeHtml(v.label)}</g:color>
    <g:identifier_exists>no</g:identifier_exists>
    <g:google_product_category>543626</g:google_product_category>
    <g:shipping><g:country>FR</g:country><g:price>0.00 EUR</g:price></g:shipping>
  </item>`
      )
      .join('\n');
    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n  <title>${escapeHtml(SHOP.name)}</title>\n  <link>${escapeHtml(SHOP.baseUrl)}</link>\n  <description>${escapeHtml(PRODUCT.tagline)}</description>\n${items}\n</channel>\n</rss>\n`
    );
  });

  app.get('/analytics-config.js', (req, res) => {
    res.type('application/javascript').send(`window.ANALYTICS = ${safeJson(config.analytics)};`);
  });

  app.use('/admin', createAdminRouter(ctx));

  app.use((req, res) => {
    res.status(404).send(render('message', { title: 'Page introuvable', heading: 'Page introuvable', message: 'Cette page n\'existe pas (ou plus).' }));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[app] erreur', err);
    res.status(500).send(render('message', { title: 'Erreur', heading: 'Oups', message: 'Une erreur est survenue. Réessayez dans un instant.' }));
  });

  return app;
}

function trackingResultHtml(order) {
  // Le client ne voit pas les états internes (erreur fournisseur, transmission…).
  const customerStatus = ['paid', 'fulfilling', 'fulfillment_error'].includes(order.status)
    ? 'En préparation'
    : orders.STATUS_LABELS[order.status] || order.status;
  const steps = [
    ['paid', 'Commande confirmée', order.paid_at],
    ['sent_to_supplier', 'En préparation', order.sent_to_supplier_at],
    ['shipped', 'Expédiée', order.shipped_at],
    ['delivered', 'Livrée', order.delivered_at],
  ];
  const items = JSON.parse(order.items)
    .map((i) => `${i.qty} × ${escapeHtml(findVariant(i.variant)?.label || i.variant)}`)
    .join(', ');
  const timeline = steps
    .map(([, label, date]) => `<li class="${date ? 'done' : ''}"><span>${label}</span>${date ? `<small>${escapeHtml(date.slice(0, 10).split('-').reverse().join('/'))}</small>` : ''}</li>`)
    .join('');
  const tracking = order.tracking_number
    ? `<p>Numéro de suivi : <strong>${escapeHtml(order.tracking_number)}</strong> — <a href="${escapeHtml(trackingUrl(order.tracking_number))}" target="_blank" rel="noopener">suivre le colis</a></p>`
    : '<p>Votre numéro de suivi vous sera envoyé par e-mail dès l\'expédition.</p>';
  return `<div class="card track-result">
<h2>Commande ${escapeHtml(order.number)} — ${escapeHtml(customerStatus)}</h2>
<p>${items}</p>
<ol class="timeline">${timeline}</ol>
${tracking}
</div>`;
}

module.exports = { createApp };
