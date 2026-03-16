const { execSync } = require("child_process");
const crypto = require("crypto");

const base = "http://localhost:8080";
const shopIdStatic = "6e913887-13aa-4c74-ba14-f7337be29b41";

const seed = String(Math.floor(Date.now() / 1000) % 1000000).padStart(6, "0");
let phoneSeq = 10;
function nextPhone() {
  phoneSeq += 1;
  return `79${seed}${String(phoneSeq).padStart(2, "0")}`;
}

const report = {
  modules: {
    Auth: { pass: 0, fail: 0, checks: [] },
    Shops: { pass: 0, fail: 0, checks: [] },
    Products: { pass: 0, fail: 0, checks: [] },
    Search: { pass: 0, fail: 0, checks: [] },
    Chat: { pass: 0, fail: 0, checks: [] },
    Quotes: { pass: 0, fail: 0, checks: [] },
    Orders: { pass: 0, fail: 0, checks: [] },
    Drivers: { pass: 0, fail: 0, checks: [] },
    Dispatch: { pass: 0, fail: 0, checks: [] },
  },
  infra: {},
  database: {},
  redis: {},
  performance: {},
  bugs: [],
  warnings: [],
};

function mark(moduleName, label, ok, detail) {
  const bucket = report.modules[moduleName];
  bucket.checks.push({ label, ok, detail });
  if (ok) bucket.pass += 1;
  else bucket.fail += 1;
}

