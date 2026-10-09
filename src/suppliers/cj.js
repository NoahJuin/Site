// Connecteur CJdropshipping (API v2). Il transmet automatiquement chaque commande
// payée et récupère le numéro de suivi.
// ⚠️ Faites une commande test réelle avant de lancer les pubs : CJ fait évoluer
// les noms de champs de son API ; tout le mapping est regroupé ici pour pouvoir
// l'ajuster facilement si besoin.

const { config, findVariant } = require('../config');
const { kvGet, kvSet } = require('../db');

function createCjSupplier(options = {}) {
  const db = options.db;
  const apiKey = options.apiKey || config.supplier.cjApiKey;
  const baseUrl = options.baseUrl || config.supplier.cjBaseUrl;
  const fetchImpl = options.fetch || globalThis.fetch;

  let memoryToken = null;

  async function call(method, path, body, token) {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'CJ-Access-Token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.result === false || (json.code && json.code !== 200)) {
      throw new Error(`CJ ${path} : ${json.message || res.status}`);
    }
    return json.data;
  }

  // Le jeton est valable ~15 jours et CJ limite les demandes de jeton :
  // on le met en cache (mémoire + base) et on le renouvelle 1 jour avant expiration.
  async function getToken() {
    if (!apiKey) throw new Error('CJ_API_KEY manquant : renseignez votre clé API CJdropshipping');
    const cached = memoryToken || (db && JSON.parse(kvGet(db, 'cj_token') || 'null'));
    if (cached && new Date(cached.expiresAt).getTime() - Date.now() > 24 * 3600e3) {
      memoryToken = cached;
      return cached.accessToken;
    }
    const data = await call('POST', '/authentication/getAccessToken', { apiKey });
    memoryToken = {
      accessToken: data.accessToken,
      expiresAt: data.accessTokenExpiryDate || new Date(Date.now() + 14 * 24 * 3600e3).toISOString(),
    };
    if (db) kvSet(db, 'cj_token', JSON.stringify(memoryToken));
    return memoryToken.accessToken;
  }

  return {
    name: 'cj',
    async createOrder(order) {
      const address = JSON.parse(order.shipping_address || '{}');
      const items = JSON.parse(order.items);
      const products = items.map((i) => {
        const vid = findVariant(i.variant)?.supplierVid;
        if (!vid) throw new Error(`Aucun identifiant CJ (SUPPLIER_VID_${i.variant.toUpperCase()}) pour la couleur ${i.variant}`);
        return { vid, quantity: i.qty };
      });
      const token = await getToken();
      const data = await call(
        'POST',
        '/shopping/order/createOrderV2',
        {
          orderNumber: order.number,
          shippingCountryCode: address.country,
          shippingCountry: address.country,
          shippingProvince: address.state || address.city,
          shippingCity: address.city,
          shippingZip: address.postal_code,
          shippingAddress: address.line1,
          shippingAddress2: address.line2 || '',
          shippingCustomerName: order.customer_name,
          shippingPhone: order.phone || '',
          email: order.email,
          remark: '',
          logisticName: config.supplier.cjLogistic,
          fromCountryCode: config.supplier.cjFromCountry,
          // 2 = paiement automatique avec le solde CJ (à approvisionner).
          payType: 2,
          products,
        },
        token
      );
      return { supplierOrderId: String(data.orderId || data.id) };
    },
    async getStatus(order) {
      const token = await getToken();
      const data = await call(
        'GET',
        `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(order.supplier_order_id)}`,
        null,
        token
      );
      if (!data) return null;
      return {
        trackingNumber: data.trackNumber || null,
        carrier: data.logisticName || null,
        delivered: data.orderStatus === 'DELIVERED',
        cancelled: data.orderStatus === 'CANCELLED',
      };
    },
  };
}

module.exports = { createCjSupplier };
