const DEFAULT_PREFERENCE_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_PREFERENCE_CATEGORY = "general";

async function upsertUserPreference({
  db,
  userId,
  shopId,
  category,
  onInsertScore = 1,
  onConflictIncrement = 1,
}) {
  if (!db || !userId) return;

  const safeShopId = shopId || DEFAULT_PREFERENCE_SHOP_ID;
  const safeCategory = category || DEFAULT_PREFERENCE_CATEGORY;

  await db.query(
    `
      INSERT INTO user_preferences (user_id, shop_id, category, score)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, shop_id, category)
      DO UPDATE SET score = user_preferences.score + $5,
                    updated_at = NOW()
    `,
    [userId, safeShopId, safeCategory, onInsertScore, onConflictIncrement]
  );
}

async function listUserPreferences({ db, userId, limit = 10 }) {
  if (!db || !userId) return [];

  const result = await db.query(
    `
      SELECT user_id, shop_id, category, score, updated_at
      FROM user_preferences
      WHERE user_id = $1
      ORDER BY score DESC, updated_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    userId: row.user_id,
    shopId: row.shop_id,
    category: row.category,
    score: Number(row.score || 0),
    updatedAt: row.updated_at,
  }));
}

module.exports = {
  DEFAULT_PREFERENCE_SHOP_ID,
  DEFAULT_PREFERENCE_CATEGORY,
  upsertUserPreference,
  listUserPreferences,
};
