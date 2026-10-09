// Cycle de vie d'une commande :
// pending → paid → fulfilling → sent_to_supplier → shipped → delivered
// (+ abandoned, fulfillment_error, refunded)

const crypto = require('node:crypto');
const { config, PRODUCT, findOffer, findVariant } = require('./config');

const STATUS_LABELS = {
  pending: 'En attente de paiement',
  paid: 'Payée',
  fulfilling: 'Transmission au fournisseur',
  sent_to_supplier: 'En préparation',
  fulfillment_error: 'Erreur fournisseur',
  shipped: 'Expédiée',
  delivered: 'Livrée',
  abandoned: 'Panier abandonné',
  refunded: 'Remboursée',
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

class ValidationError extends Error {}

// Valide le panier (offre + une couleur par unité) et regroupe par couleur.
function buildCart({ offer: offerId, variants }) {
  const offer = findOffer(offerId);
  if (!offer) throw new ValidationError('Offre inconnue');
  if (!Array.isArray(variants) || variants.length !== offer.qty) {
    throw new ValidationError(`Choisissez ${offer.qty} couleur(s)`);
  }
  const counts = new Map();
  for (const id of variants) {
    if (!findVariant(id)) throw new ValidationError(`Couleur inconnue : ${id}`);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const items = [...counts].map(([variant, qty]) => ({ variant, qty }));
  return { offer, items };
}

function createPendingOrder(db, cart) {
  const { offer, items } = cart;
  const number = `${PRODUCT.id.slice(0, 3).toUpperCase()}-${randomCode(6)}`;
  const info = db
    .prepare('INSERT INTO orders (number, offer_id, items, amount_total) VALUES (?, ?, ?, ?)')
    .run(number, offer.id, JSON.stringify(items), offer.price);
  return getOrder(db, Number(info.lastInsertRowid));
}

function getOrder(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function getOrderBy(db, column, value) {
  const allowed = ['number', 'stripe_session_id', 'stripe_payment_intent', 'review_token'];
  if (!allowed.includes(column)) throw new Error(`Colonne non autorisée : ${column}`);
  return db.prepare(`SELECT * FROM orders WHERE ${column} = ?`).get(value);
}

function update(db, id, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(
    ...keys.map((k) => fields[k]),
    id
  );
  return getOrder(db, id);
}

function addressFromSession(session) {
  const shipping = session.collected_information?.shipping_details || session.shipping_details;
  const addr = shipping?.address || session.customer_details?.address || {};
  return {
    name: shipping?.name || session.customer_details?.name || '',
    address: {
      line1: addr.line1 || '',
      line2: addr.line2 || '',
      postal_code: addr.postal_code || '',
      city: addr.city || '',
      state: addr.state || '',
      country: addr.country || '',
    },
  };
}

function findOrderForSession(db, session) {
  const id = Number(session.metadata?.order_id || session.client_reference_id);
  return (id && getOrder(db, id)) || getOrderBy(db, 'stripe_session_id', session.id);
}

// Appelé par le webhook Stripe quand le paiement est confirmé.
async function handlePaidSession(ctx, session) {
  const { db } = ctx;
  let order = findOrderForSession(db, session);
  if (!order) throw new Error(`Commande introuvable pour la session ${session.id}`);
  if (['pending', 'abandoned'].includes(order.status)) {
    const { name, address } = addressFromSession(session);
    order = update(db, order.id, {
      status: 'paid',
      stripe_session_id: session.id,
      stripe_payment_intent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
      amount_total: session.amount_total ?? order.amount_total,
      email: session.customer_details?.email || order.email,
      customer_name: name,
      phone: session.customer_details?.phone || null,
      shipping_address: JSON.stringify(address),
      review_token: order.review_token || randomCode(24),
      paid_at: now(),
    });
  }
  return processPaidOrder(ctx, order);
}

async function processPaidOrder(ctx, order) {
  const { db, mailer } = ctx;
  if (!order.confirmation_sent_at && order.email) {
    // On marque d'abord pour ne jamais envoyer deux confirmations (webhooks rejoués).
    order = update(db, order.id, { confirmation_sent_at: now() });
    await mailer.send('order_confirmation', order.email, order);
  }
  return fulfill(ctx, order);
}

// Transmet la commande au fournisseur. Le passage par l'état « fulfilling » est
// atomique : impossible de commander deux fois chez le fournisseur, même si le
// webhook et les tâches planifiées tournent en même temps.
async function fulfill(ctx, order) {
  const { db, supplier, mailer } = ctx;
  const claim = db
    .prepare(
      `UPDATE orders SET status = 'fulfilling', fulfillment_attempts = fulfillment_attempts + 1, updated_at = datetime('now')
       WHERE id = ? AND status IN ('paid', 'fulfillment_error') AND supplier_order_id IS NULL`
    )
    .run(order.id);
  if (claim.changes !== 1) return getOrder(db, order.id);
  order = getOrder(db, order.id);
  try {
    const { supplierOrderId } = await supplier.createOrder(order);
    return update(db, order.id, {
      status: 'sent_to_supplier',
      supplier_order_id: supplierOrderId,
      sent_to_supplier_at: now(),
      last_error: null,
    });
  } catch (err) {
    order = update(db, order.id, { status: 'fulfillment_error', last_error: String(err.message || err) });
    const max = config.jobs.maxFulfillmentAttempts;
    if (order.fulfillment_attempts === 1) {
      await mailer.alertAdmin(order, 'Erreur fournisseur', `Transmission échouée (nouvel essai automatique) : ${order.last_error}`);
    } else if (order.fulfillment_attempts >= max) {
      await mailer.alertAdmin(order, 'Action requise : commande bloquée', `Échec après ${max} tentatives : ${order.last_error}. Passez la commande manuellement puis saisissez le suivi dans l'admin.`);
    }
    return order;
  }
}

async function handleExpiredSession(ctx, session) {
  const { db, mailer } = ctx;
  let order = findOrderForSession(db, session);
  if (!order || order.status !== 'pending') return order;
  const email = session.customer_details?.email || null;
  const recoveryUrl = session.after_expiration?.recovery?.url || null;
  order = update(db, order.id, { status: 'abandoned', email: email || order.email, recovery_url: recoveryUrl });
  // RGPD : relance uniquement si le client a accepté les communications marketing.
  const consent = session.consent?.promotions === 'opt_in';
  if (order.email && recoveryUrl && consent && !order.abandoned_email_at) {
    order = update(db, order.id, { abandoned_email_at: now() });
    await mailer.send('abandoned_cart', order.email, order);
  }
  return order;
}

async function setTracking(ctx, order, { trackingNumber, carrier }) {
  const { db, mailer } = ctx;
  if (!trackingNumber) return order;
  const changed = trackingNumber !== order.tracking_number;
  order = update(db, order.id, {
    tracking_number: trackingNumber,
    carrier: carrier || order.carrier,
    status: ['delivered', 'refunded'].includes(order.status) ? order.status : 'shipped',
    shipped_at: order.shipped_at || now(),
  });
  if (changed && order.email) await mailer.send('shipping', order.email, order);
  return order;
}

function markDelivered(db, order) {
  if (order.status === 'delivered') return order;
  return update(db, order.id, { status: 'delivered', delivered_at: now() });
}

function markRefunded(db, paymentIntentId) {
  const order = getOrderBy(db, 'stripe_payment_intent', paymentIntentId);
  if (!order) return null;
  return update(db, order.id, { status: 'refunded', refunded_at: now() });
}

async function submitReview(ctx, order, { name, rating, title, body }) {
  const { db, mailer } = ctx;
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new ValidationError('Note invalide');
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanBody = String(body || '').trim().slice(0, 2000);
  if (!cleanName || cleanBody.length < 10) throw new ValidationError('Merci d\'indiquer votre prénom et au moins quelques mots.');
  const existing = db.prepare('SELECT id FROM reviews WHERE order_id = ?').get(order.id);
  if (existing) throw new ValidationError('Vous avez déjà laissé un avis pour cette commande. Merci !');
  db.prepare('INSERT INTO reviews (order_id, name, rating, title, body, approved) VALUES (?, ?, ?, ?, ?, ?)').run(
    order.id,
    cleanName,
    r,
    String(title || '').trim().slice(0, 120),
    cleanBody,
    config.reviews.autoApprove ? 1 : 0
  );
  // Avis mitigé → alerte au service client pour rattraper le client.
  if (r <= 3) await mailer.alertAdmin(order, `Avis ${r}/5 à traiter`, `${cleanName} : ${cleanBody}`);
}

function publicReviews(db, limit = 30) {
  const rows = db
    .prepare('SELECT name, rating, title, body, created_at FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT ?')
    .all(limit);
  const agg = db.prepare('SELECT COUNT(*) AS count, AVG(rating) AS avg FROM reviews WHERE approved = 1').get();
  return { count: agg.count, average: agg.avg ? Math.round(agg.avg * 10) / 10 : null, reviews: rows };
}

module.exports = {
  STATUS_LABELS,
  ValidationError,
  buildCart,
  createPendingOrder,
  getOrder,
  getOrderBy,
  update,
  handlePaidSession,
  processPaidOrder,
  fulfill,
  handleExpiredSession,
  setTracking,
  markDelivered,
  markRefunded,
  submitReview,
  publicReviews,
  now,
};
