/**
 * Tracking Service — User Intelligence & Behavior Analysis
 * Enables personalization and retention features
 */

async function trackEvent(db, userId, eventType, entityId = null, metadata = {}) {
  if (!userId) return; // Skip tracking for unauthenticated users
  
  try {
    await db.query(`
      INSERT INTO user_events (user_id, event_type, metadata)
      VALUES ($1, $2, $3)
    `, [userId, eventType, metadata]);
    
    console.log(`[tracking] Event tracked: ${eventType} for user ${userId}`);
  } catch (err) {
    console.error("[tracking] Failed to track event:", err.message);
    // Non-blocking - don't throw
  }
}

async function recordAnalyticsEvent(db, { type, value, userId = null, productId = null }) {
  if (!type || !value) return;

  try {
    await db.query(
      `
        INSERT INTO analytics_events (type, value, user_id, product_id)
        VALUES ($1, $2, $3, $4)
      `,
      [type, String(value), userId || null, productId || null]
    );
  } catch (err) {
    console.error("[analytics] Failed to record event:", err.message);
  }
}

async function getUserSearchPreferences(db, userId, limit = 3) {
  try {
    const result = await db.query(`
      SELECT metadata->>'query' as query, COUNT(*) as frequency
      FROM user_events
      WHERE user_id = $1 AND event_type = 'SEARCH'
      AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY metadata->>'query'
      ORDER BY frequency DESC
      LIMIT $2
    `, [userId, limit]);
    
    return result.rows;
  } catch (err) {
    console.error("[tracking] Failed to get user preferences:", err.message);
    return [];
  }
}

async function getRecentOrders(db, userId, limit = 10) {
  try {
    const result = await db.query(`
      SELECT DISTINCT
        o.shop_id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        MAX(o.updated_at) AS last_ordered_at
      FROM orders o
      JOIN shops s ON s.id = o.shop_id
      WHERE o.customer_id = $1 AND o.status = 'DELIVERED'
      GROUP BY o.shop_id, s.id, s.name, s.category, s.rating_avg
      ORDER BY MAX(o.updated_at) DESC
      LIMIT $2
    `, [userId, limit]);
    
    return result.rows.map(row => ({
      shopId: row.shop_id,
      name: row.name,
      category: row.category,
      rating: Number(row.rating || 0),
      lastOrderedAt: row.last_ordered_at,
    }));
  } catch (err) {
    console.error("[tracking] Failed to get recent orders:", err.message);
    return [];
  }
}

async function createNotification(db, userId, title, body, entityType = null, entityId = null) {
  try {
    const result = await db.query(`
      INSERT INTO notifications (user_id, title, body, entity_type, related_entity_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, title, body, is_read, created_at
    `, [userId, title, body, entityType, entityId]);
    
    console.log(`[tracking] Notification created for user ${userId}`);
    return result.rows[0];
  } catch (err) {
    console.error("[tracking] Failed to create notification:", err.message);
    return null;
  }
}

async function getNotifications(db, userId, limit = 20, onlyUnread = false) {
  try {
    let query = `
      SELECT id, title, body, is_read, entity_type, related_entity_id, created_at
      FROM notifications
      WHERE user_id = $1
    `;
    const params = [userId];
    
    if (onlyUnread) {
      query += ` AND is_read = FALSE`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await db.query(query, params);
    return result.rows;
  } catch (err) {
    console.error("[tracking] Failed to get notifications:", err.message);
    return [];
  }
}

async function markNotificationAsRead(db, notificationId, userId) {
  try {
    await db.query(`
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1 AND user_id = $2
    `, [notificationId, userId]);
  } catch (err) {
    console.error("[tracking] Failed to mark notification as read:", err.message);
  }
}

module.exports = {
  trackEvent,
  recordAnalyticsEvent,
  getUserSearchPreferences,
  getRecentOrders,
  createNotification,
  getNotifications,
  markNotificationAsRead,
};
