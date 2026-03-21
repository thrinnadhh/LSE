const http = require('http');

const API_BASE = 'http://127.0.0.1:3000';

async function req(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data }); }
      });
    });
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function logStep(step, detail) {
    console.log(`\n\x1b[36m>>> STEP: ${step}\x1b[0m`);
    if (detail) console.log(JSON.stringify(detail, null, 2));
}

async function run() {
  console.log("\n\x1b[35m=== FULL SYSTEM WORKFLOW DEMONSTRATION ===\x1b[0m\n");

  // 1. AUTHENTICATION (CUSTOMER)
  logStep("1. Customer Auth - Requesting OTP", { phone: "+10000000002" });
  const otpRes = await req('POST', '/auth/send-otp', { phone: '+10000000002' });
  logStep("1.1 Customer Auth - Verifying OTP", { phone: "+10000000002", otp: "123456" });
  const custRes = await req('POST', '/auth/verify-otp', { phone: '+10000000002', otp: '123456' });
  const customerToken = custRes.data.accessToken;
  logStep("1.2 Customer Auth - Token Received", { role: custRes.data.user.role, id: custRes.data.user.id });

  // AUTH (OWNER & DRIVER)
  const ownerRes = await req('POST', '/auth/verify-otp', { phone: '+10000000001', otp: '123456' });
  const ownerToken = ownerRes.data.accessToken;
  const driverRes = await req('POST', '/auth/verify-otp', { phone: '+10000000003', otp: '123456' });
  const driverToken = driverRes.data.accessToken;

  // 2. SHOP SETUP
  logStep("2. Ensuring Shop Exists", { owner: "+10000000001" });
  let sAdd = await req('POST', '/shops', { name: "Demo Mart", category: "grocery", lat: 12.97, lng: 77.59 }, ownerToken);
  const shopId = sAdd.data.id || (await req('GET', '/shops', null, customerToken)).data[0].id;
  logStep("2.1 Shop Identifier", { shopId });

  // 3. PRODUCT SETUP
  logStep("3. Adding Product to Shop", { shopId });
  const pAdd = await req('POST', '/products', { shopId, name: "Premium Coffee", price: 450, category: "grocery", stock: 100 }, ownerToken);
  const productId = pAdd.data.id;
  logStep("3.1 Product Created", { productId, name: pAdd.data.name, price: pAdd.data.price });

  // 4. CONVERSATION & QUOTE
  logStep("4. Customer starts Conversation", { shopId });
  const convRes = await req('POST', '/chat/conversations', { shopId }, customerToken);
  const conversationId = convRes.data.id;
  logStep("4.1 Conversation ID", { conversationId });

  logStep("4.2 Shop Owner issues Quote", { conversationId, productId });
  const qRes = await req('POST', '/chat/quotes', {
    conversationId,
    items: [{ productId, quantity: 2, price: 450 }]
  }, ownerToken);
  const quoteId = qRes.data.quoteId;
  logStep("4.3 Quote Issued", { quoteId, totalPrice: qRes.data.totalPrice });

  // 5. ORDER CREATION
  logStep("5. Customer ACCEPTS Quote", { quoteId });
  const accRes = await req('POST', `/chat/quotes/${quoteId}/accept`, null, customerToken);
  const orderId = accRes.data.orderId;
  logStep("5.1 Order Created!", { orderId });

  // 6. ORDER LIFECYCLE
  logStep("6. Owner CONFIRMS Order", { orderId });
  await req('POST', `/orders/${orderId}/confirm`, null, ownerToken);
  
  logStep("6.1 Driver PICKUP", { orderId });
  const pickRes = await req('POST', `/orders/${orderId}/pickup?dev=true`, null, driverToken);
  logStep("Result", pickRes.data);

  logStep("6.2 Driver START DELIVERY", { orderId });
  const startRes = await req('POST', `/orders/${orderId}/start-delivery?dev=true`, null, driverToken);
  logStep("Result", startRes.data);

  logStep("6.3 Driver COMPLETE DELIVERY", { orderId });
  const compRes = await req('POST', `/orders/${orderId}/complete?dev=true`, null, driverToken);
  logStep("Result", compRes.data);

  // 7. FAVORITING
  logStep("7. Customer Favorites the Shop", { shopId });
  const favRes = await req('POST', `/users/favorites/${shopId}`, null, customerToken);
  logStep("Result", favRes.data);

  // 8. FINAL HOME VIEW
  logStep("8. Final Home Page Personalization Check", "Requesting /home");
  const homeRes = await req('GET', '/home', null, customerToken);
  logStep("Home Data", {
      favorites: homeRes.data.favorites?.map(f => f.shopId),
      regularShops: homeRes.data.regularShops?.map(r => r.shopId),
      recommended: homeRes.data.recommended?.map(r => r.shopId)
  });

  console.log("\n\x1b[32m=== DEMONSTRATION COMPLETE ===\x1b[0m\n");
  process.exit(0);
}

run();
