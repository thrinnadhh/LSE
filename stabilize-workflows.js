const http = require("http");

const BASE_URL = "http://localhost:3000";
const PHONE = `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`;
const SHOP_OWNER_PHONE = `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`;

const results = {
  auth: "FAIL",
  shopSetup: "FAIL",
  products: "FAIL",
  search: "FAIL",
  conversation: "FAIL",
  quote: "FAIL",
  order: "FAIL",
  completion: "FAIL",
  repeatTracking: "FAIL",
  personalization: "FAIL",
  dashboard: "FAIL",
  edgeCases: "FAIL",
  performance: "FAIL",
  overall: "FAIL"
};

const state = {
  customerToken: null,
  shopOwnerToken: null,
  shopId: null,
  productId: null,
  conversationId: null,
  quoteId: null,
  orderId: null,
};

function request(method, url, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (token) {
      options.headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        let payload;
        try {
          payload = body ? JSON.parse(body) : null;
        } catch (e) {
          payload = body; // Return raw body if not JSON
        }
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: payload, body });
        } else {
          reject({ status: res.statusCode, data: payload, body });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function logStep(name, fn) {
  console.log(`\n--- [STEP] ${name} ---`);
  try {
    const start = Date.now();
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ ${name} passed in ${duration}ms`);
    return true;
  } catch (err) {
    console.error(`❌ ${name} failed:`, err.status ? `(Status ${err.status})` : "", err.data || err.message);
    return false;
  }
}

async function run() {
  console.log("🚀 Starting Phase 12-14 Stabilization Tests (Optimized)...");

  // Workflow 1: Auth
  await logStep("Auth - Customer OTP", async () => {
    await request("POST", `${BASE_URL}/auth/send-otp`, { phone: PHONE });
    const verify = await request("POST", `${BASE_URL}/auth/verify-otp`, { phone: PHONE, otp: "123456", role: "customer" });
    state.customerToken = verify.data.accessToken;
    results.auth = "PASS";
  });

  await logStep("Auth - Shop Owner OTP", async () => {
    await request("POST", `${BASE_URL}/auth/send-otp`, { phone: SHOP_OWNER_PHONE });
    const verify = await request("POST", `${BASE_URL}/auth/verify-otp`, { phone: SHOP_OWNER_PHONE, otp: "123456", role: "shop_owner" });
    state.shopOwnerToken = verify.data.accessToken;
  });

  // Workflow 2: Shop Setup
  await logStep("Shop Setup", async () => {
    const res = await request(
      "POST",
      `${BASE_URL}/shops`,
      { name: "Stabilization Shop", category: "pet_store", phone: SHOP_OWNER_PHONE, lat: 17.385, lng: 78.4867 },
      state.shopOwnerToken
    );
    state.shopId = res.data.shopId;
    results.shopSetup = "PASS";
  });

  // Workflow 3: Product Creation
  await logStep("Product Creation", async () => {
    const res = await request(
      "POST",
      `${BASE_URL}/products`,
      { shopId: state.shopId, name: "Stabilization Milk", price: 50, category: "Milk" },
      state.shopOwnerToken
    );
    state.productId = res.data.id;
    results.products = "PASS";
  });

  // Workflow 4: Search
  await logStep("Search System", async () => {
    const res = await request(
      "GET",
      `${BASE_URL}/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000`,
      null,
      state.customerToken
    );
    if (res.data && res.data.items && res.data.items.length > 0) results.search = "PASS";
  });

  // Workflow 5: Conversation
  await logStep("Conversation Flow", async () => {
    const res = await request(
      "POST",
      `${BASE_URL}/chat/conversations`,
      { shopId: state.shopId },
      state.customerToken
    );
    state.conversationId = res.data.id || res.data.conversationId;
    results.conversation = "PASS";
  });

  // Workflow 6: Quote Creation
  await logStep("Quote Creation", async () => {
    const res = await request(
      "POST",
      `${BASE_URL}/chat/quotes`,
      { conversationId: state.conversationId, items: [{ productId: state.productId, quantity: 2, price: 50 }] },
      state.shopOwnerToken
    );
    state.quoteId = res.data.quoteId;
    if (state.quoteId) results.quote = "PASS";
  });

  // Workflow 7: Order Creation via Quote
  await logStep("Order Creation (Accept Quote)", async () => {
    const res = await request(
      "POST",
      `${BASE_URL}/chat/quotes/${state.quoteId}/accept`,
      {},
      state.customerToken
    );
    state.orderId = res.data.orderId;
    if (state.orderId) results.order = "PASS";
  });

  // Workflow 8: Order Completion
  await logStep("Order Completion (Auto-bypass)", async () => {
    const res = await request("GET", `${BASE_URL}/orders/${state.orderId}`, null, state.customerToken);
    if (res.data.status === "DELIVERED") results.completion = "PASS";
  });

  // Workflow 9: Repeat Tracking
  await logStep("Repeat Tracking", async () => {
    const res = await request("GET", `${BASE_URL}/home?lat=17.385&lng=78.4867`, null, state.customerToken);
    if (res.data.regularShops && res.data.regularShops.some(s => s.shopId === state.shopId)) {
      results.repeatTracking = "PASS";
    }
  });

  // Workflow 10: Personalization & Dashboard
  await logStep("Personalization & Dashboard", async () => {
    const dash = await request("GET", `${BASE_URL}/shops/dashboard`, null, state.shopOwnerToken);
    if (dash.data.hasShop && dash.data.totalOrders > 0) results.dashboard = "PASS";
    
    const home = await request("GET", `${BASE_URL}/home?lat=17.385&lng=78.4867`, null, state.customerToken);
    if (home.data.recommended && home.data.recommended.length > 0) results.personalization = "PASS";
  });

  // Edge Cases
  await logStep("Edge Cases - Unauth", async () => {
    try {
      await request("GET", `${BASE_URL}/home`);
    } catch (err) {
      if (err.status === 401) results.edgeCases = "PASS";
    }
  });

  // Performance
  await logStep("Performance Check", async () => {
    const start = Date.now();
    await request("GET", `${BASE_URL}/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000`);
    const duration = Date.now() - start;
    if (duration < 500) results.performance = "PASS";
  });

  results.overall = Object.values(results).filter(v => v === "FAIL").length === 0 ? "PASS" : "FAIL";

  console.log("\n--- FINAL REPORT ---");
  console.log(JSON.stringify(results, null, 2));
  
  const fs = require('fs');
  fs.writeFileSync('stabilization-report.json', JSON.stringify(results, null, 2));
}

run().catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
