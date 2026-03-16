const { z } = require("zod");
const { openSearchRequest } = require("../../../apps/api-gateway/src/lib/search");

const PRODUCTS_INDEX = "products_index";

const searchProductsSchema = z.object({
  q: z.string().trim().min(1).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50000),
});

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
        { _score: "desc" },
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
    distance: hit.sort?.[1] !== undefined ? Number(hit.sort[1]) : undefined,
  }));
}

module.exports = {
  ensureProductsIndex,
  indexProductDocument,
  searchProducts,
};