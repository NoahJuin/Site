// Tableau de bord admin (protégé par mot de passe) : chiffres clés, commandes,
// saisie du suivi, relance fournisseur, modération des avis, export CSV.

const crypto = require('node:crypto');
const express = require('express');
const { config, SHOP, PRODUCT, findOffer, findVariant } = require('./config');
const orders = require('./orders');
const { runJobs, statsSince } = require('./jobs');
const { kvGet } = require('./db');
const { escapeHtml: e, formatPrice } = require('./emails');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuth(req, res, next) {
  if (!config.adminPassword) return res.status(503).send('Admin désactivé : définissez ADMIN_PASSWORD.');
  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, ...rest] = Buffer.from(encoded, 'base64').toString().split(':');
    if (safeEqual(user, config.adminUser) & safeEqual(rest.join(':'), config.adminPassword)) return next();
  }
  res.set('WWW-Authenticate', `Basic realm="${SHOP.name} admin", charset="UTF-8"`).status(401).send('Authentification requise');
}

// Protection CSRF : les actions doivent venir de l'admin lui-même.
function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const source = req.get('origin') || req.get('referer');
  try {
    if (source && new URL(source).host === req.get('host')) return next();
  } catch {
    /* URL invalide */
  }
  res.status(403).send('Requête refusée (origine invalide)');
}

// Neutralise les formules Excel/Sheets (injection CSV).
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function sqlDate(daysAgo) {
  return new Date(Date.now() - daysAgo * 24 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
}

function itemsText(order) {
  return JSON.parse(order.items)
    .map((i) => `${i.qty}× ${findVariant(i.variant)?.label || i.variant}`)
    .join(', ');
}

function page(title, body, flash) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)} — ${e(SHOP.name)}</title><link rel="icon" href="/img/favicon.svg">
<link rel="stylesheet" href="/admin.css"></head><body>
<header class="adm-header"><a href="/admin" class="adm-logo">${e(SHOP.name)} <span>admin</span></a>
<nav><a href="/admin">Tableau de bord</a><a href="/admin/avis">Avis</a><a href="/admin/emails">E-mails</a><a href="/admin/commandes.csv">Commandes CSV</a><a href="/admin/abonnes.csv">Abonnés CSV</a><a href="/" target="_blank">Voir la boutique ↗</a></nav></header>
<main class="adm-main">${flash ? `<p class="adm-flash">${e(flash)}</p>` : ''}${body}</main></body></html>`;
}

function kpi(label, stats) {
  return `<div class="adm-kpi"><h3>${e(label)}</h3><p class="adm-big">${formatPrice(stats.revenue)}</p>
<p>${stats.orders} commande${stats.orders > 1 ? 's' : ''} · marge ≈ <strong>${formatPrice(stats.margin)}</strong></p>
<p class="adm-muted">Panier moyen ${stats.orders ? formatPrice(Math.round(stats.revenue / stats.orders)) : '—'}</p></div>`;
}

function orderActions(order) {
  const parts = [];
  if (['paid', 'fulfillment_error'].includes(order.status)) {
    parts.push(`<form method="post" action="/admin/commandes/${order.id}/relancer"><button>Renvoyer au fournisseur</button></form>`);
  }
  if (['paid', 'fulfillment_error', 'sent_to_supplier', 'shipped', 'fulfilling'].includes(order.status)) {
    parts.push(`<form method="post" action="/admin/commandes/${order.id}/suivi" class="adm-inline">
<input name="tracking_number" placeholder="N° de suivi" value="${e(order.tracking_number || '')}" required>
<input name="carrier" placeholder="Transporteur" value="${e(order.carrier || '')}">
<button>Enregistrer</button></form>`);
  }
  if (order.status === 'shipped') {
    parts.push(`<form method="post" action="/admin/commandes/${order.id}/livree"><button>Marquer livrée</button></form>`);
  }
  return parts.join('');
}

function createAdminRouter(ctx) {
  const { db } = ctx;
  const router = express.Router();
  router.use(basicAuth, sameOrigin);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/', (req, res) => {
    const until = sqlDate(-1);
    const status = typeof req.query.statut === 'string' && orders.STATUS_LABELS[req.query.statut] ? req.query.statut : '';
    const list = status
      ? db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY id DESC LIMIT 200').all(status)
      : db.prepare("SELECT * FROM orders WHERE status NOT IN ('pending') ORDER BY id DESC LIMIT 200").all();
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
    const problems = (counts.fulfillment_error || 0) + (counts.fulfilling || 0);
    const pendingPayment = counts.pending || 0;
    const totalCheckouts = Object.values(counts).reduce((a, b) => a + b, 0);
    const paidCount = totalCheckouts - pendingPayment - (counts.abandoned || 0);
    const conversion = totalCheckouts ? Math.round((paidCount / totalCheckouts) * 100) : 0;

    const filters = ['', ...Object.keys(orders.STATUS_LABELS)]
      .map((s) => `<a href="/admin${s ? `?statut=${s}` : ''}" class="${s === status ? 'active' : ''}">${s ? e(orders.STATUS_LABELS[s]) : 'Toutes'}${s && counts[s] ? ` (${counts[s]})` : ''}</a>`)
      .join('');

    const rows = list
      .map(
        (o) => `<tr>
