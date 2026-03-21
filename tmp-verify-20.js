const { execSync } = require("child_process");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const R = {
  auth: "FAIL",
  otpFallback: "FAIL",
  home: "FAIL",
  shopSetup: "FAIL",
  products: "FAIL",
  search: "FAIL",
  searchFallback: "FAIL",
  conversation: "FAIL",
  quote: "FAIL",
  quoteAccept: "FAIL",
  orderFetch: "FAIL",
  orderLifecycle: "FAIL",
  repeatTracking: "FAIL",
  personalization: "FAIL",
  favorites: "FAIL",
  dashboard: "FAIL",
  edgeCases: "FAIL",
  redisResilience: "FAIL",
  performance: "FAIL",
};

const C = {
  ownerPhone: "+911777000001",
  customerPhone: "+911777000002",
  driverPhone: "+911777000003",
  adminPhone: "+911777000004",
};

const S = {};

function isUuid(s) {
  return typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function arr(x) {
  return Array.isArray(x) ? x : [];
}

async function req(path, opts = {}) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, ms: Date.now() - t0 };
}

async function login(phone, role) {
  const s = await req("/auth/send-otp", { method: "POST", body: { phone } });
  const otp = s.body?.otp || s.body?.fallbackOtp || "123456";
  const v = await req("/auth/verify-otp", { method: "POST", body: { phone, otp, role } });
  return { send: s, verify: v, token: v.body?.accessToken, userId: v.body?.user?.id };
}

function pg(sql) {
  return execSync(`docker exec hyperlocal-postgres psql -U postgres -d hyperlocal -t -A -c \"${sql.replace(/\"/g, '\\\"')}\"`, { encoding: "utf8" }).trim();
}

