// Liste e-mail : inscription avec consentement explicite, code de bienvenue
// envoyé automatiquement, désinscription en un clic.

const crypto = require('node:crypto');
const { config, SHOP } = require('./config');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class SubscribeError extends Error {}

async function subscribe(ctx, { email, consent, source }) {
  const { db, mailer } = ctx;
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(clean) || clean.length > 200) throw new SubscribeError('Adresse e-mail invalide.');
  if (consent !== true) throw new SubscribeError('Merci de cocher la case pour recevoir nos e-mails.');

  let row = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(clean);
  if (!row) {
    db.prepare('INSERT INTO subscribers (email, token, source) VALUES (?, ?, ?)').run(
      clean,
      crypto.randomBytes(18).toString('base64url'),
      String(source || 'site').slice(0, 40)
    );
  } else if (row.unsubscribed_at) {
    db.prepare("UPDATE subscribers SET unsubscribed_at = NULL, consent_at = datetime('now') WHERE id = ?").run(row.id);
  }
  row = db.prepare('SELECT * FROM subscribers WHERE email = ?').get(clean);

  const { code, text } = config.welcome;
  if (code && !row.welcome_sent_at) {
    db.prepare("UPDATE subscribers SET welcome_sent_at = datetime('now') WHERE id = ?").run(row.id);
    await mailer.send('welcome', clean, null, { code, text, unsubscribeUrl: `${SHOP.baseUrl}/desinscription/${row.token}` });
  }
  return { ok: true };
}

function unsubscribe(db, token) {
  const info = db
    .prepare("UPDATE subscribers SET unsubscribed_at = datetime('now') WHERE token = ? AND unsubscribed_at IS NULL")
    .run(String(token || ''));
  return info.changes === 1 || Boolean(db.prepare('SELECT 1 FROM subscribers WHERE token = ?').get(String(token || '')));
}

module.exports = { subscribe, unsubscribe, SubscribeError };
