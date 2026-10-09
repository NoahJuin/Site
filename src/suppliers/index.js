// Un fournisseur expose deux méthodes :
//   createOrder(order)  -> { supplierOrderId }
//   getStatus(order)    -> { trackingNumber?, carrier?, delivered?: boolean } | null
// `getStatus` peut être absent (fournisseur manuel : le suivi se saisit dans l'admin).

const { config } = require('../config');

function createSupplier(options = {}) {
  const provider = options.provider || config.supplier.provider;
  switch (provider) {
    case 'cj':
      return require('./cj').createCjSupplier(options);
    case 'email':
      return require('./email').createEmailSupplier(options);
    case 'mock':
      return require('./mock').createMockSupplier(options);
    default:
      throw new Error(`Fournisseur inconnu : ${provider} (attendu : mock, email ou cj)`);
  }
}

module.exports = { createSupplier };
