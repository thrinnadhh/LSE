/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const { Pool } = require("pg");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const BASE_URL = process.env.E2E_BASE_URL || "http://localhost:8080";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

const summary = {
  shopSearch: "FAIL",
  favorites: "FAIL",
  ranking: "FAIL",
  repeatTracking: "FAIL",
  regularShops: "FAIL",
  compatibility: "FAIL",
};

const details = {
  categorySupport: "FAIL",
  performance: {
    avgMs: null,
    p95Ms: null,
    thresholdMs: 100,
  },
  checks: {},
};

const detectedBugs = [];
const missingFeatures = [];
const performanceIssues = [];

function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (_err) {
      parsed = { raw: text };
    }

    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function request(method, path, { body, token, timeoutMs } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return fetchWithTimeout(
    BASE_URL + path,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    timeoutMs || 15000
  );
}

async function auth(phone, role, deviceId) {
  const send = await request("POST", "/auth/send-otp", {
    body: { phone },
    timeoutMs: 12000,
  });

  if (send.status !== 200 || !send.body?.otp) {
    throw new Error(`auth send-otp failed for ${phone}`);
  }

  const verify = await request("POST", "/auth/verify-otp", {
    body: {
      phone,
      otp: send.body.otp,
      role,
      deviceId,
    },
    timeoutMs: 12000,
  });

  if (verify.status !== 200 || !verify.body?.accessToken) {
    throw new Error(`auth verify-otp failed for ${phone}`);
  }

  return verify.body.accessToken;
}

