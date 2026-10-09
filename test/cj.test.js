process.env.SUPPLIER_VID_NOIR = 'VID-NOIR';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createCjSupplier } = require('../src/suppliers/cj');

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    const path = Object.keys(routes).find((p) => url.includes(p));
    return { ok: true, status: 200, json: async () => ({ code: 200, result: true, data: routes[path] }) };
  };
  fn.calls = calls;
  return fn;
}

const order = {
  id: 1,
  number: 'DOR-TEST01',
  items: JSON.stringify([{ variant: 'noir', qty: 2 }]),
  customer_name: 'Léa Martin',
  email: 'lea@example.com',
  phone: '+33611223344',
  shipping_address: JSON.stringify({ line1: '3 rue des Lilas', city: 'Lyon', postal_code: '69003', country: 'FR' }),
  supplier_order_id: 'CJ123',
};

test('CJ : commande transmise avec le bon mapping et jeton mis en cache', async () => {
  const db = openDb(':memory:');
  const fetch = fakeFetch({
    getAccessToken: { accessToken: 'tok', accessTokenExpiryDate: new Date(Date.now() + 10 * 86400e3).toISOString() },
    createOrderV2: { orderId: 'CJ123' },
    getOrderDetail: { trackNumber: 'YT123', logisticName: 'YunExpress', orderStatus: 'SHIPPED' },
  });
  const cj = createCjSupplier({ db, apiKey: 'key', fetch });

  const { supplierOrderId } = await cj.createOrder(order);
  assert.equal(supplierOrderId, 'CJ123');
  const create = fetch.calls.find((c) => c.url.includes('createOrderV2'));
  assert.equal(create.init.headers['CJ-Access-Token'], 'tok');
  assert.equal(create.body.orderNumber, 'DOR-TEST01');
  assert.equal(create.body.shippingCountryCode, 'FR');
  assert.deepEqual(create.body.products, [{ vid: 'VID-NOIR', quantity: 2 }]);

  const status = await cj.getStatus(order);
  assert.deepEqual(status, { trackingNumber: 'YT123', carrier: 'YunExpress', delivered: false, cancelled: false });

  // Un seul appel d'authentification, même après redémarrage (cache en base).
  const cj2 = createCjSupplier({ db, apiKey: 'key', fetch });
  await cj2.getStatus(order);
  assert.equal(fetch.calls.filter((c) => c.url.includes('getAccessToken')).length, 1);
});

test('CJ : identifiant de variante manquant → erreur explicite', async () => {
  const cj = createCjSupplier({ apiKey: 'key', fetch: fakeFetch({}) });
  const bad = { ...order, items: JSON.stringify([{ variant: 'gris', qty: 1 }]) };
  await assert.rejects(cj.createOrder(bad), /SUPPLIER_VID_GRIS/);
});

test('fournisseurs sans identifiants : le site démarre, la commande échoue avec un message clair', async () => {
  const { createEmailSupplier } = require('../src/suppliers/email');
  const email = createEmailSupplier({ email: '' });
  await assert.rejects(email.createOrder(order), /SUPPLIER_EMAIL manquant/);
  const cj = createCjSupplier({ apiKey: '', fetch: fakeFetch({}) });
  await assert.rejects(cj.createOrder(order), /CJ_API_KEY manquant/);
});
