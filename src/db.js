const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  offer_id TEXT NOT NULL,
  items TEXT NOT NULL,
  amount_total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  email TEXT,
  customer_name TEXT,
  phone TEXT,
  shipping_address TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  recovery_url TEXT,
  supplier_order_id TEXT,
  fulfillment_attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  tracking_number TEXT,
  carrier TEXT,
  review_token TEXT UNIQUE,
  paid_at TEXT,
  confirmation_sent_at TEXT,
  sent_to_supplier_at TEXT,
  shipped_at TEXT,
  delivered_at TEXT,
  review_requested_at TEXT,
  abandoned_email_at TEXT,
  refunded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  kind TEXT NOT NULL,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL UNIQUE,
  source TEXT,
  consent_at TEXT NOT NULL DEFAULT (datetime('now')),
  welcome_sent_at TEXT,
  unsubscribed_at TEXT
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function kvGet(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? row.value : null;
}

function kvSet(db, key, value) {
  db.prepare(
    `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value);
}

module.exports = { openDb, kvGet, kvSet };