function createMessageCollector(ws) {
  const messages = [];
  const onMessage = (raw) => {
    try {
      messages.push(JSON.parse(raw.toString()));
    } catch (_err) {
      messages.push({ type: "INVALID_JSON" });
    }
  };

  ws.on("message", onMessage);

  async function waitFor(predicate, timeoutMs = 12000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = messages.find(predicate);
      if (found) {
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("websocket wait timeout");
  }

  return {
    messages,
    waitFor,
    close() {
      ws.off("message", onMessage);
    },
  };
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE_URL.replace(/^http/, "ws") + "/ws");
    const timeout = setTimeout(() => {
      reject(new Error("websocket connect timeout"));
    }, 10000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "AUTH", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "AUTH_OK") {
        clearTimeout(timeout);
        resolve(ws);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function passFail(ok) {
  return ok ? "PASS" : "FAIL";
}

async function run() {
  const seed = String(Date.now()).slice(-7);
  const phones = {
    ownerA: `731${seed}1`,
    ownerB: `731${seed}2`,
    customer: `731${seed}3`,
    driver: `731${seed}4`,
  };

  const state = {
    tokens: {},
    shops: {},
    products: {},
    conversationId: null,
    quoteId: null,
    orderId: null,
    driverId: null,
  };

  try {
    state.tokens.ownerA = await auth(phones.ownerA, "shop_owner", `ownerA-${seed}`);
    state.tokens.ownerB = await auth(phones.ownerB, "shop_owner", `ownerB-${seed}`);
    state.tokens.customer = await auth(phones.customer, "customer", `customer-${seed}`);
    state.tokens.driver = await auth(phones.driver, "driver", `driver-${seed}`);
  } catch (err) {
    detectedBugs.push(`Authentication bootstrap failed: ${err.message}`);
    throw err;
  }

  // Test 8: category support
  try {
    const shopA = await request("POST", "/shops", {
      token: state.tokens.ownerA,
      body: {
        name: `Shop A ${seed}`,
        category: "grocery",
        phone: `90000${seed}`,
        lat: 17.385,
        lng: 78.4867,
      },
    });

    const shopB = await request("POST", "/shops", {
      token: state.tokens.ownerB,
      body: {
        name: `Shop B ${seed}`,
        category: "pet_store",
        phone: `90001${seed}`,
        lat: 17.388,
        lng: 78.4895,
      },
    });

    const shopC = await request("POST", "/shops", {
      token: state.tokens.ownerA,
      body: {
        name: `Shop C ${seed}`,
        category: "electronics",
        phone: `90002${seed}`,
        lat: 17.387,
        lng: 78.4882,
      },
    });

    const categoryOk = shopA.status === 201 && shopB.status === 201 && shopC.status === 201;
    details.categorySupport = passFail(categoryOk);

    if (!categoryOk) {
      missingFeatures.push("Shop category extension did not accept all required categories (grocery, pet_store, electronics)");
    }

    state.shops.A = shopA.body.id;
    state.shops.B = shopB.body.id;
    state.shops.C = shopC.body.id;

    await pool.query(
      `
        UPDATE shops
        SET rating_avg = CASE
          WHEN id = $1 THEN 4.6
          WHEN id = $2 THEN 4.4
          WHEN id = $3 THEN 4.1
          ELSE rating_avg
        END,
        rating_count = CASE
          WHEN id = $1 THEN 210
          WHEN id = $2 THEN 185
          WHEN id = $3 THEN 130
          ELSE rating_count
        END
        WHERE id = ANY($4::uuid[])
      `,
      [state.shops.A, state.shops.B, state.shops.C, [state.shops.A, state.shops.B, state.shops.C]]
    );
  } catch (err) {
    details.categorySupport = "FAIL";
    detectedBugs.push(`Category setup failed: ${err.message}`);
  }

  // Create products used by search and quote/order flow
  try {
    const productA1 = await request("POST", "/products", {
      token: state.tokens.ownerA,
      body: {
        shopId: state.shops.A,
        name: "Milk 1L",
        category: "dairy",
        price: 60,
        stock: 100,
      },
    });

    const productA2 = await request("POST", "/products", {
      token: state.tokens.ownerA,
      body: {
        shopId: state.shops.A,
        name: "Curd Cup",
        category: "dairy",
        price: 35,
        stock: 100,
      },
    });

    const productB1 = await request("POST", "/products", {
      token: state.tokens.ownerB,
      body: {
        shopId: state.shops.B,
        name: "Milk 1L",
        category: "dairy",
        price: 40,
        stock: 100,
      },
    });

    state.products.AMilk = productA1.body.id;
    state.products.ACurd = productA2.body.id;
    state.products.BMilk = productB1.body.id;

    if (productA1.status !== 201 || productA2.status !== 201 || productB1.status !== 201) {
      detectedBugs.push("Product bootstrap failed; search and order tests may be invalid");
    }
  } catch (err) {
    detectedBugs.push(`Product setup failed: ${err.message}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Test 1: shop-first search shape
  let searchBaseline = null;
  let searchGeo = null;
  try {
    searchBaseline = await request("GET", "/search/shops?q=milk", {});
    const baselineOk = searchBaseline.status === 200;
    details.checks.shopSearchWithoutGeo = baselineOk;

    if (!baselineOk) {
      missingFeatures.push("/search/shops currently requires lat/lng, but spec expects /search/shops?q=milk to work");
    }

    searchGeo = await request(
      "GET",
      "/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000",
      {}
    );

    const items = searchGeo.body?.items || [];
    const shapeOk =
      searchGeo.status === 200
      && Array.isArray(items)
      && items.length > 0
      && items.every((item) => item.shopId && item.name && Array.isArray(item.matchedProducts))
      && items.every((item) => item.productId === undefined && item.price === undefined);

    summary.shopSearch = passFail(shapeOk && baselineOk);

    if (!shapeOk) {
      detectedBugs.push("Shop search response shape is invalid or contains product-level fields");
    }
  } catch (err) {
    summary.shopSearch = "FAIL";
    detectedBugs.push(`Shop search test failed: ${err.message}`);
  }

  // Test 2: no price-priority, distance+rating relevance
  let rankingPreFavorite = [];
  try {
    const items = searchGeo?.body?.items || [];
    rankingPreFavorite = items;

    const indexA = items.findIndex((item) => item.shopId === state.shops.A);
    const indexB = items.findIndex((item) => item.shopId === state.shops.B);

    const hasBoth = indexA !== -1 && indexB !== -1;
    const notPriceSorted = hasBoth ? indexA < indexB : false; // Shop A is costlier milk but should rank higher via distance/rating.

    const rankingSignalsPresent = items.every((item) => typeof item.distance === "number" && typeof item.rating === "number");

    const t2ok = hasBoth && notPriceSorted && rankingSignalsPresent;
    details.checks.noPricePriority = t2ok;

    if (!t2ok) {
      detectedBugs.push("Ranking appears price-driven or lacks distance/rating influence");
    }
  } catch (err) {
    details.checks.noPricePriority = false;
    detectedBugs.push(`No price-priority test failed: ${err.message}`);
  }

  // Test 3 + Test 4: favorites and favorite boost
  let favoriteTargetShopId = state.shops.B;
  try {
    const preRanks = new Map(rankingPreFavorite.map((item, index) => [item.shopId, index]));

    if (!preRanks.has(favoriteTargetShopId) && rankingPreFavorite.length > 1) {
      favoriteTargetShopId = rankingPreFavorite[1].shopId;
    }

    const addFavorite = await request("POST", `/users/favorites/${favoriteTargetShopId}`, {
      token: state.tokens.customer,
    });

    const listFavorites = await request("GET", "/users/favorites", {
      token: state.tokens.customer,
    });

    const appearsInFavorites =
      listFavorites.status === 200
      && Array.isArray(listFavorites.body?.items)
      && listFavorites.body.items.some((item) => item.shopId === favoriteTargetShopId);

    const searchAfterFavorite = await request(
      "GET",
      "/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000",
      { token: state.tokens.customer }
    );

    const afterItems = searchAfterFavorite.body?.items || [];
    const afterRank = afterItems.findIndex((item) => item.shopId === favoriteTargetShopId);
    const beforeRank = preRanks.has(favoriteTargetShopId) ? preRanks.get(favoriteTargetShopId) : Number.MAX_SAFE_INTEGER;
    const boosted = afterRank !== -1 && afterRank < beforeRank;

    const deleteFavorite = await request("DELETE", `/users/favorites/${favoriteTargetShopId}`, {
      token: state.tokens.customer,
    });

    const favoritesOk = addFavorite.status === 201 && appearsInFavorites && deleteFavorite.status === 200;
    const rankingBoostOk = boosted;

    summary.favorites = passFail(favoritesOk);
    details.checks.favoriteBoost = rankingBoostOk;

    if (!favoritesOk) {
      detectedBugs.push("Favorite shop add/list/delete flow failed");
    }

    if (!rankingBoostOk) {
      detectedBugs.push("Favorite boost did not improve rank for a favorited shop");
    }
  } catch (err) {
    summary.favorites = "FAIL";
    details.checks.favoriteBoost = false;
    detectedBugs.push(`Favorites tests failed: ${err.message}`);
  }

  // Test 5 + Test 7: order lifecycle, repeat tracking, chat, tracking compatibility
  let compatibilityOrderCreation = false;
  let compatibilityDriverAssignment = false;
  let compatibilityTracking = false;
  let compatibilityChat = false;
  try {
    const driverLocation = await request("POST", "/drivers/location", {
      token: state.tokens.driver,
      body: { lat: 17.3852, lng: 78.4868 },
      timeoutMs: 15000,
    });

    state.driverId = driverLocation.body?.driverId;

    const conversation = await request("POST", "/conversations", {
      token: state.tokens.customer,
      body: { shopId: state.shops.A },
    });

    state.conversationId = conversation.body?.id;

    const sendMessage = await request("POST", "/messages", {
      token: state.tokens.customer,
      body: {
        conversationId: state.conversationId,
        message: "Need milk and curd",
      },
    });

    const fetchMessages = await request("GET", `/conversations/${state.conversationId}/messages`, {
      token: state.tokens.customer,
    });

    compatibilityChat =
      sendMessage.status === 201
      && fetchMessages.status === 200
      && Array.isArray(fetchMessages.body?.items)
      && fetchMessages.body.items.length > 0;

    const quote = await request("POST", "/quotes", {
      token: state.tokens.ownerA,
      body: {
        conversationId: state.conversationId,
        items: [
          { productId: state.products.AMilk, quantity: 1, price: 60 },
          { productId: state.products.ACurd, quantity: 1, price: 35 },
        ],
      },
    });

    state.quoteId = quote.body?.quoteId;

    const acceptQuote = await request("POST", `/quotes/${state.quoteId}/accept`, {
      token: state.tokens.customer,
      body: {},
    });

    state.orderId = acceptQuote.body?.orderId;
    compatibilityOrderCreation = acceptQuote.status === 200 && !!state.orderId;

    let currentOrder = null;
    for (let i = 0; i < 12; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const order = await request("GET", `/orders/${state.orderId}`, {
        token: state.tokens.customer,
      });
      if (order.status === 200) {
        currentOrder = order.body;
      }
      if (currentOrder?.status === "ASSIGNED" && currentOrder?.driverId) {
        break;
      }
    }

    if (!currentOrder?.driverId && state.driverId) {
      const adminToken = jwt.sign(
        { sub: randomUUID(), role: "admin" },
        JWT_SECRET,
        { expiresIn: "15m" }
      );

      await request("POST", `/orders/${state.orderId}/assign-driver`, {
        token: adminToken,
        body: { driverId: state.driverId },
        timeoutMs: 15000,
      });

      const order = await request("GET", `/orders/${state.orderId}`, {
        token: state.tokens.customer,
      });
      currentOrder = order.body;
    }

    compatibilityDriverAssignment = !!currentOrder?.driverId;

    const customerWs = await connectWs(state.tokens.customer);
    const driverWs = await connectWs(state.tokens.driver);
    const customerCollector = createMessageCollector(customerWs);

    try {
      customerWs.send(JSON.stringify({ type: "SUBSCRIBE_ORDER", orderId: state.orderId }));
      await customerCollector.waitFor((msg) => msg.type === "SUBSCRIBED_ORDER" && msg.orderId === state.orderId, 12000);

      driverWs.send(
        JSON.stringify({
          type: "DRIVER_LOCATION",
          orderId: state.orderId,
          lat: 17.386,
          lng: 78.487,
          speed: 30,
          heading: 90,
        })
      );

      const locationEvent = await customerCollector.waitFor(
        (msg) => msg.type === "DRIVER_LOCATION_UPDATE" && msg.orderId === state.orderId,
        12000
      );
      const etaEvent = await customerCollector.waitFor(
        (msg) => msg.type === "ETA_UPDATE" && msg.orderId === state.orderId,
        12000
      );

      compatibilityTracking = !!locationEvent && !!etaEvent;
    } finally {
      customerCollector.close();
      customerWs.close();
      driverWs.close();
    }

    await request("POST", `/orders/${state.orderId}/pickup`, {
      token: state.tokens.driver,
      timeoutMs: 15000,
    });
    await request("POST", `/orders/${state.orderId}/start-delivery`, {
      token: state.tokens.driver,
      timeoutMs: 15000,
    });
    await request("POST", `/orders/${state.orderId}/complete`, {
      token: state.tokens.driver,
      timeoutMs: 15000,
    });

    const stats = await pool.query(
      `
        SELECT order_count, last_order_at
        FROM shop_customer_stats
        WHERE shop_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [state.shops.A, jwt.decode(state.tokens.customer).sub]
    );

    const repeatOk =
      stats.rowCount > 0
      && Number(stats.rows[0].order_count) >= 1
      && !!stats.rows[0].last_order_at;

    summary.repeatTracking = passFail(repeatOk);

    if (!repeatOk) {
      detectedBugs.push("shop_customer_stats was not updated on order completion");
    }
  } catch (err) {
    summary.repeatTracking = "FAIL";
    detectedBugs.push(`Order/repeat/compatibility flow failed: ${err.message}`);
  }

  // Test 6: regular shops
  try {
    const regularShops = await request("GET", "/users/regular-shops", {
      token: state.tokens.customer,
    });

    const items = regularShops.body?.items || [];
    const hasShopA = items.some((item) => item.shopId === state.shops.A && Number(item.orderCount) >= 1);
    const sorted = items.every((item, index) => index === 0 || Number(items[index - 1].orderCount) >= Number(item.orderCount));
    const ok = regularShops.status === 200 && Array.isArray(items) && hasShopA && sorted;

    summary.regularShops = passFail(ok);

    if (!ok) {
      detectedBugs.push("/users/regular-shops did not return expected order_count ordering");
    }
  } catch (err) {
    summary.regularShops = "FAIL";
    detectedBugs.push(`Regular shops test failed: ${err.message}`);
  }

  // Test 9: performance
  try {
    const latencies = [];
    for (let i = 0; i < 15; i += 1) {
      const start = nowMs();
      const response = await request(
        "GET",
        "/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000",
        {}
      );
      const end = nowMs();
      if (response.status !== 200) {
        throw new Error(`search status ${response.status}`);
      }
      latencies.push(end - start);
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

    details.performance.avgMs = Number(avg.toFixed(2));
    details.performance.p95Ms = p95;

    if (avg >= details.performance.thresholdMs) {
      performanceIssues.push(
        `Search latency is above threshold: avg=${avg.toFixed(2)}ms, threshold=${details.performance.thresholdMs}ms`
      );
    }
  } catch (err) {
    performanceIssues.push(`Search performance test failed: ${err.message}`);
  }

  // Consolidate ranking result
  summary.ranking = passFail(Boolean(details.checks.noPricePriority) && Boolean(details.checks.favoriteBoost));

  // Test 7 backward compatibility summary
  summary.compatibility = passFail(
    compatibilityOrderCreation && compatibilityDriverAssignment && compatibilityTracking && compatibilityChat
  );

  if (!compatibilityOrderCreation) {
    detectedBugs.push("Backward compatibility: order creation via quote acceptance failed");
  }
  if (!compatibilityDriverAssignment) {
    detectedBugs.push("Backward compatibility: driver assignment failed");
  }
  if (!compatibilityTracking) {
    detectedBugs.push("Backward compatibility: tracking websocket updates failed");
  }
  if (!compatibilityChat) {
    detectedBugs.push("Backward compatibility: chat message flow failed");
  }

  const output = {
    ...summary,
    detectedBugs,
    missingFeatures,
    performanceIssues,
    details,
  };

  console.log(JSON.stringify(output, null, 2));
}

run()
  .catch((err) => {
    detectedBugs.push(`Fatal suite error: ${err.message}`);
    console.log(
      JSON.stringify(
        {
          ...summary,
          detectedBugs,
          missingFeatures,
          performanceIssues,
          details,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
