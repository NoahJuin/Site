// Mini moteur de gabarits : {{cle}} est échappé, {{{cle}}} est inséré tel quel.

const fs = require('node:fs');
const path = require('node:path');
const { config, SHOP, PRODUCT } = require('./config');
const { escapeHtml, formatPrice } = require('./emails');

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const cache = new Map();

function read(name) {
  if (config.env === 'production' && cache.has(name)) return cache.get(name);
  const content = fs.readFileSync(path.join(VIEWS_DIR, `${name}.html`), 'utf8');
  cache.set(name, content);
  return content;
}

function lookup(vars, key) {
  return key.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), vars);
}

// Une seule passe : le contenu inséré n'est jamais ré-interprété comme gabarit.
function interpolate(template, vars) {
  return template.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{\s*([\w.]+)\s*\}\}/g, (_, raw, escaped) =>
    raw ? String(lookup(vars, raw) ?? '') : escapeHtml(lookup(vars, escaped) ?? '')
  );
}

function baseVars() {
  const fromPrice = Math.min(...PRODUCT.offers.map((o) => o.price / o.qty));
  return {
    shop: SHOP,
    product: PRODUCT,
    year: new Date().getFullYear(),
    fromPrice: formatPrice(PRODUCT.offers[0].price),
    fromUnitPrice: formatPrice(Math.round(fromPrice)),
    shippingCountriesLabel: new Intl.ListFormat('fr', { type: 'conjunction' }).format(
      SHOP.shippingCountries.map((c) => new Intl.DisplayNames(['fr'], { type: 'region' }).of(c))
    ),
  };
}

// Rend une page dans le gabarit commun (en-tête, pied de page, bannière cookies).
function render(name, vars = {}) {
  const all = { ...baseVars(), ...vars };
  const body = interpolate(read(name), all);
  return interpolate(read('layout'), {
    ...all,
    body,
    title: vars.title || `${SHOP.name} — ${PRODUCT.tagline}`,
    description: vars.description || PRODUCT.description,
  });
}

module.exports = { render, interpolate };
