const Stripe = require('stripe');
const { config, SHOP, PRODUCT, findVariant } = require('./config');
const orders = require('./orders');

function createStripe(secretKey = config.stripe.secretKey) {
  if (!secretKey) return null;
  return new Stripe(secretKey);
}

async function createCheckoutSession(stripe, order, { offer, items }) {
  const colors = items.map((i) => `${i.qty} × ${findVariant(i.variant).label}`).join(', ');
  return stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'fr',
    client_reference_id: String(order.id),
    metadata: { order_id: String(order.id), order_number: order.number },
    payment_intent_data: { metadata: { order_id: String(order.id), order_number: order.number } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: offer.price,
          product_data: {
            name: `${PRODUCT.name} — ${offer.label}`,
            description: colors,
            images: [`${SHOP.baseUrl}/img/product-card.png`],
          },
        },
      },
    ],
    shipping_address_collection: { allowed_countries: SHOP.shippingCountries },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: 'Livraison suivie offerte',
          fixed_amount: { amount: 0, currency: 'eur' },
          delivery_estimate: {
            minimum: { unit: 'business_day', value: SHOP.shippingDaysMin },
            maximum: { unit: 'business_day', value: SHOP.shippingDaysMax },
          },
        },
      },
    ],
    phone_number_collection: { enabled: true },
    allow_promotion_codes: true,
    // Case à cocher marketing + lien de récupération pour les relances panier abandonné.
    consent_collection: { promotions: 'auto' },
    after_expiration: { recovery: { enabled: true, allow_promotion_codes: true } },
    expires_at: Math.floor(Date.now() / 1000) + config.stripe.sessionMinutes * 60,
    success_url: `${SHOP.baseUrl}/merci?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SHOP.baseUrl}/#commander`,
  });
}

// Traite un événement Stripe déjà vérifié. Idempotent : un événement rejoué est ignoré.
async function handleStripeEvent(ctx, event) {
  const { db } = ctx;
  const seen = db.prepare('INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)').run(event.id, event.type);
  if (seen.changes === 0) return 'duplicate';
  try {
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed':
        if (obj.payment_status === 'paid') await orders.handlePaidSession(ctx, obj);
        break;
      case 'checkout.session.async_payment_succeeded':
        await orders.handlePaidSession(ctx, obj);
        break;
      case 'checkout.session.expired':
        await orders.handleExpiredSession(ctx, obj);
        break;
      case 'charge.refunded':
        if (obj.refunded && obj.payment_intent) {
          const order = orders.markRefunded(db, typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent.id);
          if (order) await ctx.mailer.alertAdmin(order, 'Commande remboursée', 'Pensez à annuler chez le fournisseur si elle n\'est pas encore expédiée.');
        }
        break;
      default:
        break;
    }
    return 'processed';
  } catch (err) {
    // On oublie l'événement pour que Stripe puisse le renvoyer.
    db.prepare('DELETE FROM stripe_events WHERE id = ?').run(event.id);
    throw err;
  }
}

module.exports = { createStripe, createCheckoutSession, handleStripeEvent };