async function request(method, path, { body, token } = {}) {
  const startedAt = Date.now();
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(base + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return {
    status: res.status,
    body: parsed,
    latencyMs: Date.now() - startedAt,
  };
}

function psql(sql) {
  const cmd = `docker exec hyperlocal-postgres psql -U postgres -d hyperlocal -t -A -F ',' -c ${JSON.stringify(sql)}`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function redis(cmd) {
  const full = `docker exec hyperlocal-redis redis-cli ${cmd}`;
  return execSync(full, { encoding: "utf8" }).trim();
}

function redisScan(pattern) {
  const full = `docker exec hyperlocal-redis redis-cli --scan --pattern ${JSON.stringify(pattern)}`;
  const out = execSync(full, { encoding: "utf8" }).trim();
  if (!out) return [];
  return out.split(/\r?\n/).filter(Boolean);
}

function redisDeleteByPattern(pattern) {
  const keys = redisScan(pattern);
  if (!keys.length) return;
  for (let i = 0; i < keys.length; i += 100) {
    const batch = keys.slice(i, i + 100).map((k) => JSON.stringify(k)).join(" ");
    redis(`DEL ${batch}`);
  }
}

async function auth(phone, role, deviceId) {
  const send = await request("POST", "/auth/send-otp", { body: { phone } });
  const verify = await request("POST", "/auth/verify-otp", {
    body: { phone, otp: send.body.otp, role, deviceId },
  });
  return { send, verify };
}

function decodeJwtPayload(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

(async () => {
  try {
    // Infra check
    report.infra.health = await request("GET", "/health");
    report.infra.docker = execSync("docker ps --format 'table {{.Names}}\\t{{.Status}}'", { encoding: "utf8" });

    // AUTH
    const phoneA = nextPhone();
    const authA = await auth(phoneA, "customer", "verify-auth-a");
    mark("Auth", "send otp", authA.send.status === 200 && !!authA.send.body.otp, authA.send);
    mark("Auth", "verify otp creates user", authA.verify.status === 200 && !!authA.verify.body.accessToken, authA.verify);

    const loginAgain = await auth(phoneA, "customer", "verify-auth-a2");
    mark(
      "Auth",
      "login existing user returns same id",
      loginAgain.verify.status === 200 && loginAgain.verify.body.user.id === authA.verify.body.user.id,
      { first: authA.verify.body.user, second: loginAgain.verify.body.user }
    );

    const wrongPhone = nextPhone();
    const wrongSend = await request("POST", "/auth/send-otp", { body: { phone: wrongPhone } });
    const wrongVerify = await request("POST", "/auth/verify-otp", {
      body: { phone: wrongPhone, otp: "000000", role: "customer", deviceId: "wrong-otp" },
    });
    mark("Auth", "wrong otp rejected", wrongSend.status === 200 && wrongVerify.status === 400, wrongVerify);

    const reusePhone = nextPhone();
    const reuseSend = await request("POST", "/auth/send-otp", { body: { phone: reusePhone } });
    const reuseVerify1 = await request("POST", "/auth/verify-otp", {
      body: { phone: reusePhone, otp: reuseSend.body.otp, role: "customer", deviceId: "reuse-1" },
    });
    const reuseVerify2 = await request("POST", "/auth/verify-otp", {
      body: { phone: reusePhone, otp: reuseSend.body.otp, role: "customer", deviceId: "reuse-2" },
    });
    mark("Auth", "otp reuse rejected", reuseVerify1.status === 200 && reuseVerify2.status === 400, { reuseVerify2 });

    const expPhone = nextPhone();
    const expSend = await request("POST", "/auth/send-otp", { body: { phone: expPhone } });
    redis(`DEL otp:${expPhone}`);
    const expVerify = await request("POST", "/auth/verify-otp", {
      body: { phone: expPhone, otp: expSend.body.otp, role: "customer", deviceId: "expired" },
    });
    mark("Auth", "otp expired rejected", expVerify.status === 400, expVerify);

    const invalidPhone = await request("POST", "/auth/send-otp", { body: { phone: "abc" } });
    mark("Auth", "invalid phone format rejected", invalidPhone.status === 400, invalidPhone);

    const userRow = psql(`SELECT phone, role FROM users WHERE phone = '${phoneA}' LIMIT 1;`);
    mark("Auth", "users table entry exists", userRow.includes(phoneA), userRow);

    const payload = decodeJwtPayload(authA.verify.body.accessToken);
    const me = await request("GET", "/users/me", { token: authA.verify.body.accessToken });
    mark("Auth", "jwt usable on /users/me", me.status === 200 && me.body.id === authA.verify.body.user.id, me);
    mark("Auth", "jwt payload has exp/iat", !!payload && payload.exp > payload.iat, payload);

    // SHOPS
    const ownerPhone = nextPhone();
    const ownerAuth = await auth(ownerPhone, "shop_owner", "owner-main");
    const ownerToken = ownerAuth.verify.body.accessToken;

    const createShop = await request("POST", "/shops", {
      token: ownerToken,
      body: {
        name: "Verify Shop",
        category: "grocery",
        phone: "9999999999",
        lat: 17.385,
        lng: 78.4867,
      },
    });
    mark("Shops", "create shop", createShop.status === 201 && !!createShop.body.id, createShop);
    const shopId = createShop.body.id;

    const updateShop = await request("PUT", `/shops/${shopId}`, {
      token: ownerToken,
      body: { description: "Updated during verification" },
    });
    mark("Shops", "update shop", updateShop.status === 200 && updateShop.body.description === "Updated during verification", updateShop);

    const toggleAccept = await request("PATCH", `/shops/${shopId}/availability`, {
      token: ownerToken,
      body: { acceptingOrders: false },
    });
    mark("Shops", "toggle accepting orders", toggleAccept.status === 200 && toggleAccept.body.acceptingOrders === false, toggleAccept);

    const toggleOpenAttempt = await request("PUT", `/shops/${shopId}`, {
      token: ownerToken,
      body: { isOpen: false },
    });
    const openCheck = await request("GET", `/shops/${shopId}`);
    const openToggled = openCheck.status === 200 && openCheck.body.isOpen === false;
    mark("Shops", "toggle shop open/closed", openToggled, { toggleOpenAttempt, openCheck });
    if (!openToggled) {
      report.bugs.push("Shop open/closed toggle is not supported via API contract (isOpen not writable).");
    }

    const createShop2 = await request("POST", "/shops", {
      token: ownerToken,
      body: {
        name: "Verify Shop 2",
        category: "grocery",
        phone: "9999999998",
        lat: 17.386,
        lng: 78.4869,
      },
    });
    mark("Shops", "owner can create multiple shops", createShop2.status === 201, createShop2);

    const custPhone = nextPhone();
    const custAuth = await auth(custPhone, "customer", "cust-main");
    const unauthorizedShop = await request("POST", "/shops", {
      token: custAuth.verify.body.accessToken,
      body: {
        name: "Nope",
        category: "grocery",
        phone: "9999999997",
        lat: 17.3,
        lng: 78.4,
      },
    });
    mark("Shops", "unauthorized shop creation rejected", unauthorizedShop.status === 403, unauthorizedShop);

    // PRODUCTS
    const productCreate = await request("POST", "/products", {
      token: ownerToken,
      body: {
        shopId,
        name: "Milk 1L",
        category: "dairy",
        price: 60,
        stock: 20,
      },
    });
    mark("Products", "create product", productCreate.status === 201 && !!productCreate.body.id, productCreate);
    const productId = productCreate.body.id;

    const inventoryUpdate = await request("PATCH", `/inventory/${productId}`, {
      token: ownerToken,
      body: { stockQuantity: 30 },
    });
    mark("Products", "update inventory", inventoryUpdate.status === 200 && inventoryUpdate.body.stockQuantity === 30, inventoryUpdate);

    const shopProducts = await request("GET", `/shops/${shopId}/products`);
    mark("Products", "fetch shop products", shopProducts.status === 200 && Array.isArray(shopProducts.body.items), shopProducts);

    const invalidPrice = await request("POST", "/products", {
      token: ownerToken,
      body: { shopId, name: "Bad", category: "x", price: -10, stock: 1 },
    });
    mark("Products", "invalid price rejected", invalidPrice.status === 400, invalidPrice);

    const negativeStock = await request("POST", "/products", {
      token: ownerToken,
      body: { shopId, name: "BadStock", category: "x", price: 10, stock: -1 },
    });
    mark("Products", "negative stock rejected", negativeStock.status === 400, negativeStock);

    const unauthProduct = await request("POST", "/products", {
      token: custAuth.verify.body.accessToken,
      body: { shopId, name: "No", category: "x", price: 10, stock: 1 },
    });
    mark("Products", "unauthorized product creation rejected", unauthProduct.status === 403, unauthProduct);

    const disableAttempt = await request("PATCH", `/products/${productId}`, {
      token: ownerToken,
      body: { isActive: false },
    });
    const disableSupported = disableAttempt.status >= 200 && disableAttempt.status < 300;
    mark("Products", "disable product", disableSupported, disableAttempt);
    if (!disableSupported) {
      report.bugs.push("Disable product endpoint is missing (PATCH /products/:id not implemented).");
    }

    // SEARCH
    const s1 = await request("GET", "/search/products?q=milk&lat=17.385&lng=78.4867&radius=5000");
    report.performance.searchLatencyMs = s1.latencyMs;
    mark("Search", "keyword product search", s1.status === 200 && Array.isArray(s1.body.items), s1);

    const s2 = await request("GET", "/search/products?lat=17.385&lng=78.4867&radius=5000");
    mark("Search", "nearby product search", s2.status === 200 && Array.isArray(s2.body.items), s2);

    const nearbyShops = await request("GET", "/shops/nearby?lat=17.385&lng=78.4867&radius=5000");
    mark("Search", "nearby shop search", nearbyShops.status === 200 && Array.isArray(nearbyShops.body.items), nearbyShops);

    const emptyQ = await request("GET", "/search/products?q=&lat=17.385&lng=78.4867&radius=5000");
    mark("Search", "empty query handled", emptyQ.status === 400, emptyQ);

    const badCoord = await request("GET", "/search/products?q=milk&lat=200&lng=78.48&radius=5000");
    mark("Search", "invalid coordinates rejected", badCoord.status === 400, badCoord);

    const radiusMax = await request("GET", "/search/products?q=milk&lat=17.385&lng=78.4867&radius=50000");
    const radiusTooFar = await request("GET", "/search/products?q=milk&lat=17.385&lng=78.4867&radius=50001");
    mark("Search", "radius edge limits", radiusMax.status === 200 && radiusTooFar.status === 400, { radiusMax, radiusTooFar });

    const osCountRaw = execSync("curl -sS http://localhost:9200/products_index/_count", { encoding: "utf8" });
    let osCount = 0;
    try { osCount = JSON.parse(osCountRaw).count; } catch {}
    mark("Search", "OpenSearch index reachable", osCount >= 0, osCountRaw);

    // CHAT
    const conv = await request("POST", "/conversations", {
      token: custAuth.verify.body.accessToken,
      body: { shopId },
    });
    mark("Chat", "create conversation", conv.status === 200 && !!conv.body.id, conv);

    const msg = await request("POST", "/messages", {
      token: custAuth.verify.body.accessToken,
      body: { conversationId: conv.body.id, message: "Hello shop" },
    });
    mark("Chat", "send message", msg.status === 201 && !!msg.body.id, msg);

    const msgList = await request("GET", `/conversations/${conv.body.id}/messages`, {
      token: ownerToken,
    });
    mark("Chat", "retrieve messages", msgList.status === 200 && Array.isArray(msgList.body.items), msgList);

    const stranger = await auth(nextPhone(), "customer", "stranger");
    const unauthorizedMsg = await request("POST", "/messages", {
      token: stranger.verify.body.accessToken,
      body: { conversationId: conv.body.id, message: "intrude" },
    });
    mark("Chat", "unauthorized message rejected", unauthorizedMsg.status === 403, unauthorizedMsg);

    const invalidConvMsg = await request("POST", "/messages", {
      token: custAuth.verify.body.accessToken,
      body: { conversationId: crypto.randomUUID(), message: "x" },
    });
    mark("Chat", "invalid conversation rejected", invalidConvMsg.status === 404, invalidConvMsg);

    const largeMsg = await request("POST", "/messages", {
      token: custAuth.verify.body.accessToken,
      body: { conversationId: conv.body.id, message: "A".repeat(5001) },
    });
    mark("Chat", "large payload rejected", largeMsg.status === 400, largeMsg);

    // QUOTES + ORDERS
    const qCreate = await request("POST", "/quotes", {
      token: ownerToken,
      body: {
        conversationId: conv.body.id,
        items: [{ productId, quantity: 1, price: 55 }],
      },
    });
    mark("Quotes", "shop creates quote", qCreate.status === 201 && !!qCreate.body.quoteId, qCreate);

    const qList = await request("GET", `/conversations/${conv.body.id}/quotes`, {
      token: custAuth.verify.body.accessToken,
    });
    mark("Quotes", "customer fetches quote", qList.status === 200 && Array.isArray(qList.body.items), qList);

    const badProductQuote = await request("POST", "/quotes", {
      token: ownerToken,
      body: { conversationId: conv.body.id, items: [{ productId: crypto.randomUUID(), quantity: 1, price: 10 }] },
    });
    mark("Quotes", "invalid product in quote rejected", badProductQuote.status === 400, badProductQuote);

    const unauthorizedAccept = await request("POST", `/quotes/${qCreate.body.quoteId}/accept`, {
      token: stranger.verify.body.accessToken,
    });
    mark("Quotes", "unauthorized accept rejected", unauthorizedAccept.status === 403, unauthorizedAccept);

    // Prepare dispatch isolation: clear runtime states
    psql("UPDATE drivers SET is_online = FALSE, is_busy = FALSE;");
    redisDeleteByPattern("driver:online:*");
    redisDeleteByPattern("driver:busy:*");
    redis("DEL drivers:geo");

    // Create 2 driver users and set locations
    const d1 = await auth(nextPhone(), "driver", "d1");
    const d2 = await auth(nextPhone(), "driver", "d2");
    const d1Loc = await request("POST", "/drivers/location", {
      token: d1.verify.body.accessToken,
      body: { lat: 17.385, lng: 78.4867 },
    });
    const d2Loc = await request("POST", "/drivers/location", {
      token: d2.verify.body.accessToken,
      body: { lat: 17.395, lng: 78.4967 },
    });
    mark("Drivers", "driver location update", d1Loc.status === 200 && d2Loc.status === 200, { d1Loc, d2Loc });

    const badDriverLoc = await request("POST", "/drivers/location", {
      token: d1.verify.body.accessToken,
      body: { lat: 123, lng: 78.4 },
    });
    mark("Drivers", "invalid driver coordinates rejected", badDriverLoc.status === 400, badDriverLoc);

    const d1Db = psql(`SELECT id,is_online,COALESCE(is_busy,FALSE),lat,lng FROM drivers WHERE user_id='${d1.verify.body.user.id}' LIMIT 1;`);
    mark("Drivers", "driver persisted in Postgres", d1Db.includes("t"), d1Db);

    const d1Id = d1Loc.body.driverId;
    const geoPos = redis(`GEOPOS drivers:geo ${d1Id}`);
    mark("Drivers", "driver in Redis GEO index", !geoPos.includes("(nil)"), geoPos);

    // Quote acceptance (phase 7 + phase 9)
    const tOrderStart = Date.now();
    const qAccept = await request("POST", `/quotes/${qCreate.body.quoteId}/accept`, {
      token: custAuth.verify.body.accessToken,
    });
    report.performance.orderCreationLatencyMs = Date.now() - tOrderStart;
    mark("Quotes", "customer accepts quote", qAccept.status === 200 && !!qAccept.body.orderId, qAccept);
    mark("Orders", "quote acceptance creates order with CREATED response", qAccept.status === 200 && qAccept.body.status === "CREATED", qAccept);

    const orderId = qAccept.body.orderId;

    const qAcceptAgain = await request("POST", `/quotes/${qCreate.body.quoteId}/accept`, {
      token: custAuth.verify.body.accessToken,
    });
    mark("Quotes", "accept already accepted quote rejected", qAcceptAgain.status === 400, qAcceptAgain);

    const invalidQuoteAccept = await request("POST", `/quotes/${crypto.randomUUID()}/accept`, {
      token: custAuth.verify.body.accessToken,
    });
    mark("Quotes", "invalid quote rejected", invalidQuoteAccept.status === 404, invalidQuoteAccept);

    // Dispatch latency and nearest driver selection
    const dispatchStartedAt = Date.now();
    let finalOrder;
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      const o = await request("GET", `/orders/${orderId}`, { token: custAuth.verify.body.accessToken });
      finalOrder = o;
      if (o.status === 200 && o.body.status === "ASSIGNED" && o.body.driverId) break;
    }
    report.performance.dispatchLatencyMs = Date.now() - dispatchStartedAt;

    mark("Dispatch", "order auto-assigned", finalOrder && finalOrder.body.status === "ASSIGNED", finalOrder);
    mark("Dispatch", "nearest driver selected", finalOrder && finalOrder.body.driverId === d1Id, { expected: d1Id, actual: finalOrder?.body?.driverId });

    const busyExists = redis(`EXISTS driver:busy:${finalOrder.body.driverId}`);
    const busyTtl = redis(`TTL driver:busy:${finalOrder.body.driverId}`);
    mark("Dispatch", "busy lock set in Redis", busyExists === "1", { busyExists, busyTtl });
    mark("Dispatch", "busy lock has TTL", Number(busyTtl) > 0 && Number(busyTtl) <= 1800, busyTtl);

    const busyDb = psql(`SELECT COALESCE(is_busy,FALSE) FROM drivers WHERE id='${finalOrder.body.driverId}' LIMIT 1;`);
    mark("Dispatch", "driver busy persisted in Postgres", busyDb === "t", busyDb);

    // Failure scenario: no drivers available then retry
    psql("UPDATE drivers SET is_online = FALSE, is_busy = TRUE;");
    redis("DEL drivers:geo");

    const conv2 = await request("POST", "/conversations", {
      token: custAuth.verify.body.accessToken,
      body: { shopId },
    });
    const q2 = await request("POST", "/quotes", {
      token: ownerToken,
      body: { conversationId: conv2.body.id, items: [{ productId, quantity: 1, price: 56 }] },
    });
    const a2 = await request("POST", `/quotes/${q2.body.quoteId}/accept`, { token: custAuth.verify.body.accessToken });
    const orderNoDriver = a2.body.orderId;

    await new Promise((r) => setTimeout(r, 3000));
    const oNoDriver = await request("GET", `/orders/${orderNoDriver}`, { token: custAuth.verify.body.accessToken });
    mark("Dispatch", "no drivers available keeps order unassigned", oNoDriver.body.status === "CREATED" && !oNoDriver.body.driverId, oNoDriver);

    const attemptsRaw = redis(`GET dispatch:attempts:${orderNoDriver}`);
    mark("Dispatch", "dispatch attempts counter created", attemptsRaw !== "(nil)", attemptsRaw);

    // Bring one driver online and verify retry assigns
    psql(`UPDATE drivers SET is_online = FALSE, is_busy = FALSE;`);
    const dRetry = await request("POST", "/drivers/location", {
      token: d1.verify.body.accessToken,
      body: { lat: 17.385, lng: 78.4867 },
    });
    mark("Dispatch", "driver back online for retry", dRetry.status === 200, dRetry);

    let retriedAssigned = null;
    for (let i = 0; i < 16; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      const o = await request("GET", `/orders/${orderNoDriver}`, { token: custAuth.verify.body.accessToken });
      if (o.body.status === "ASSIGNED") {
        retriedAssigned = o;
        break;
      }
    }
    mark("Dispatch", "retry logic eventually assigns", !!retriedAssigned, retriedAssigned);

    // Completion cleanup (DELIVERED path)
    const pickup = await request("POST", `/orders/${orderId}/pickup`, { token: d1.verify.body.accessToken });
    const startDelivery = await request("POST", `/orders/${orderId}/start-delivery`, { token: d1.verify.body.accessToken });
    const complete = await request("POST", `/orders/${orderId}/complete`, { token: d1.verify.body.accessToken });
    mark("Orders", "driver lifecycle transitions", pickup.status === 200 && startDelivery.status === 200 && complete.status === 200 && complete.body.status === "DELIVERED", { pickup, startDelivery, complete });

    const lockAfterComplete = redis(`EXISTS driver:busy:${d1Id}`);
    const dbAfterComplete = psql(`SELECT COALESCE(is_busy,FALSE) FROM drivers WHERE id='${d1Id}' LIMIT 1;`);
    mark("Dispatch", "busy lock cleared on completion", lockAfterComplete === "0" && dbAfterComplete === "f", { lockAfterComplete, dbAfterComplete });

    // Shop closed/not accepting orders failure behavior
    await request("PATCH", `/shops/${shopId}/availability`, { token: ownerToken, body: { acceptingOrders: false } });
    const conv3 = await request("POST", "/conversations", {
      token: custAuth.verify.body.accessToken,
      body: { shopId },
    });
    const q3 = await request("POST", "/quotes", {
      token: ownerToken,
      body: { conversationId: conv3.body.id, items: [{ productId, quantity: 1, price: 57 }] },
    });
    const acceptWhenNotAccepting = await request("POST", `/quotes/${q3.body.quoteId}/accept`, {
      token: custAuth.verify.body.accessToken,
    });
    const rejectedByShopAvailability = acceptWhenNotAccepting.status >= 400;
    mark("Orders", "shop not accepting orders rejects checkout", rejectedByShopAvailability, acceptWhenNotAccepting);
    if (!rejectedByShopAvailability) {
      report.bugs.push("Order creation is allowed even when shop.accepting_orders is false.");
    }

    // Redis validation keys
    report.redis.keys = {
      driversGeoExists: redis("EXISTS drivers:geo"),
      dispatchQueueLen: redis("LLEN dispatch:orders"),
      sampleBusyTtl: redis(`TTL driver:busy:${d1Id}`),
    };

    // Database validation
    const tables = psql("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','shops','products','conversations','messages','quotes','orders','drivers') ORDER BY table_name;");
    report.database.tables = tables;

    const fkCount = psql("SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_schema='public';");
    report.database.foreignKeyCount = Number(fkCount || 0);

    // Performance concerns
    if (report.performance.dispatchLatencyMs > 2000) {
      report.performance.dispatchSlaMet = false;
      report.warnings.push(`Dispatch latency ${report.performance.dispatchLatencyMs}ms exceeded 2000ms target.`);
    } else {
      report.performance.dispatchSlaMet = true;
    }

    if (report.performance.searchLatencyMs > 500) {
      report.warnings.push(`Search latency ${report.performance.searchLatencyMs}ms is higher than expected.`);
    }

    // module summary
    const moduleSummary = {};
    for (const [name, value] of Object.entries(report.modules)) {
      moduleSummary[name] = value.fail === 0 ? "PASS" : "FAIL";
    }

    console.log("=== FULL VERIFICATION REPORT ===");
    console.log(JSON.stringify({ moduleSummary, report }, null, 2));

    const anyFail = Object.values(report.modules).some((m) => m.fail > 0);
    process.exit(anyFail ? 1 : 0);
  } catch (err) {
    console.error("VERIFICATION_FATAL", err);
    process.exit(2);
  }
})();
