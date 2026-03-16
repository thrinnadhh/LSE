function createSubscriptionStore() {
  const orderSubscribers = new Map();
  const socketOrders = new Map();

  function subscribeOrder(ws, orderId) {
    const key = String(orderId);
    const sockets = orderSubscribers.get(key) || new Set();
    sockets.add(ws);
    orderSubscribers.set(key, sockets);

    const orders = socketOrders.get(ws) || new Set();
    orders.add(key);
    socketOrders.set(ws, orders);
  }

  function unsubscribeSocket(ws) {
    const orders = socketOrders.get(ws);
    if (!orders) {
      return;
    }

    for (const orderId of orders) {
      const sockets = orderSubscribers.get(orderId);
      if (!sockets) {
        continue;
      }
      sockets.delete(ws);
      if (sockets.size === 0) {
        orderSubscribers.delete(orderId);
      }
    }

    socketOrders.delete(ws);
  }

  function subscribersForOrder(orderId) {
    return orderSubscribers.get(String(orderId)) || new Set();
  }

  return {
    subscribeOrder,
    unsubscribeSocket,
    subscribersForOrder,
  };
}

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

async function authorizeOrderSubscription({ orderId, auth, db }) {
  const role = normalizeRole(auth.role);

  if (role === "admin") {
    return true;
  }

  if (role === "customer") {
    const result = await db.query(
      `
        SELECT 1
        FROM orders
        WHERE id = $1
          AND customer_id = $2
        LIMIT 1
      `,
      [orderId, auth.userId]
    );
    return result.rowCount > 0;
  }

  if (role === "shop_owner") {
    const result = await db.query(
      `
        SELECT 1
        FROM orders o
        JOIN shops s ON s.id = o.shop_id
        WHERE o.id = $1
          AND (s.owner_user_id = $2 OR s.owner_id = $2)
        LIMIT 1
      `,
      [orderId, auth.userId]
    );
    return result.rowCount > 0;
  }

  if (role === "driver") {
    const result = await db.query(
      `
        SELECT 1
        FROM orders o
        JOIN drivers d ON d.id = o.driver_id
        WHERE o.id = $1
          AND d.user_id = $2
        LIMIT 1
      `,
      [orderId, auth.userId]
    );
    return result.rowCount > 0;
  }

  return false;
}

module.exports = {
  createSubscriptionStore,
  authorizeOrderSubscription,
};
