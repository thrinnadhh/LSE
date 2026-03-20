/**
 * Home Service — Discovery Layer
 * Returns structured homepage sections:
 * - Favorites
 * - Regular shops
 * - Recommended shops
 * - Categories
 */

const STATIC_CATEGORIES = [
  { id: "grocery", name: "Grocery" },
  { id: "restaurant", name: "Food" },
  { id: "pet_store", name: "Pet Stores" },
  { id: "electronics", name: "Mobiles" },
  { id: "furniture", name: "Furniture" },
  { id: "doctor", name: "Medical" },
  { id: "salon", name: "Salon" },
  { id: "movies", name: "Movies" },
];

function computeRankingScore({ baseScore, isFavorite, repeatOrderCount }) {
  let score = Number(baseScore || 0);
  if (isFavorite) {
    score += 100;
  }
  score += Number(repeatOrderCount || 0) * 10;
  return score;
}

function getDeliveryTag(distanceMeters) {
  if (!distanceMeters) return "Nearby";
  if (distanceMeters <= 2000) return "Within 2 km";
  if (distanceMeters <= 5000) return "Within 5 km";
  return "Nearby";
}

async function getFavoriteShops({ userId, db, limit = 10 }) {
  const result = await db.query(
    `
      SELECT
        s.id AS shop_id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating
      FROM favorite_shops fs
      JOIN shops s ON s.id = fs.shop_id
      WHERE fs.user_id = $1 AND COALESCE(s.is_active, TRUE) = TRUE
      ORDER BY fs.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    shopId: row.shop_id,
    name: row.name,
    category: row.category,
    rating: Number(row.rating || 0),
  }));
}

async function getRegularShops({ userId, db, limit = 10 }) {
  const result = await db.query(
    `
      SELECT
        s.id AS shop_id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        scs.order_count,
        scs.last_order_at
      FROM shop_customer_stats scs
      JOIN shops s ON s.id = scs.shop_id
      WHERE scs.customer_id = $1 AND COALESCE(s.is_active, TRUE) = TRUE
      ORDER BY scs.order_count DESC, scs.last_order_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    shopId: row.shop_id,
    name: row.name,
    category: row.category,
    rating: Number(row.rating || 0),
    orderCount: Number(row.order_count),
    lastOrderAt: row.last_order_at,
  }));
}

async function getRecommendedShops({ userId, userLat, userLng, db, limit = 20 }) {
  // Fetch all active shops nearby with their basic info
  const result = await db.query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND ST_DWithin(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography,
          5000
        )
      ORDER BY distance_meters ASC
      LIMIT $1
    `,
    [limit * 2, userLat, userLng]
  );

  const shopIds = result.rows.map((row) => row.id);
  if (shopIds.length === 0) {
    return [];
  }

  // Fetch favorites and repeat stats in batch
  const [favoritesResult, repeatsResult] = await Promise.all([
    db.query(
      `
        SELECT shop_id
        FROM favorite_shops
        WHERE user_id = $1 AND shop_id = ANY($2::uuid[])
      `,
      [userId, shopIds]
    ),
    db.query(
      `
        SELECT shop_id, order_count
        FROM shop_customer_stats
        WHERE customer_id = $1 AND shop_id = ANY($2::uuid[])
      `,
      [userId, shopIds]
    ),
  ]);

  const favoriteSet = new Set(favoritesResult.rows.map((row) => row.shop_id));
  const repeatMap = new Map(
    repeatsResult.rows.map((row) => [row.shop_id, Number(row.order_count)])
  );

  // Apply ranking score and filter
  const recommended = result.rows
    .map((row) => {
      const isFavorite = favoriteSet.has(row.id);
      const repeatOrderCount = repeatMap.get(row.id) || 0;
      const distance = Math.round(Number(row.distance_meters || 0));
      const score = computeRankingScore({
        baseScore: 50, // baseline score for nearby shops
        isFavorite,
        repeatOrderCount,
      });

      return {
        shopId: row.id,
        name: row.name,
        category: row.category,
        rating: Number(row.rating || 0),
        deliveryTag: getDeliveryTag(distance),
        score,
        _distance: distance, // internal only
      };
    })
    .sort((a, b) => b.score - a.score || a._distance - b._distance)
    .slice(0, limit)
    .map(({ score: _score, _distance: _internalDistance, ...item }) => item);

  return recommended;
}

async function getPopularShops({ db, limit = 10 }) {
  console.log("Fetching popular shops");
  
  const result = await db.query(`
    SELECT 
      id,
      name,
      category,
      COALESCE(rating_avg, 0) AS rating
    FROM shops
    WHERE COALESCE(is_active, TRUE) = TRUE
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    shopId: row.id,
    name: row.name,
    category: row.category,
    rating: Number(row.rating || 0),
  }));
}

