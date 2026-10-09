// Tests de bout en bout : paiement Stripe (webhooks signés), transmission
// fournisseur, suivi, relances, avis et admin.

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.ADMIN_PASSWORD = 'secret';
process.env.BASE_URL = 'http://shop.test';
process.env.WELCOME_CODE = 'BIENVENUE10';

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { openDb } = require('../src/db');
const { createMailer } = require('../src/emails');
const { createApp } = require('../src/app');
const { runJobs } = require('../src/jobs');
const orders = require('../src/orders');
const { interpolate } = require('../src/views');

function fakeSupplier() {
  const s = {
    name: 'fake',
    failNext: 0,
    created: [],
    status: null,
    async createOrder(order) {
      if (s.failNext > 0) {
        s.failNext--;
        throw new Error('API fournisseur indisponible');
      }
      s.created.push(order.number);
      return { supplierOrderId: `SUP-${order.number}` };
    },
    async getStatus() {
      return s.status;
    },
  };
  return s;
}

function setup() {
  const db = openDb(':memory:');
  const stripe = new Stripe('sk_test_dummy');
  const sessions = [];
  stripe.checkout.sessions.create = async (params) => {
    const session = { id: `cs_test_${sessions.length + 1}`, url: `https://checkout.stripe.test/${sessions.length + 1}`, params };
    sessions.push(session);
    return session;
  };
  const ctx = { db, stripe, supplier: fakeSupplier(), mailer: createMailer(db, { silent: true }) };
  return { ctx, sessions };
}

let server;
let base;
let ctx;
let sessions;

async function startServer() {
  ({ ctx, sessions } = setup());
  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
}

let eventCounter = 0;
async function sendEvent(type, object, { id, secret = process.env.STRIPE_WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify({ id: id || `evt_${++eventCounter}`, type, data: { object } });
  const header = ctx.stripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${base}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload,
  });
}

