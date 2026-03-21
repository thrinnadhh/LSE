const { z } = require("zod");
const { openSearchRequest } = require("../../../apps/api-gateway/src/lib/search");

const PRODUCTS_INDEX = "products_index";

const searchProductsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().max(50000).optional(),
});

// Support both 'lng' and 'lon' (common test tool alias)
const searchShopsSchema = z.object({
  q: z.string().trim().optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().positive().max(50000).optional(),
});

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

function splitSearchTerms(query) {
  return String(query || "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

async function fallbackSearchByTerms({ db, lat, lng, terms, limit = 20 }) {
  if (!terms || terms.length === 0) {
    return [];
  }

  const patterns = terms.map((term) => `%${term}%`);
  const wholeQueryPattern = `%${terms.join(" ")}%`;
  const result = await db.query(
    `
      SELECT
        s.id,
        s.name,
        COALESCE(s.rating_avg, 0) AS rating,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT p.name), NULL) AS matched_products,
        MAX(
          CASE
            WHEN LOWER(p.name) ILIKE $5 THEN 3
            WHEN LOWER(s.name) ILIKE $5 THEN 2
            WHEN LOWER(COALESCE(s.category::text, '')) ILIKE $5 THEN 1
            ELSE 0
          END
        ) AS relevance,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      JOIN products p ON p.shop_id = s.id
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND COALESCE(p.is_active, TRUE) = TRUE
        AND ST_DWithin(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography,
          5000
        )
        AND (
          LOWER(p.name) ILIKE ANY($4::text[])
          OR LOWER(s.name) ILIKE ANY($4::text[])
          OR LOWER(COALESCE(s.category::text, '')) ILIKE ANY($4::text[])
        )
      GROUP BY s.id, s.name, s.rating_avg, distance_meters, s.created_at
      ORDER BY relevance DESC, s.created_at DESC
      LIMIT $1
    `,
    [limit, lat, lng, patterns, wholeQueryPattern]
  );

  return result.rows.map((row) => {
    const distance = Math.round(Number(row.distance_meters || 0));
    return {
      shopId: row.id,
      name: row.name,
      rating: Number(row.rating || 0),
      matchedProducts: Array.isArray(row.matched_products) ? row.matched_products.slice(0, 5) : [],
      deliveryTag: getDeliveryTag(distance),
    };
  });
}

async function fallbackSearch({ db, lat, lng, limit = 20 }) {
  const result = await db.query(
    `
      SELECT
        s.id,
        s.name,
        COALESCE(s.rating_avg, 0) AS rating,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($3, $2), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE COALESCE(s.is_active, TRUE) = TRUE
      ORDER BY s.created_at DESC
      LIMIT $1
    `,
    [limit, lat, lng]
  );

  return result.rows.map((shop) => ({
    shopId: shop.id,
    name: shop.name,
    rating: Number(shop.rating || 0),
    matchedProducts: [],
    deliveryTag: "Nearby",
  }));
}

async function ensureProductsIndex() {
  try {
    await openSearchRequest(`/${PRODUCTS_INDEX}`, {
      method: "PUT",
      body: {
        mappings: {
          properties: {
            product_id: { type: "keyword" },
            shop_id: { type: "keyword" },
            shop_name: { type: "text" },
            product_name: { type: "text" },
            category: { type: "keyword" },
            price: { type: "float" },
            location: { type: "geo_point" },
          },
        },
      },
    });
  } catch (err) {
    const message = String(err.message || "");
    if (!message.includes("resource_already_exists_exception") && !message.includes("already exists")) {
      throw err;
    }
  }
}

async function buildProductSearchDocument({ productId, db }) {
  const result = await db.query(
    `
      SELECT
        p.id AS product_id,
        p.shop_id,
        p.name AS product_name,
        p.category,
        p.price,
        s.name AS shop_name,
        ST_Y(COALESCE(sl.location, s.location)::geometry) AS lat,
        ST_X(COALESCE(sl.location, s.location)::geometry) AS lng
      FROM products p
      JOIN shops s ON s.id = p.shop_id
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE p.id = $1
      LIMIT 1
    `,
    [productId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    product_id: row.product_id,
    shop_id: row.shop_id,
    shop_name: row.shop_name,
    product_name: row.product_name,
    category: row.category,
    price: Number(row.price),
    location: {
      lat: Number(row.lat),
      lon: Number(row.lng),
    },
  };
}

async function indexProductDocument({ productId, db }) {
  const document = await buildProductSearchDocument({ productId, db });

  if (!document) {
    return null;
  }

  await openSearchRequest(`/${PRODUCTS_INDEX}/_doc/${productId}`, {
    method: "PUT",
    body: document,
  });

  return document;
}

async function searchProducts({ query }) {
  const input = searchProductsSchema.parse(query);
  const radiusInKm = input.radius / 1000;

  const must = input.q
    ? {
        multi_match: {
          query: input.q,
          fields: ["product_name"],
        },
      }
    : { match_all: {} };

  const response = await openSearchRequest(`/${PRODUCTS_INDEX}/_search`, {
    method: "POST",
    body: {
      size: 20,
      query: {
        bool: {
          must,
          filter: {
            geo_distance: {
              distance: `${radiusInKm}km`,
              location: {
                lat: input.lat,
                lon: input.lng,
              },
            },
          },
        },
      },
      sort: [
        {
          _geo_distance: {
            location: {
              lat: input.lat,
              lon: input.lng,
            },
            order: "asc",
            unit: "m",
            distance_type: "arc",
          },
        },
      ],
    },
  });

  return (response.hits?.hits || []).map((hit) => ({
    productId: hit._source.product_id,
    shopId: hit._source.shop_id,
    productName: hit._source.product_name,
    shopName: hit._source.shop_name,
    category: hit._source.category,
    price: hit._source.price,
  }));
}

async function searchShops({ query, db, userId = null }) {
  const input = searchShopsSchema.parse(query);
  // Resolve longitude — support both 'lng' and 'lon'
  const resolvedLng = input.lng ?? input.lon;
  if (resolvedLng === undefined) {
    const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
    throw new ApiError(400, "lat and lng (or lon) are required");
  }
  input.lng = resolvedLng;
  const radiusInKm = (input.radius ?? 5000) / 1000;
  const normalizedQuery = String(input.q || "").toLowerCase().trim();
  const terms = splitSearchTerms(normalizedQuery);

  if (!normalizedQuery) {
    return fallbackSearch({ db, lat: input.lat, lng: input.lng, limit: 20 });
  }

  // Track search event for personalization
  if (userId) {
    try {
      const trackingService = require("../../tracking-service/src/tracking-service");
      trackingService.trackEvent(db, userId, "SEARCH", null, { query: input.q });
    } catch (err) {
      console.error("[search] Failed to track search event:", err.message);
    }
  }

  let response;
  try {
    response = await openSearchRequest(`/${PRODUCTS_INDEX}/_search`, {
      method: "POST",
      body: {
        size: 120,
        _source: ["shop_id", "product_name", "shop_name"],
        query: {
          bool: {
            must: {
              multi_match: {
                query: input.q,
                fields: ["product_name^3", "shop_name"],
              },
            },
            filter: {
              geo_distance: {
                distance: `${radiusInKm}km`,
                location: {
                  lat: input.lat,
                  lon: input.lng,
                },
              },
            },
          },
        },
      },
    });
  } catch (err) {
    console.warn("[search] OpenSearch failed, using fallback:", err.message);
    response = { hits: { hits: [] } };
  }

  const hits = response.hits?.hits || [];
  if (hits.length === 0) {
    let results = await fallbackSearchByTerms({
      db,
      lat: input.lat,
      lng: input.lng,
      terms,
      limit: 20,
    });

    if (!results.length) {
      results = await fallbackSearch({ db, lat: input.lat, lng: input.lng, limit: 20 });
    }

    return results;
  }

  const shopMatches = new Map();
  for (const hit of hits) {
    const source = hit._source || {};
    const shopId = source.shop_id;
    if (!shopId) {
      continue;
    }

    if (!shopMatches.has(shopId)) {
      shopMatches.set(shopId, {
        shopId,
        matchedProducts: new Set(),
        baseScore: Number(hit._score || 0),
      });
    }

    const entry = shopMatches.get(shopId);
    if (source.product_name) {
      entry.matchedProducts.add(source.product_name);
    }
    entry.baseScore = Math.max(entry.baseScore, Number(hit._score || 0));
  }

  const shopIds = Array.from(shopMatches.keys());
  const shopRows = await db.query(
    `
      SELECT
        s.id,
        s.name,
        COALESCE(s.rating_avg, 0) AS rating,
        ST_Distance(
          COALESCE(sl.location, s.location),
          ST_SetSRID(ST_Point($2, $1), 4326)::geography
        ) AS distance_meters
      FROM shops s
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      WHERE s.id = ANY($3::uuid[])
        AND COALESCE(s.is_active, TRUE) = TRUE
    `,
    [input.lat, input.lng, shopIds]
  );

  const shopById = new Map(shopRows.rows.map((row) => [row.id, row]));

  let favoriteSet = new Set();
  let repeatMap = new Map();

  if (userId) {
    const [favoritesResult, repeatsResult] = await Promise.all([
      db.query(
        `
          SELECT shop_id
          FROM favorite_shops
          WHERE user_id = $1
            AND shop_id = ANY($2::uuid[])
        `,
        [userId, shopIds]
      ),
      db.query(
        `
          SELECT shop_id, order_count
          FROM shop_customer_stats
          WHERE user_id = $1
            AND shop_id = ANY($2::uuid[])
        `,
        [userId, shopIds]
      ),
    ]);

    favoriteSet = new Set(favoritesResult.rows.map((row) => row.shop_id));
    repeatMap = new Map(repeatsResult.rows.map((row) => [row.shop_id, Number(row.order_count)]));
  }

  let results = shopIds
    .map((shopId) => {
      const shop = shopById.get(shopId);
      if (!shop) {
        return null;
      }

      const matchedProducts = Array.from(shopMatches.get(shopId).matchedProducts).slice(0, 5);
      const distance = Math.round(Number(shop.distance_meters || 0));
      const isFavorite = favoriteSet.has(shopId);
      const repeatOrderCount = repeatMap.get(shopId) || 0;
      const baseScore = shopMatches.get(shopId).baseScore || 0;
      const score = computeRankingScore({
        baseScore,
        isFavorite,
        repeatOrderCount,
      });

      return {
        shopId,
        name: shop.name,
        rating: Number(shop.rating || 0),
        matchedProducts,
        score,
        deliveryTag: getDeliveryTag(distance),
        _distanceForTieBreak: distance,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a._distanceForTieBreak - b._distanceForTieBreak)
    .map(({ score: _score, _distanceForTieBreak: _internalDistance, ...item }) => item);

  if (!results.length) {
    results = await fallbackSearchByTerms({
      db,
      lat: input.lat,
      lng: input.lng,
      terms,
      limit: 20,
    });
  }

  if (!results.length) {
    results = await fallbackSearch({ db, lat: input.lat, lng: input.lng, limit: 20 });
  }

  return results;
}

module.exports = {
  ensureProductsIndex,
  indexProductDocument,
  searchProducts,
  searchShops,
};