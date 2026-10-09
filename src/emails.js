// Envoi des e-mails transactionnels. Sans SMTP configuré, les e-mails sont
// journalisés (console + table `emails`) au lieu d'être envoyés : pratique en dev.

const nodemailer = require('nodemailer');
const { config, SHOP, PRODUCT, findVariant } = require('./config');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(cents) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function trackingUrl(number) {
  return `https://t.17track.net/fr#nums=${encodeURIComponent(number)}`;
}

function itemsSummary(order) {
  const items = JSON.parse(order.items);
  return items
    .map((i) => `${i.qty} × ${PRODUCT.shortName} — ${findVariant(i.variant)?.label || i.variant}`)
    .join('<br>');
}

function layout(title, body) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f2fb;font-family:Arial,Helvetica,sans-serif;color:#1d1f2b">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden">
<tr><td style="background:#1b1f3b;padding:24px 32px;color:#fff;font-size:22px;font-weight:bold">${escapeHtml(SHOP.name)}</td></tr>
<tr><td style="padding:32px">
<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:20px 32px;background:#f8f7fc;color:#6b6f80;font-size:12px">
Une question ? Répondez simplement à cet e-mail ou écrivez-nous à ${escapeHtml(SHOP.supportEmail)}.<br>
${escapeHtml(SHOP.companyName)} — ${escapeHtml(SHOP.companyAddress)}
</td></tr></table></td></tr></table></body></html>`;
}

function button(href, label) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#6c5ce7;color:#fff;text-decoration:none;padding:14px 24px;border-radius:999px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;
}

const templates = {
  order_confirmation(order) {
    return {
      subject: `Commande ${order.number} confirmée ✨`,
      html: layout(
        `Merci ${order.customer_name ? escapeHtml(order.customer_name.split(' ')[0]) : ''} !`,
        `<p>Votre commande <strong>${escapeHtml(order.number)}</strong> est confirmée et part en préparation.</p>
<p style="background:#f4f2fb;padding:16px;border-radius:12px">${itemsSummary(order)}<br><strong>Total payé : ${formatPrice(order.amount_total)}</strong></p>
<p>Livraison suivie offerte, estimée sous ${SHOP.shippingDaysMin} à ${SHOP.shippingDaysMax} jours ouvrés.
Vous recevrez automatiquement votre numéro de suivi dès l'expédition.</p>
${button(`${SHOP.baseUrl}/suivi?commande=${encodeURIComponent(order.number)}`, 'Suivre ma commande')}
<p>Vous disposez de ${SHOP.returnDays} nuits pour l'essayer : s'il ne vous convient pas, on vous rembourse.</p>`
      ),
    };
  },

  shipping(order) {
    return {
      subject: `Votre commande ${order.number} est en route 🚚`,
      html: layout(
        'Votre colis est expédié',
        `<p>Bonne nouvelle : votre commande <strong>${escapeHtml(order.number)}</strong> vient de partir.</p>
<p>Numéro de suivi : <strong>${escapeHtml(order.tracking_number)}</strong>${order.carrier ? ` (${escapeHtml(order.carrier)})` : ''}</p>
${button(trackingUrl(order.tracking_number), 'Suivre mon colis')}
<p>Le suivi peut mettre 24 à 48 h à s'activer chez le transporteur.</p>
<p><strong>Astuce :</strong> chargez votre bandeau 1 h avant la première nuit, puis appairez-le en Bluetooth comme un casque classique.</p>`
      ),
    };
  },

  review_request(order) {
    return {
      subject: 'Comment se passent vos nuits ? 🌙',
      html: layout(
        'Votre avis compte',
        `<p>Cela fait quelques nuits que vous dormez avec votre bandeau ${escapeHtml(SHOP.name)}.</p>
<p>Pourriez-vous prendre 30 secondes pour nous dire ce que vous en pensez ? Votre avis (positif ou non) sera publié avec la mention « Achat vérifié » et aide d'autres personnes à mieux dormir.</p>
${button(`${SHOP.baseUrl}/avis/${encodeURIComponent(order.review_token)}`, 'Donner mon avis')}
<p>Un souci ? Répondez à cet e-mail, nous trouverons une solution.</p>`
      ),
    };
  },

  abandoned_cart(order) {
    return {
      subject: 'Vous avez oublié quelque chose 😴',
      html: layout(
        'Votre bandeau vous attend',
        `<p>Vous étiez à deux doigts de dire adieu aux écouteurs qui font mal aux oreilles la nuit.</p>
<p style="background:#f4f2fb;padding:16px;border-radius:12px">${itemsSummary(order)}<br><strong>${formatPrice(order.amount_total)}</strong> — livraison offerte</p>
${button(order.recovery_url || SHOP.baseUrl, 'Finaliser ma commande')}
<p>Essai ${SHOP.returnDays} nuits, satisfait ou remboursé. Paiement 100 % sécurisé.</p>`
      ),
    };
  },

  admin_alert(order, { title, message }) {
    return {
      subject: `[${SHOP.name}] ${title}`,
      html: layout(title, `<p>${escapeHtml(message)}</p>${order ? `<p>Commande : <strong>${escapeHtml(order.number)}</strong></p>` : ''}${button(`${SHOP.baseUrl}/admin`, 'Ouvrir l\'admin')}`),
    };
  },

  daily_report(_order, { date, stats }) {
    return {
      subject: `[${SHOP.name}] Rapport du ${date}`,
      html: layout(
        `Rapport du ${date}`,
        `<ul style="line-height:1.8">
<li>Commandes payées : <strong>${stats.orders}</strong></li>
<li>Chiffre d'affaires : <strong>${formatPrice(stats.revenue)}</strong></li>
<li>Marge brute estimée : <strong>${formatPrice(stats.margin)}</strong></li>
<li>Paniers abandonnés : ${stats.abandoned}</li>
<li>Commandes en erreur fournisseur : <strong>${stats.errors}</strong></li>
</ul>${button(`${SHOP.baseUrl}/admin`, 'Ouvrir l\'admin')}`
      ),
    };
  },
};

function createMailer(db, options = {}) {
  const smtp = options.smtp || config.smtp;
  const transport =
    options.transport ||
    (smtp.host
      ? nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.port === 465,
          auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
        })
      : null);

  async function send(kind, to, order, extra) {
    const { subject, html } = templates[kind](order, extra);
    const log = db.prepare('INSERT INTO emails (order_id, kind, to_addr, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)');
    if (!transport) {
      if (!options.silent) console.log(`[mail:dev] ${kind} → ${to} : ${subject}`);
      log.run(order?.id ?? null, kind, to, subject, 'logged', null);
      return true;
    }
    try {
      await transport.sendMail({ from: smtp.from, replyTo: SHOP.supportEmail, to, subject, html });
      log.run(order?.id ?? null, kind, to, subject, 'sent', null);
      return true;
    } catch (err) {
      console.error(`[mail] échec ${kind} → ${to}:`, err.message);
      log.run(order?.id ?? null, kind, to, subject, 'failed', err.message);
      return false;
    }
  }

  return {
    send,
    alertAdmin: (order, title, message) => send('admin_alert', SHOP.adminEmail, order, { title, message }),
  };
}

module.exports = { createMailer, escapeHtml, formatPrice, trackingUrl, templates };