async function checkout(body) {
  const res = await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function paidSession(sessionId, orderId, extra = {}) {
  return {
    id: sessionId,
    object: 'checkout.session',
    payment_status: 'paid',
    amount_total: 5990,
    payment_intent: `pi_${sessionId}`,
    metadata: { order_id: String(orderId) },
    customer_details: { email: 'lea@example.com', name: 'Léa Martin', phone: '+33611223344' },
    collected_information: {
      shipping_details: { name: 'Léa Martin', address: { line1: '3 rue des Lilas', city: 'Lyon', postal_code: '69003', country: 'FR' } },
    },
    ...extra,
  };
}

function emailsOf(kind) {
  return ctx.db.prepare('SELECT * FROM emails WHERE kind = ?').all(kind);
}

describe('panier', () => {
  test('valide offre et couleurs, regroupe par couleur', () => {
    const cart = orders.buildCart({ offer: 'trio', variants: ['noir', 'gris', 'noir'] });
    assert.equal(cart.offer.price, 7990);
    assert.deepEqual(cart.items, [
      { variant: 'noir', qty: 2 },
      { variant: 'gris', qty: 1 },
    ]);
    assert.throws(() => orders.buildCart({ offer: 'duo', variants: ['noir'] }), orders.ValidationError);
    assert.throws(() => orders.buildCart({ offer: 'duo', variants: ['noir', 'rose'] }), orders.ValidationError);
    assert.throws(() => orders.buildCart({ offer: 'gratuit', variants: [] }), orders.ValidationError);
  });

  test('le gabarit ne ré-interprète pas le contenu inséré', () => {
    const out = interpolate('<p>{{name}}</p>{{{raw}}}', { name: '<b>{{secret}}</b>', raw: '{{name}}', secret: 'X' });
    assert.equal(out, '<p>&lt;b&gt;{{secret}}&lt;/b&gt;</p>{{name}}');
  });
});

describe('parcours de commande automatisé', () => {
  before(startServer);
  after(() => server.close());

  test('paiement → confirmation → fournisseur → suivi → livraison → avis', async () => {
    const res = await checkout({ offer: 'duo', variants: ['noir', 'bleu'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.test/1');

    const session = sessions[0];
    // Le prix vient du serveur, jamais du navigateur.
    assert.equal(session.params.line_items[0].price_data.unit_amount, 5990);
    assert.equal(session.params.metadata.order_id, '1');

    const hook = await sendEvent('checkout.session.completed', paidSession(session.id, 1));
    assert.equal(hook.status, 200);

    let order = orders.getOrder(ctx.db, 1);
    assert.equal(order.status, 'sent_to_supplier');
    assert.equal(order.supplier_order_id, `SUP-${order.number}`);
    assert.equal(order.email, 'lea@example.com');
    assert.equal(JSON.parse(order.shipping_address).city, 'Lyon');
    assert.equal(emailsOf('order_confirmation').length, 1);

    // Événement rejoué par Stripe : aucun doublon.
    const replay = await sendEvent('checkout.session.completed', paidSession(session.id, 1), { id: 'evt_1' });
    assert.equal((await replay.json()).result, 'duplicate');
    assert.equal(ctx.supplier.created.length, 1);
    assert.equal(emailsOf('order_confirmation').length, 1);

    // Le fournisseur expédie → e-mail de suivi automatique.
    ctx.supplier.status = { trackingNumber: 'LX123456789CN', carrier: 'La Poste' };
    await runJobs(ctx);
    order = orders.getOrder(ctx.db, 1);
    assert.equal(order.status, 'shipped');
    assert.equal(order.tracking_number, 'LX123456789CN');
    assert.equal(emailsOf('shipping').length, 1);

    // Pas de second e-mail si le suivi ne change pas ; livraison détectée.
    ctx.supplier.status = { trackingNumber: 'LX123456789CN', delivered: true };
    await runJobs(ctx);
    order = orders.getOrder(ctx.db, 1);
    assert.equal(order.status, 'delivered');
    assert.equal(emailsOf('shipping').length, 1);

    // Demande d'avis quelques jours après la livraison.
    ctx.db.prepare("UPDATE orders SET delivered_at = datetime('now', '-5 days') WHERE id = 1").run();
    await runJobs(ctx);
    assert.equal(emailsOf('review_request').length, 1);
    await runJobs(ctx);
    assert.equal(emailsOf('review_request').length, 1);

    // Le client laisse un avis vérifié, publié automatiquement.
    const form = new URLSearchParams({ rating: '5', name: 'Léa', title: 'Top', body: 'Je dors enfin avec mes podcasts.' });
    const reviewRes = await fetch(`${base}/avis/${order.review_token}`, { method: 'POST', body: form });
    assert.equal(reviewRes.status, 200);
    const reviews = await (await fetch(`${base}/api/reviews`)).json();
    assert.equal(reviews.count, 1);
    assert.equal(reviews.average, 5);

    // Page de suivi client.
    const track = await (await fetch(`${base}/suivi?commande=${order.number}&email=LEA@example.com`)).text();
    assert.match(track, /LX123456789CN/);
    const wrong = await (await fetch(`${base}/suivi?commande=${order.number}&email=autre@example.com`)).text();
    assert.doesNotMatch(wrong, /LX123456789CN/);
  });

  test('signature de webhook invalide refusée', async () => {
    const res = await sendEvent('checkout.session.completed', paidSession('cs_x', 1), { secret: 'whsec_mauvais' });
    assert.equal(res.status, 400);
  });

  test('panier invalide refusé', async () => {
    const res = await checkout({ offer: 'trio', variants: ['noir'] });
    assert.equal(res.status, 400);
  });
});

describe('résilience et relances', () => {
  beforeEach(startServer);
  afterEach(() => server.close());

  test('échec fournisseur → alerte admin puis nouvel essai automatique', async () => {
    await checkout({ offer: 'solo', variants: ['gris'] });
    ctx.supplier.failNext = 1;
    await sendEvent('checkout.session.completed', paidSession(sessions[0].id, 1, { amount_total: 3490 }));
    let order = orders.getOrder(ctx.db, 1);
    assert.equal(order.status, 'fulfillment_error');
    assert.match(order.last_error, /indisponible/);
    assert.equal(emailsOf('admin_alert').length, 1);

    await runJobs(ctx);
    order = orders.getOrder(ctx.db, 1);
    assert.equal(order.status, 'sent_to_supplier');
    assert.equal(order.fulfillment_attempts, 2);
    assert.equal(emailsOf('order_confirmation').length, 1);
  });

  test('panier abandonné : relance seulement avec consentement', async () => {
    await checkout({ offer: 'solo', variants: ['noir'] });
    await checkout({ offer: 'duo', variants: ['noir', 'noir'] });
    const expired = (id, orderId, consent) => ({
      id,
      object: 'checkout.session',
      metadata: { order_id: String(orderId) },
      customer_details: { email: `client${orderId}@example.com` },
      consent: consent ? { promotions: 'opt_in' } : null,
      after_expiration: { recovery: { url: `https://checkout.stripe.test/recover/${orderId}` } },
    });
    await sendEvent('checkout.session.expired', expired(sessions[0].id, 1, false));
    await sendEvent('checkout.session.expired', expired(sessions[1].id, 2, true));
    assert.equal(orders.getOrder(ctx.db, 1).status, 'abandoned');
    assert.equal(orders.getOrder(ctx.db, 2).status, 'abandoned');
    const sent = emailsOf('abandoned_cart');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to_addr, 'client2@example.com');

    // Le client revient et paie via le lien de récupération (nouvelle session, même commande).
    await sendEvent('checkout.session.completed', paidSession('cs_recovered', 2));
    assert.equal(orders.getOrder(ctx.db, 2).status, 'sent_to_supplier');
  });

  test('remboursement Stripe → commande marquée remboursée', async () => {
    await checkout({ offer: 'solo', variants: ['noir'] });
    await sendEvent('checkout.session.completed', paidSession(sessions[0].id, 1));
    await sendEvent('charge.refunded', { id: 'ch_1', refunded: true, payment_intent: `pi_${sessions[0].id}` });
    assert.equal(orders.getOrder(ctx.db, 1).status, 'refunded');
  });

  test('inscription e-mail : consentement obligatoire, code envoyé une fois, désinscription', async () => {
    const post = (body) =>
      fetch(`${base}/api/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ email: 'tom@example.com' })).status, 400);
    assert.equal((await post({ email: 'pas-un-email', consent: true })).status, 400);
    assert.equal((await post({ email: 'Tom@Example.com', consent: true })).status, 200);
    assert.equal((await post({ email: 'tom@example.com', consent: true })).status, 200);
    const welcome = emailsOf('welcome');
    assert.equal(welcome.length, 1);
    assert.match(welcome[0].subject, /BIENVENUE10/);
    const { token } = ctx.db.prepare('SELECT token FROM subscribers WHERE email = ?').get('tom@example.com');
    const page = await (await fetch(`${base}/desinscription/${token}`)).text();
    assert.match(page, /désinscrit/);
    assert.ok(ctx.db.prepare('SELECT unsubscribed_at FROM subscribers WHERE token = ?').get(token).unsubscribed_at);
  });

  test('admin protégé par mot de passe et contre le CSRF', async () => {
    const auth = `Basic ${Buffer.from('admin:secret').toString('base64')}`;
    assert.equal((await fetch(`${base}/admin`)).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: { Authorization: `Basic ${Buffer.from('admin:faux').toString('base64')}` } })).status, 401);
    assert.equal((await fetch(`${base}/admin`, { headers: { Authorization: auth } })).status, 200);
    const csrf = await fetch(`${base}/admin/taches`, { method: 'POST', headers: { Authorization: auth, Origin: 'https://evil.example' }, redirect: 'manual' });
    assert.equal(csrf.status, 403);
    const ok = await fetch(`${base}/admin/taches`, { method: 'POST', headers: { Authorization: auth, Origin: base }, redirect: 'manual' });
    assert.equal(ok.status, 303);
  });
});

describe('sauvegardes', () => {
  test('sauvegarde quotidienne avec rotation sur 7 jours', () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const { backupDatabase } = require('../src/jobs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
    const db = openDb(':memory:');
    for (let d = 1; d <= 9; d++) {
      assert.equal(backupDatabase({ db, backupDir: dir }, new Date(`2026-10-${String(d).padStart(2, '0')}T08:00:00Z`)), true);
    }
    assert.equal(backupDatabase({ db, backupDir: dir }, new Date('2026-10-09T20:00:00Z')), false);
    const files = fs.readdirSync(dir).sort();
    assert.equal(files.length, 7);
    assert.equal(files[0], 'shop-2026-10-03.db');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
