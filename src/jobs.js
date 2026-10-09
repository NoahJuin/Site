// Tâches automatiques, lancées toutes les JOBS_INTERVAL_MINUTES par le serveur
// (ou via `npm run jobs` depuis un cron externe).

const { config, SHOP, PRODUCT, findOffer } = require('./config');
const { kvGet, kvSet } = require('./db');
const orders = require('./orders');

async function retryFulfillment(ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT * FROM orders WHERE status IN ('paid', 'fulfillment_error') AND supplier_order_id IS NULL AND fulfillment_attempts < ?`
    )
    .all(config.jobs.maxFulfillmentAttempts);
  let sent = 0;
  for (const order of rows) {
    const result = await orders.processPaidOrder(ctx, order);
    if (result.status === 'sent_to_supplier') sent++;
  }
  return sent;
}

async function syncTracking(ctx) {
  if (typeof ctx.supplier.getStatus !== 'function') return 0;
  const rows = ctx.db
    .prepare(`SELECT * FROM orders WHERE status IN ('sent_to_supplier', 'shipped') AND supplier_order_id IS NOT NULL`)
    .all();
  let updated = 0;
  for (let order of rows) {
    try {
      const status = await ctx.supplier.getStatus(order);
      if (!status) continue;
      if (status.cancelled) {
        orders.update(ctx.db, order.id, { status: 'fulfillment_error', last_error: 'Commande annulée par le fournisseur' });
        await ctx.mailer.alertAdmin(order, 'Commande annulée par le fournisseur', 'Vérifiez le stock et repassez la commande.');
        continue;
      }
      if (status.trackingNumber && status.trackingNumber !== order.tracking_number) {
        order = await orders.setTracking(ctx, order, status);
        updated++;
      }
      if (status.delivered && order.status !== 'delivered') {
        orders.markDelivered(ctx.db, order);
        updated++;
      }
    } catch (err) {
      console.error(`[jobs] suivi ${order.number} :`, err.message);
    }
  }
  return updated;
}

async function sendReviewRequests(ctx) {
  const rows = ctx.db
    .prepare(
      `SELECT * FROM orders
       WHERE status IN ('shipped', 'delivered') AND review_requested_at IS NULL AND email IS NOT NULL
         AND (
           (delivered_at IS NOT NULL AND delivered_at <= datetime('now', '-4 days'))
           OR shipped_at <= datetime('now', ?)
         )`
    )
    .all(`-${config.jobs.reviewRequestDaysAfterShipping} days`);
  for (const order of rows) {
    orders.update(ctx.db, order.id, { review_requested_at: orders.now() });
    await ctx.mailer.send('review_request', order.email, order);
  }
  return rows.length;
}

function statsSince(db, since, until) {
  const rows = db
    .prepare(`SELECT amount_total, offer_id FROM orders WHERE paid_at >= ? AND paid_at < ? AND status != 'refunded'`)
    .all(since, until);
  const paid = {
    orders: rows.length,
    revenue: rows.reduce((sum, r) => sum + r.amount_total, 0),
    units: rows.reduce((sum, r) => sum + (findOffer(r.offer_id)?.qty || 1), 0),
  };
  const abandoned = db
    .prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'abandoned' AND created_at >= ? AND created_at < ?`)
    .get(since, until).n;
  const errors = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('fulfillment_error', 'fulfilling')`).get().n;
  // Stripe prélève ~1,5 % + 0,25 € par paiement européen.
  const fees = Math.round(paid.revenue * 0.015) + paid.orders * 25;
  return {
    orders: paid.orders,
    revenue: paid.revenue,
    units: paid.units,
    margin: paid.revenue - paid.units * PRODUCT.unitCost - fees,
    abandoned,
    errors,
  };
}

async function sendDailyReport(ctx, date = new Date()) {
  if (date.getUTCHours() < config.jobs.dailyReportHour) return false;
  const today = date.toISOString().slice(0, 10);
  if (kvGet(ctx.db, 'daily_report_date') === today) return false;
  const yesterday = new Date(date.getTime() - 24 * 3600e3).toISOString().slice(0, 10);
  const stats = statsSince(ctx.db, `${yesterday} 00:00:00`, `${today} 00:00:00`);
  kvSet(ctx.db, 'daily_report_date', today);
  await ctx.mailer.send('daily_report', SHOP.adminEmail, null, { date: yesterday, stats });
  return true;
}

let running = false;

async function runJobs(ctx) {
  if (running) return null;
  running = true;
  try {
    const result = {
      fulfilled: await retryFulfillment(ctx),
      tracking: await syncTracking(ctx),
      reviewRequests: await sendReviewRequests(ctx),
      dailyReport: await sendDailyReport(ctx),
    };
    kvSet(ctx.db, 'jobs_last_run', new Date().toISOString());
    return result;
  } finally {
    running = false;
  }
}

module.exports = { runJobs, retryFulfillment, syncTracking, sendReviewRequests, sendDailyReport, statsSince };

if (require.main === module) {
  const { openDb } = require('./db');
  const { createMailer } = require('./emails');
  const { createSupplier } = require('./suppliers');
  const db = openDb(config.databasePath);
  const ctx = { db, mailer: createMailer(db), supplier: createSupplier({ db }) };
  runJobs(ctx)
    .then((r) => {
      console.log('[jobs]', r);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[jobs] échec :', err);
      process.exit(1);
    });
}
