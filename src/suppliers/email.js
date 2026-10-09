// Fournisseur « manuel » : chaque commande payée est transmise automatiquement
// par e-mail à votre fournisseur / agent. Le numéro de suivi se saisit ensuite
// dans l'admin, ce qui déclenche l'e-mail d'expédition au client.

const nodemailer = require('nodemailer');
const { config, PRODUCT, findVariant } = require('../config');

function createEmailSupplier(options = {}) {
  // Sans adresse, le site démarre quand même : chaque commande passe en « erreur
  // fournisseur » avec une alerte admin, jusqu'à ce que SUPPLIER_EMAIL soit renseigné.
  const to = options.email || config.supplier.email;
  const smtp = config.smtp;
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

  return {
    name: 'email',
    async createOrder(order) {
      if (!to) throw new Error('SUPPLIER_EMAIL manquant : renseignez l\'adresse de votre fournisseur');
      const address = JSON.parse(order.shipping_address || '{}');
      const items = JSON.parse(order.items);
      const lines = [
        `Nouvelle commande ${order.number}`,
        '',
        ...items.map((i) => {
          const v = findVariant(i.variant);
          return `- ${i.qty} x ${PRODUCT.name} / ${v?.label || i.variant}${v?.supplierVid ? ` (SKU ${v.supplierVid})` : ''}`;
        }),
        '',
        'Livraison :',
        order.customer_name,
        address.line1,
        address.line2,
        `${address.postal_code} ${address.city}`,
        address.state,
        address.country,
        order.phone ? `Tél : ${order.phone}` : '',
        `E-mail : ${order.email}`,
        '',
        'Merci de répondre avec le numéro de suivi dès expédition.',
      ].filter((l) => l !== undefined && l !== null);
      const text = lines.join('\n');
      if (!transport) {
        console.log(`[supplier:email:dev] → ${to}\n${text}`);
      } else {
        await transport.sendMail({ from: smtp.from, to, subject: `Commande ${order.number}`, text });
      }
      return { supplierOrderId: `EMAIL-${order.number}` };
    },
  };
}

module.exports = { createEmailSupplier };
