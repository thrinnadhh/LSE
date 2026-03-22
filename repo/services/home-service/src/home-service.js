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

function computeRecommendationScore({ preferenceScore, repeatOrderScore, rating, distanceMeters }) {
  const distanceKm = Number.isFinite(distanceMeters) ? distanceMeters / 1000 : null;
  const distanceScore = distanceKm === null ? 0 : Math.max(0, 5 - distanceKm);

  return (
    Number(preferenceScore || 0) * 3 +
    Number(repeatOrderScore || 0) * 2 +
    Number(rating || 0) * 1.5 +
    distanceScore
  );
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
  const result = await db.query(
    `
      SELECT
        s.id,
        s.name,
        s.category,
        COALESCE(s.rating_avg, 0) AS rating,
        COALESCE(up.score, 0) AS preference_score,
        COALESCE(scs.order_count, 0) AS repeat_order_score,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      LEFT JOIN user_preferences up
        ON up.shop_id = s.id AND up.user_id = $4
      LEFT JOIN shop_customer_stats scs
        ON scs.shop_id = s.id AND scs.customer_id = $4
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND ST_DWithin(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography,
          5000
        )
      ORDER BY distance_meters ASC
      LIMIT $1
    `,
    [limit * 2, userLat, userLng, userId]
  );

  const recommended = result.rows
    .map((row) => {
      const distance = Math.round(Number(row.distance_meters || 0));
      const score = computeRecommendationScore({
        preferenceScore: row.preference_score,
        repeatOrderScore: row.repeat_order_score,
        rating: Number(row.rating || 0),
        distanceMeters: row.distance_meters,
      });

      return {
        shopId: row.id,
        name: row.name,
        category: row.category,
        rating: Number(row.rating || 0),
        deliveryTag: getDeliveryTag(distance),
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (recommended.length === 0) {
    return getPopularShops({ db, limit });
  }

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

async function getPersonalizedRecommended({ userId, userLat, userLng, db, limit = 20 }) {
  console.log("[Phase 14.1] Fetching personalized recommendations for user:", userId);
  
  try {
    // STEP 1: GET USER SEARCH HISTORY
    const searchHistoryResult = await db.query(`
      SELECT metadata->>'query' AS query, COUNT(*) AS freq
      FROM user_events
      WHERE user_id = $1
      AND event_type = 'SEARCH'
      GROUP BY query
      ORDER BY freq DESC
      LIMIT 5
    `, [userId]);

    const topQueries = searchHistoryResult.rows.map(row => row.query);
    console.log("[Phase 14.1] Top search queries:", topQueries);

    if (!topQueries || topQueries.length === 0) {
      console.log("[Phase 14.1] No search history found");
      return [];
    }

    // STEP 2: FETCH SHOPS BASED ON USER INTEREST
    let recommended = [];
    
    for (const query of topQueries) {
      try {
        const shops = await db.query(`
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
          WHERE (s.name ILIKE $1 OR s.category::text ILIKE $1)
            AND COALESCE(s.is_active, TRUE) = TRUE
            AND ST_DWithin(
              COALESCE(sl.location, s.location),
              ST_SetSRID(ST_Point($3, $2), 4326)::geography,
              5000
            )
          ORDER BY distance_meters ASC
          LIMIT 5
        `, [`%${query}%`, userLat, userLng]);

        recommended.push(...shops.rows);
      } catch (err) {
        console.warn("[Phase 14.1] Error fetching shops for query:", query, err.message);
      }
    }

    // STEP 3: REMOVE DUPLICATES
    const unique = new Map();
    recommended.forEach(row => {
      const distance = Math.round(Number(row.distance_meters || 0));
      const shop = {
        shopId: row.id,
        name: row.name,
        category: row.category,
        rating: Number(row.rating || 0),
        deliveryTag: getDeliveryTag(distance),
      };
      unique.set(row.id, shop);
    });

    // STEP 4: LIMIT RESULTS
    const result = Array.from(unique.values()).slice(0, limit);
    console.log("[Phase 14.1] Personalized recommendations:", result.length);
    return result;
  } catch (err) {
    console.error("[Phase 14.1] Error generating personalized recommendations:", err.message);
    return [];
  }
}

async function getHomepage({ userId, userLat, userLng, db }) {
  console.log("Building homepage for userId:", userId, { lat: userLat, lng: userLng });

  // Batch fetch favorites, regularShops, and recommended sections
  let [favorites, regularShops] = await Promise.all([
    getFavoriteShops({ userId, db, limit: 10 }),
    getRegularShops({ userId, db, limit: 10 }),
  ]);

  // Behavior-based recommendations (Phase 13.2)
  let recommended = [];
  try {
    recommended = await getRecommendedShops({
      userId,
      userLat,
      userLng,
      db,
      limit: 20,
    });
  } catch (err) {
    console.warn("[home] Behavior-based recommendations failed:", err.message);
  }

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

  // Fallback for empty recommendations — use popular shops
  if (!recommended || recommended.length === 0) {
    console.log("[Phase 13.2] No behavior data, using popular shops fallback");
    recommended = await getPopularShops({ db, limit: 20 });
  }

  console.log("Homepage sections ready", {
    favoritesCount: favorites.length,
    regularShopsCount: regularShops.length,
    recommendedCount: recommended.length,
    recommendedPersonalized: recommended.length > 0,
  });

  return {
    favorites: favorites || [],
    regularShops: regularShops || [],
    recommended: recommended || [],
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