async function getTrendingShops({ db, limit = 10 }) {
  console.log("Fetching trending shops");
  
  const result = await db.query(`
    SELECT 
      s.id,
      s.name,
      s.category,
      COALESCE(s.rating_avg, 0) AS rating,
      COUNT(o.id) AS order_count
    FROM shops s
    LEFT JOIN orders o ON o.shop_id = s.id 
      AND o.status = 'DELIVERED'
    WHERE COALESCE(s.is_active, TRUE) = TRUE
    GROUP BY s.id
    ORDER BY COUNT(o.id) DESC, s.created_at DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    shopId: row.id,
    name: row.name,
    category: row.category,
    rating: Number(row.rating || 0),
    orderCount: Number(row.order_count || 0),
  }));
}

async function personalizedRecommendations({ preferences, userLat, userLng, db, limit = 20 }) {
  console.log("Generating personalized recommendations");
  
  if (!preferences || preferences.length === 0) {
    return [];
  }

  const recommended = [];
  const seenShops = new Set();

  // For each preferred search, find matching shops
  for (const pref of preferences) {
    const query = pref.query;
    
    // Simple query-based search: shops matching the preference
    const result = await db.query(`
      SELECT
        s.id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE (s.name ILIKE $1 OR s.category ILIKE $1)
        AND COALESCE(s.is_active, TRUE) = TRUE
        AND ST_DWithin(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography,
          5000
        )
      ORDER BY distance_meters ASC
      LIMIT $4
    `, [`%${query}%`, userLat, userLng, 6]);

    for (const row of result.rows) {
      if (!seenShops.has(row.id)) {
        const distance = Math.round(Number(row.distance_meters || 0));
        recommended.push({
          shopId: row.id,
          name: row.name,
          category: row.category,
          rating: Number(row.rating || 0),
          deliveryTag: getDeliveryTag(distance),
        });
        seenShops.add(row.id);
      }
    }
  }

  return recommended.slice(0, limit);
}

async function getHomepage({ userId, userLat, userLng, db }) {
  console.log("Building homepage for userId:", userId, { lat: userLat, lng: userLng });

  // Get user search preferences for personalization
  let userPreferences = [];
  try {
    const trackingService = require("../../tracking-service/src/tracking-service");
    userPreferences = await trackingService.getUserSearchPreferences(db, userId, 3);
    console.log("User preferences:", userPreferences);
  } catch (err) {
    console.warn("[home] Failed to get user preferences:", err.message);
  }

  // Batch fetch all sections with fallbacks
  let [favorites, regularShops, recommendedShops] = await Promise.all([
    getFavoriteShops({ userId, db, limit: 10 }),
    getRegularShops({ userId, db, limit: 10 }),
    getRecommendedShops({ userId, userLat, userLng, db, limit: 20 }),
  ]);

  // Fallback for empty favorites
  if (!favorites || favorites.length === 0) {
    console.log("No favorites found, using popular shops");
    favorites = await getPopularShops({ db, limit: 10 });
  }

  // Fallback for empty regular shops
  if (!regularShops || regularShops.length === 0) {
    console.log("No regular shops found, using trending shops");
    regularShops = await getTrendingShops({ db, limit: 10 });
  }

  // Personalized recommendations based on search history
  if (userPreferences && userPreferences.length > 0) {
    console.log("Using personalized recommendations");
    recommendedShops = await personalizedRecommendations({ 
      preferences: userPreferences, 
      userLat, 
      userLng, 
      db, 
      limit: 20 
    });
  }

  // Ensure recommended has diversity (fallback if empty)
  if (!recommendedShops || recommendedShops.length === 0) {
    console.log("No recommended shops found, using trending shops");
    recommendedShops = await getTrendingShops({ db, limit: 20 });
  }

  console.log("Homepage sections ready", {
    favoritesCount: favorites.length,
    regularShopsCount: regularShops.length,
    recommendedCount: recommendedShops.length,
  });

  return {
    favorites: favorites || [],
    regularShops: regularShops || [],
    recommended: recommendedShops || [],
    categories: STATIC_CATEGORIES,
  };
}

async function getShopsByCategory({ category, userLat, userLng, db, limit = 20 }) {
  console.log("Fetching shops for category:", category);

  const result = await db.query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE s.category = $1
        AND COALESCE(s.is_active, TRUE) = TRUE
        AND ST_DWithin(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography,
          5000
        )
      ORDER BY distance_meters ASC
      LIMIT $4
    `,
    [category, userLat, userLng, limit]
  );

  return result.rows.map((row) => {
    const distance = Math.round(Number(row.distance_meters || 0));
    return {
      shopId: row.id,
      name: row.name,
      category: row.category,
      rating: Number(row.rating || 0),
      deliveryTag: getDeliveryTag(distance),
    };
  });
}

module.exports = {
  getHomepage,
  getShopsByCategory,
  STATIC_CATEGORIES,
};