(async () => {
  const issues = [];

  try {
    const owner = await login(C.ownerPhone, "shop_owner");
    S.ownerToken = owner.token;
    S.ownerId = owner.userId;

    const customer = await login(C.customerPhone, "customer");
    S.customerToken = customer.token;
    S.customerId = customer.userId;

    const authHome = await req("/home", { headers: { authorization: `Bearer ${S.customerToken}` } });
    if (owner.send.status === 200 && owner.verify.status === 200 && !!S.ownerToken && authHome.status === 200) {
      R.auth = "PASS";
    } else {
      issues.push("auth");
    }

    const home = await req("/home", { headers: { authorization: `Bearer ${S.customerToken}` } });
    const homeOk =
      home.status === 200 &&
      Array.isArray(home.body?.favorites) &&
      Array.isArray(home.body?.regularShops) &&
      Array.isArray(home.body?.recommended) &&
      Array.isArray(home.body?.categories);
    if (homeOk) R.home = "PASS"; else issues.push("home");

    const cs = await req("/shops", {
      method: "POST",
      headers: { authorization: `Bearer ${S.ownerToken}` },
      body: { name: "Flow20 Shop", category: "pet_store", phone: "+911777000001", lat: 17.385, lng: 78.4867, city: "Hyderabad" },
    });
    S.shopId = cs.body?.id;

    let ownerLinked = false;
    if (isUuid(S.shopId) && isUuid(S.ownerId)) {
      ownerLinked = !!pg(`SELECT owner_id FROM shops WHERE id='${S.shopId}' AND owner_id='${S.ownerId}'`);
    }
    if (cs.status === 201 && isUuid(S.shopId) && ownerLinked) R.shopSetup = "PASS"; else issues.push(`shopSetup:${cs.status}`);

    const p1 = await req("/products", { method: "POST", headers: { authorization: `Bearer ${S.ownerToken}` }, body: { shopId: S.shopId, name: "milk", price: 30, category: "Groceries", stock: 10 } });
    const p2 = await req("/products", { method: "POST", headers: { authorization: `Bearer ${S.ownerToken}` }, body: { shopId: S.shopId, name: "dog food", price: 300, category: "Pets", stock: 10 } });
    const p3 = await req("/products", { method: "POST", headers: { authorization: `Bearer ${S.ownerToken}` }, body: { shopId: S.shopId, name: "mobile repair", price: 500, category: "Services", stock: 10 } });

    const plist = await req(`/shops/${S.shopId}/products`);
    const items = arr(plist.body?.items);
    S.productId = items[0]?.id;
    if ([p1.status, p2.status, p3.status].every((x) => x === 201 || x === 200) && items.length >= 3) R.products = "PASS"; else issues.push("products");

    await new Promise((r) => setTimeout(r, 1200));

    const queries = ["milk", "dog food", "random"];
    let searchOk = true;
    const searchMs = [];
    for (const q of queries) {
      const sr = await req(`/search/shops?q=${encodeURIComponent(q)}&lat=17.385&lng=78.4867`, { headers: { authorization: `Bearer ${S.customerToken}` } });
      searchMs.push(sr.ms);
      const a = arr(sr.body?.items);
      if (sr.status !== 200 || a.length === 0 || a.some((x) => !x.deliveryTag) || a.some((x) => x.distance !== undefined || x.rawDistance !== undefined || x.distanceMeters !== undefined)) {
        searchOk = false;
      }
    }
    if (searchOk) R.search = "PASS"; else issues.push("search");

    const empty = await req(`/search/shops?q=&lat=17.385&lng=78.4867`, { headers: { authorization: `Bearer ${S.customerToken}` } });
    if (empty.status === 200 && arr(empty.body?.items).length > 0) R.searchFallback = "PASS"; else issues.push("searchFallback");

    const conv = await req("/conversations", { method: "POST", headers: { authorization: `Bearer ${S.customerToken}` }, body: { shopId: S.shopId } });
    S.conversationId = conv.body?.id || conv.body?.conversationId;
    if (conv.status === 200 && isUuid(S.conversationId)) R.conversation = "PASS"; else issues.push("conversation");

    const quote = await req("/quotes", {
      method: "POST",
      headers: { authorization: `Bearer ${S.ownerToken}` },
      body: { conversationId: S.conversationId, items: [{ productId: S.productId, quantity: 1, price: 30 }] },
    });
    S.quoteId = quote.body?.quoteId;
    if (quote.status === 201 && isUuid(S.quoteId) && !quote.body?.id) R.quote = "PASS"; else issues.push("quote");

    const accept = await req(`/quotes/${S.quoteId}/accept`, { method: "POST", headers: { authorization: `Bearer ${S.customerToken}` }, body: {} });
    S.orderId = accept.body?.orderId;
    if (accept.status === 200 && isUuid(S.orderId)) R.quoteAccept = "PASS"; else issues.push("quoteAccept");

    const ofetch = await req(`/orders/${S.orderId}`, { headers: { authorization: `Bearer ${S.customerToken}` } });
    if (ofetch.status === 200 && isUuid(ofetch.body?.orderId || S.orderId)) R.orderFetch = "PASS"; else issues.push("orderFetch");

    const driver = await login(C.driverPhone, "driver");
    const admin = await login(C.adminPhone, "admin");
    S.driverToken = driver.token;
    S.adminToken = admin.token;

    const dloc = await req("/drivers/location", {
      method: "POST",
      headers: { authorization: `Bearer ${S.driverToken}` },
      body: { lat: 17.385, lng: 78.4867 },
    });
    S.driverId = dloc.body?.driverId;

    const conf = await req(`/orders/${S.orderId}/confirm`, { method: "POST", headers: { authorization: `Bearer ${S.ownerToken}` } });
    const asg = await req(`/orders/${S.orderId}/assign-driver`, { method: "POST", headers: { authorization: `Bearer ${S.adminToken}` }, body: { driverId: S.driverId } });
    const pick = await req(`/orders/${S.orderId}/pickup`, { method: "POST", headers: { authorization: `Bearer ${S.driverToken}` } });
    const start = await req(`/orders/${S.orderId}/start-delivery`, { method: "POST", headers: { authorization: `Bearer ${S.driverToken}` } });
    const comp = await req(`/orders/${S.orderId}/complete`, { method: "POST", headers: { authorization: `Bearer ${S.driverToken}` } });
    const final = await req(`/orders/${S.orderId}`, { headers: { authorization: `Bearer ${S.customerToken}` } });

    if (conf.status === 200 && asg.status === 200 && pick.status === 200 && start.status === 200 && comp.status === 200 && final.body?.status === "DELIVERED") {
      R.orderLifecycle = "PASS";
    } else {
      issues.push(`orderLifecycle:${conf.status},${asg.status},${pick.status},${start.status},${comp.status},${final.body?.status}`);
    }

    let stat = "";
    if (isUuid(S.shopId) && isUuid(S.customerId)) {
      try { stat = pg(`SELECT order_count FROM shop_customer_stats WHERE shop_id='${S.shopId}' AND customer_id='${S.customerId}'`); } catch {}
    }
    if (Number(stat || 0) >= 1) R.repeatTracking = "PASS"; else issues.push(`repeatTracking:${stat}`);

    const home2 = await req("/home", { headers: { authorization: `Bearer ${S.customerToken}` } });
    const rec = arr(home2.body?.recommended);
    const regs = arr(home2.body?.regularShops);
    const inRec = rec.some((x) => (x.shopId || x.id) === S.shopId);
    const inReg = regs.some((x) => (x.shopId || x.id) === S.shopId);
    if (home2.status === 200 && inRec && inReg) R.personalization = "PASS"; else issues.push(`personalization:${inRec},${inReg}`);

    const favAdd = await req(`/users/favorites/${S.shopId}`, { method: "POST", headers: { authorization: `Bearer ${S.customerToken}` } });
    const favList = await req(`/users/favorites`, { headers: { authorization: `Bearer ${S.customerToken}` } });
    if ((favAdd.status === 200 || favAdd.status === 201) && favList.status === 200 && arr(favList.body?.items).some((x) => (x.shopId || x.id) === S.shopId)) {
      R.favorites = "PASS";
    } else {
      issues.push("favorites");
    }

    const dash = await req(`/shops/dashboard`, { headers: { authorization: `Bearer ${S.ownerToken}` } });
    if (dash.status === 200 && Number(dash.body?.totalOrders) > 0 && Number(dash.body?.revenue) > 0 && Number(dash.body?.repeatCustomers) > 0) {
      R.dashboard = "PASS";
    } else {
      issues.push(`dashboard:${dash.status}`);
    }

    const invalid = await req(`/home`, { headers: { authorization: "Bearer invalid" } });
    const dup = await req(`/orders/${S.orderId}/complete`, { method: "POST", headers: { authorization: `Bearer ${S.driverToken}` } });
    if (invalid.status === 401 && dup.status < 500) R.edgeCases = "PASS"; else issues.push(`edgeCases:${invalid.status},${dup.status}`);

    const perfSearch = searchMs[0] || 99999;
    const perfHome = authHome.ms || 99999;
    if (perfSearch < 100 && perfHome < 200) R.performance = "PASS"; else issues.push(`performance:${perfSearch},${perfHome}`);

    try {
      execSync("docker stop hyperlocal-redis", { stdio: "pipe" });
      await new Promise((r) => setTimeout(r, 700));

      const o = await req("/auth/send-otp", { method: "POST", body: { phone: "+911777009999" } });
      const dl = await req("/drivers/location", {
        method: "POST",
        headers: { authorization: `Bearer ${S.driverToken}` },
        body: { lat: 17.381, lng: 78.482 },
      });

      const otpOk = (o.status === 200 && !!o.body?.otp) || (o.status === 500 && !!o.body?.fallbackOtp);
      const locationNoHang = dl.status > 0;

      if (otpOk) R.otpFallback = "PASS"; else issues.push(`otpFallback:${o.status}`);
      if (otpOk && locationNoHang) R.redisResilience = "PASS"; else issues.push(`redisResilience:${o.status},${dl.status}`);
    } finally {
      try { execSync("docker start hyperlocal-redis", { stdio: "pipe" }); } catch {}
      await new Promise((r) => setTimeout(r, 700));
    }

    const overall = Object.values(R).every((v) => v === "PASS") ? "PASS" : "FAIL";
    const payload = { ...R, overall, _issues: issues };

    console.log("FLOW20_RESULT_START");
    console.log(JSON.stringify(payload, null, 2));
    console.log("FLOW20_RESULT_END");
  } catch (e) {
    console.error("FLOW20_FATAL", e?.stack || e?.message || String(e));
    process.exit(1);
  }
})();
