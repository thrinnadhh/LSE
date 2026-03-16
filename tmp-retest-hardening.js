const { execSync } = require("child_process");

const base = "http://localhost:8080";
const seed = String(Math.floor(Date.now() / 1000) % 1000000).padStart(6, "0");
let seq = 40;
const nextPhone = () => `79${seed}${String(++seq).padStart(2, "0")}`;

async function req(method, path, body, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

function psql(sql) {
  return execSync(
    `docker exec hyperlocal-postgres psql -U postgres -d hyperlocal -t -A -c ${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  ).trim();
}

function redis(cmd) {
  return execSync(`docker exec hyperlocal-redis redis-cli ${cmd}`, { encoding: "utf8" }).trim();
}

async function auth(role) {
  const phone = nextPhone();
  const send = await req("POST", "/auth/send-otp", { phone });
  const verify = await req("POST", "/auth/verify-otp", {
    phone,
    otp: send.body.otp,
    role,
    deviceId: `${role}-retest`,
  });
  return verify.body.accessToken;
}

(async () => {
  console.log("step=auth");
  const ownerToken = await auth("shop_owner");
  const customerToken = await auth("customer");
  const driverToken = await auth("driver");

  console.log("step=seed-shop-product");
  const shop = await req("POST", "/shops", {
    name: "Retest Shop",
    category: "grocery",
    phone: "9999999999",
    lat: 17.385,
    lng: 78.4867,
  }, ownerToken);

  const product = await req("POST", "/products", {
    shopId: shop.body.id,
    name: "Milk 1L",
    category: "dairy",
    price: 60,
    stock: 10,
  }, ownerToken);

  psql("UPDATE drivers SET is_online = FALSE, is_busy = FALSE;");
  redis("DEL drivers:geo");

  console.log("step=driver-location");
  const driverLoc = await req("POST", "/drivers/location", { lat: 17.385, lng: 78.4867 }, driverToken);
  const geoExists = redis("EXISTS drivers:geo");
  const geoPos = redis(`GEOPOS drivers:geo ${driverLoc.body.driverId}`);

  console.log("step=create-order");
  const conv = await req("POST", "/conversations", { shopId: shop.body.id }, customerToken);
  const quote = await req("POST", "/quotes", {
    conversationId: conv.body.id,
    items: [{ productId: product.body.id, quantity: 1, price: 55 }],
  }, ownerToken);

  const accept = await req("POST", `/quotes/${quote.body.quoteId}/accept`, undefined, customerToken);

  console.log("step=wait-assignment");
  let order;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    const o = await req("GET", `/orders/${accept.body.orderId}`, undefined, customerToken);
    order = o;
    if (o.body.status === "ASSIGNED" && o.body.driverId) break;
  }

  const busyKey = `driver:busy:${order.body.driverId}`;
  const busyExists = redis(`EXISTS ${busyKey}`);
  const busyTtl = redis(`TTL ${busyKey}`);

  console.log("step=complete-order");
  await req("POST", `/orders/${accept.body.orderId}/pickup`, undefined, driverToken);
  await req("POST", `/orders/${accept.body.orderId}/start-delivery`, undefined, driverToken);
  await req("POST", `/orders/${accept.body.orderId}/complete`, undefined, driverToken);

  const lockAfterComplete = redis(`EXISTS ${busyKey}`);
  const dbAfterComplete = psql(`SELECT COALESCE(is_busy,FALSE) FROM drivers WHERE id='${order.body.driverId}'`);

  console.log("step=shop-availability-gate");
  await req("PATCH", `/shops/${shop.body.id}/availability`, { acceptingOrders: false }, ownerToken);
  const conv2 = await req("POST", "/conversations", { shopId: shop.body.id }, customerToken);
  const quote2 = await req("POST", "/quotes", {
    conversationId: conv2.body.id,
    items: [{ productId: product.body.id, quantity: 1, price: 56 }],
  }, ownerToken);
  const acceptNotAccepting = await req("POST", `/quotes/${quote2.body.quoteId}/accept`, undefined, customerToken);

  console.log(
    JSON.stringify(
      {
        geoExists,
        geoPos,
        busyExists,
        busyTtl,
        lockAfterComplete,
        dbAfterComplete,
        acceptNotAcceptingStatus: acceptNotAccepting.status,
      },
      null,
      2
    )
  );
})();
