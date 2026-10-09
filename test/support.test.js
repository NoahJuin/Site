const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createMailer } = require('../src/emails');
const orders = require('../src/orders');
const { createSupportAgent, sanitizeHistory } = require('../src/support');

// Faux client Anthropic : rejoue des réponses scriptées et enregistre les requêtes.
function scriptedClient(responses) {
  const requests = [];
  return {
    requests,
    beta: {
      messages: {
        create: async (params) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          return responses.shift();
        },
      },
    },
  };
}

function setupPaidOrder(db) {
  const order = orders.createPendingOrder(db, orders.buildCart({ offer: 'solo', variants: ['gris'] }));
  return orders.update(db, order.id, {
    status: 'shipped',
    email: 'lea@example.com',
    paid_at: '2026-10-01 10:00:00',
    shipped_at: '2026-10-02 10:00:00',
    tracking_number: 'LX999',
  });
}

test("l'assistant retrouve une commande uniquement avec le bon e-mail", async () => {
  const db = openDb(':memory:');
  const order = setupPaidOrder(db);
  const ctx = { db, mailer: createMailer(db, { silent: true }) };
  const client = scriptedClient([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'lookup_order', input: { order_number: order.number.toLowerCase(), email: 'LEA@example.com' } },
        { type: 'tool_use', id: 't2', name: 'lookup_order', input: { order_number: order.number, email: 'pirate@example.com' } },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Votre colis est expédié, suivi LX999.' }] },
  ]);
  const agent = createSupportAgent(ctx, { client });
  const out = await agent.reply([{ role: 'user', content: `Où en est ${order.number} ? lea@example.com` }]);
  assert.equal(out.reply, 'Votre colis est expédié, suivi LX999.');

  const first = client.requests[0];
  assert.equal(first.model, 'claude-opus-5-5');
  assert.equal(first.fallbacks, 'default');
  assert.deepEqual(first.betas, ['server-side-fallback-2026-07-01']);

  const results = client.requests[1].messages.at(-1).content.map((r) => JSON.parse(r.content));
  assert.equal(results[0].found, true);
  assert.equal(results[0].tracking_number, 'LX999');
  assert.equal(results[1].found, false);
  assert.equal(results[1].tracking_number, undefined);
});

test("l'assistant transmet au service client humain", async () => {
  const db = openDb(':memory:');
  const ctx = { db, mailer: createMailer(db, { silent: true }) };
  const client = scriptedClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'contact_human', input: { email: 'lea@example.com', summary: 'Bandeau qui ne charge plus' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'C’est transmis.' }] },
  ]);
  const agent = createSupportAgent(ctx, { client });
  await agent.reply([{ role: 'user', content: 'Mon bandeau ne charge plus' }]);
  const alerts = db.prepare("SELECT * FROM emails WHERE kind = 'admin_alert'").all();
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].subject, /lea@example.com/);
});

test('refus du modèle → message de repli vers le support', async () => {
  const db = openDb(':memory:');
  const client = scriptedClient([{ stop_reason: 'refusal', content: [] }]);
  const agent = createSupportAgent({ db, mailer: createMailer(db, { silent: true }) }, { client });
  const out = await agent.reply([{ role: 'user', content: 'Bonjour' }]);
  assert.match(out.reply, /Écrivez-nous/);
});

test("l'historique client est validé (texte seul, rôles alternés, dernier message client)", () => {
  assert.equal(sanitizeHistory([]), null);
  assert.equal(sanitizeHistory([{ role: 'assistant', content: 'x' }]), null);
  assert.equal(sanitizeHistory([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }]), null);
  const ok = sanitizeHistory([
    { role: 'assistant', content: 'bonjour' },
    { role: 'user', content: { type: 'tool_result' } },
  ]);
  assert.deepEqual(ok, [{ role: 'user', content: '[object Object]' }]);
  assert.equal(sanitizeHistory([{ role: 'user', content: 'x'.repeat(5000) }])[0].content.length, 1000);
});

test("sans clé API, l'assistant est désactivé", () => {
  assert.equal(createSupportAgent({}, { apiKey: '' }), null);
});
