// Fournisseur simulé, pour le développement et les tests : la commande est
// « expédiée » au premier passage des tâches, puis « livrée » au suivant.

function createMockSupplier() {
  const state = new Map();
  return {
    name: 'mock',
    async createOrder(order) {
      const supplierOrderId = `MOCK-${order.number}`;
      state.set(supplierOrderId, 0);
      return { supplierOrderId };
    },
    async getStatus(order) {
      const step = (state.get(order.supplier_order_id) ?? 0) + 1;
      state.set(order.supplier_order_id, step);
      if (step === 1) return { trackingNumber: `LP${order.id.toString().padStart(9, '0')}CN`, carrier: 'Simulé' };
      return { trackingNumber: `LP${order.id.toString().padStart(9, '0')}CN`, carrier: 'Simulé', delivered: true };
    },
  };
}

module.exports = { createMockSupplier };
