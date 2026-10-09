const path = require('node:path');
const { config, SHOP } = require('./config');
const { openDb } = require('./db');
const { createMailer } = require('./emails');
const { createSupplier } = require('./suppliers');
const { createStripe } = require('./stripe');
const { createApp } = require('./app');
const { runJobs } = require('./jobs');
const { createSupportAgent } = require('./support');

const db = openDb(config.databasePath);
const ctx = {
  db,
  mailer: createMailer(db),
  supplier: createSupplier({ db }),
  stripe: createStripe(),
  backupDir: path.join(path.dirname(path.resolve(config.databasePath)), 'backups'),
};
ctx.support = createSupportAgent(ctx);

if (config.env === 'production') {
  const missing = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ADMIN_PASSWORD', 'BASE_URL', 'SMTP_HOST'].filter((k) => !process.env[k]);
  if (missing.length) console.warn(`[config] ⚠️ Variables manquantes en production : ${missing.join(', ')}`);
}

const app = createApp(ctx);
const server = app.listen(config.port, () => {
  console.log(`${SHOP.name} en ligne sur ${SHOP.baseUrl} (port ${config.port}, fournisseur : ${ctx.supplier.name}${ctx.stripe ? '' : ', paiement en mode démo'}${ctx.support ? `, assistant IA : ${ctx.support.model}` : ''})`);
});

if (config.jobs.enabled) {
  const tick = () => runJobs(ctx).catch((err) => console.error('[jobs] échec :', err));
  setTimeout(tick, 10e3);
  setInterval(tick, config.jobs.intervalMinutes * 60e3).unref();
}

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