<td><strong>${e(o.number)}</strong><br><span class="adm-muted">${e((o.paid_at || o.created_at).slice(0, 16))}</span></td>
<td>${e(o.customer_name || '—')}<br><span class="adm-muted">${e(o.email || '')}</span></td>
<td>${e(findOffer(o.offer_id)?.label || o.offer_id)}<br><span class="adm-muted">${e(itemsText(o))}</span></td>
<td>${formatPrice(o.amount_total)}</td>
<td><span class="adm-status adm-${e(o.status)}">${e(orders.STATUS_LABELS[o.status] || o.status)}</span>
${o.last_error && o.status === 'fulfillment_error' ? `<br><span class="adm-error">${e(o.last_error)}</span>` : ''}
${o.supplier_order_id ? `<br><span class="adm-muted">Fourn. ${e(o.supplier_order_id)}</span>` : ''}</td>
<td>${orderActions(o)}</td></tr>`
      )
      .join('');

    const lastRun = kvGet(db, 'jobs_last_run');
    res.send(
      page(
        'Tableau de bord',
        `<section class="adm-kpis">
${kpi("Aujourd'hui", statsSince(db, `${new Date().toISOString().slice(0, 10)} 00:00:00`, until))}
${kpi('7 derniers jours', statsSince(db, sqlDate(7), until))}
${kpi('30 derniers jours', statsSince(db, sqlDate(30), until))}
<div class="adm-kpi"><h3>Automatisation</h3>
<p>Fournisseur : <strong>${e(ctx.supplier.name)}</strong></p>
<p>Conversion paiement : <strong>${conversion} %</strong></p>
<p>Abonnés e-mail : <strong>${db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE unsubscribed_at IS NULL').get().n}</strong></p>
<p class="adm-muted">Dernier passage des tâches : ${lastRun ? e(lastRun.slice(0, 16).replace('T', ' ')) + ' UTC' : 'jamais'}</p>
<form method="post" action="/admin/taches"><button>Lancer les tâches maintenant</button></form></div>
</section>
${problems ? `<p class="adm-alert">⚠️ ${problems} commande(s) nécessitent votre attention (erreur fournisseur).</p>` : ''}
<nav class="adm-filters">${filters}</nav>
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Commande</th><th>Client</th><th>Offre</th><th>Montant</th><th>Statut</th><th>Actions</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="adm-muted">Aucune commande pour le moment.</td></tr>'}</tbody></table></div>
<p class="adm-muted">Coût unitaire fournisseur utilisé pour la marge : ${formatPrice(PRODUCT.unitCost)} (variable UNIT_COST_CENTS). Frais Stripe estimés : 1,5 % + 0,25 €.</p>`,
        req.query.ok
      )
    );
  });

  function withOrder(handler) {
    return async (req, res) => {
      const order = orders.getOrder(db, Number(req.params.id));
      if (!order) return res.status(404).send('Commande introuvable');
      const message = await handler(order, req);
      res.redirect(303, `/admin?ok=${encodeURIComponent(message)}`);
    };
  }

  router.post(
    '/commandes/:id/relancer',
    withOrder(async (order) => {
      const result = await orders.fulfill(ctx, order);
      return result.status === 'sent_to_supplier' ? `${order.number} transmise au fournisseur.` : `Échec : ${result.last_error || result.status}`;
    })
  );

  router.post(
    '/commandes/:id/suivi',
    withOrder(async (order, req) => {
      const trackingNumber = String(req.body.tracking_number || '').trim();
      if (!trackingNumber) return 'Numéro de suivi manquant.';
      await orders.setTracking(ctx, order, { trackingNumber, carrier: String(req.body.carrier || '').trim() || null });
      return `Suivi enregistré pour ${order.number} — e-mail envoyé au client.`;
    })
  );

  router.post(
    '/commandes/:id/livree',
    withOrder(async (order) => {
      orders.markDelivered(db, order);
      return `${order.number} marquée livrée.`;
    })
  );

  router.post('/taches', async (req, res) => {
    const result = await runJobs(ctx);
    const msg = result
      ? `Tâches exécutées : ${result.fulfilled} transmise(s), ${result.tracking} suivi(s) mis à jour, ${result.reviewRequests} demande(s) d'avis.`
      : 'Les tâches tournent déjà.';
    res.redirect(303, `/admin?ok=${encodeURIComponent(msg)}`);
  });

  router.get('/avis', (req, res) => {
    const rows = db
      .prepare('SELECT r.*, o.number FROM reviews r JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT 300')
      .all()
      .map(
        (r) => `<tr><td>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td><td><strong>${e(r.name)}</strong><br><span class="adm-muted">${e(r.number)} · ${e(r.created_at.slice(0, 10))}</span></td>
<td><strong>${e(r.title || '')}</strong><br>${e(r.body)}</td><td>${r.approved ? 'Publié' : 'Masqué'}</td>
<td><form method="post" action="/admin/avis/${r.id}/basculer"><button>${r.approved ? 'Masquer' : 'Publier'}</button></form></td></tr>`
      )
      .join('');
    res.send(
      page(
        'Avis clients',
        `<h1>Avis clients</h1><p class="adm-muted">Avis d'acheteurs vérifiés, collectés automatiquement après livraison. Ne masquez que les avis abusifs ou hors sujet : supprimer les avis négatifs est une pratique commerciale trompeuse.</p>
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Note</th><th>Client</th><th>Avis</th><th>État</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="adm-muted">Aucun avis pour le moment.</td></tr>'}</tbody></table></div>`,
        req.query.ok
      )
    );
  });

  router.post('/avis/:id/basculer', (req, res) => {
    db.prepare('UPDATE reviews SET approved = 1 - approved WHERE id = ?').run(Number(req.params.id));
    res.redirect(303, '/admin/avis?ok=Avis%20mis%20%C3%A0%20jour');
  });

  router.get('/emails', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM emails ORDER BY id DESC LIMIT 200')
      .all()
      .map((m) => `<tr><td>${e(m.created_at)}</td><td>${e(m.kind)}</td><td>${e(m.to_addr)}</td><td>${e(m.subject)}</td><td>${e(m.status)}${m.error ? `<br><span class="adm-error">${e(m.error)}</span>` : ''}</td></tr>`)
      .join('');
    res.send(
      page(
        'E-mails',
        `<h1>E-mails envoyés</h1>${config.smtp.host ? '' : '<p class="adm-alert">SMTP non configuré : les e-mails sont seulement journalisés.</p>'}
<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Date (UTC)</th><th>Type</th><th>Destinataire</th><th>Sujet</th><th>État</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="adm-muted">Aucun e-mail.</td></tr>'}</tbody></table></div>`
      )
    );
  });

  router.get('/abonnes.csv', (req, res) => {
    const rows = db.prepare('SELECT email, source, consent_at FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY id DESC').all();
    const csv = ['email;source;consentement', ...rows.map((r) => [r.email, r.source, r.consent_at].map(csvCell).join(';'))].join('\n');
    res.set('Content-Disposition', 'attachment; filename="abonnes.csv"').type('text/csv; charset=utf-8').send(`\ufeff${csv}`);
  });

  router.get('/commandes.csv', (req, res) => {
    const cols = ['number', 'status', 'paid_at', 'customer_name', 'email', 'phone', 'offer_id', 'items', 'amount_total', 'shipping_address', 'supplier_order_id', 'tracking_number'];
    const rows = db.prepare("SELECT * FROM orders WHERE paid_at IS NOT NULL ORDER BY id DESC").all();
    const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => csvCell(c === 'items' ? itemsText(r) : r[c])).join(';'))].join('\n');
    res.set('Content-Disposition', 'attachment; filename="commandes.csv"').type('text/csv; charset=utf-8').send(`﻿${csv}`);
  });

  return router;
}

module.exports = { createAdminRouter };
