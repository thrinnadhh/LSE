const http = require('http');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal"
});

const API_BASE = 'http://127.0.0.1:3000';

async function req(method, path, body, token) {
  return new Promise((resolve) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const request = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    request.on('error', (err) => {
        console.error("Request Error:", err.message);
        resolve({ status: 500, data: { error: err.message } });
    });

    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokens() {
  // Customer
  await req('POST', '/auth/send-otp', { phone: '+10000000002' });
  const custRes = await req('POST', '/auth/verify-otp', { phone: '+10000000002', otp: '123456' });
  
  // Shop Owner
  await req('POST', '/auth/send-otp', { phone: '+10000000001' });
  const ownerRes = await req('POST', '/auth/verify-otp', { phone: '+10000000001', otp: '123456' });

  // Driver
  await req('POST', '/auth/send-otp', { phone: '+10000000003' });
  const driverRes = await req('POST', '/auth/verify-otp', { phone: '+10000000003', otp: '123456' });

  return {
    customerToken: custRes.data.accessToken,
    ownerToken: ownerRes.data.accessToken,
    driverToken: driverRes.data.accessToken,
    customerId: custRes.data.user.id,
    ownerId: ownerRes.data.user.id
  };
}

async function run() {
  console.log("Starting Phase 12.2 Verification...");
  const tokens = await getTokens();
  const results = {
    quote: "FAIL",
    orderCreation: "FAIL",
    orderCompletion: "FAIL",
    statsUpdate: "FAIL",
    homePersonalization: "FAIL",
    dashboard: "FAIL",
    repeatBehavior: "FAIL",
    overall: "FAIL"
  };

  try {
    // SETUP: Ensure Shop
    let shopsRes = await req('GET', '/shops', null, tokens.customerToken);
    let shopId = shopsRes.data[0]?.id;
    if (!shopId) {
      const sAdd = await req('POST', '/shops', { name: "Verification Shop", category: "grocery", lat: 12.97, lng: 77.59 }, tokens.ownerToken);
      shopId = sAdd.data.id;
    }
    console.log("Using shopId:", shopId);

    // SETUP: Ensure Product
    const pList = await req('GET', `/shops/${shopId}/products`, null, tokens.customerToken);
    let productId = pList.data.items?.[0]?.id;
    if (!productId) {
      const pAdd = await req('POST', `/products`, {
        shopId, 
        name: "Verification Item", 
        price: 150, 
        category: "grocery",
        stock: 100
      }, tokens.ownerToken);
      productId = pAdd.data.id;
    }
    console.log("Using productId:", productId);

    if (!productId) {
        console.error("Critical Failure: Could not get/create productId");
        process.exit(1);
    }

    // STEP 1: CREATE CONVERSATION & QUOTE
    const convRes = await req('POST', '/chat/conversations', { shopId }, tokens.customerToken);
    const conversationId = convRes.data.id;
    
    const q1Res = await req('POST', '/chat/quotes', {
      conversationId,
      items: [{ productId, quantity: 1, price: 150 }]
    }, tokens.ownerToken);

    if ((q1Res.status === 200 || q1Res.status === 201) && q1Res.data.quoteId) {
      results.quote = "PASS";
    }
    const q1Id = q1Res.data.quoteId;

    // STEP 2: ACCEPT QUOTE
    let o1Id;
    if (q1Id) {
      const accRes = await req('POST', `/chat/quotes/${q1Id}/accept`, null, tokens.customerToken);
      if ((accRes.status === 200 || accRes.status === 201) && accRes.data.orderId) {
        results.orderCreation = "PASS";
        o1Id = accRes.data.orderId;
      }
    }

    // STEP 3: VERIFY ORDER EXISTS
    if (o1Id) {
      const getO1 = await req('GET', `/orders/${o1Id}`, null, tokens.customerToken);
      if (getO1.status !== 200) results.orderCreation = "FAIL";
    }

    // STEP 4: FORCE COMPLETION
    if (o1Id) {
      await req('POST', `/orders/${o1Id}/confirm`, null, tokens.ownerToken);
      await sleep(100);
      await req('POST', `/orders/${o1Id}/complete?dev=true`, null, tokens.driverToken);
      
      const finalO1 = await req('GET', `/orders/${o1Id}`, null, tokens.customerToken);
      if (finalO1.data.status === 'DELIVERED') {
        results.orderCompletion = "PASS";
      }
    }

    // STEP 5: VERIFY DB STATS
    await sleep(500);
    const { rows: statsRows } = await pool.query(
      "SELECT order_count FROM shop_customer_stats WHERE customer_id = $1 AND shop_id = $2",
      [tokens.customerId, shopId]
    );
    if (statsRows.length > 0 && statsRows[0].order_count >= 1) {
      results.statsUpdate = "PASS";
    }

    // STEP 6: VERIFY HOME PERSONALIZATION
    const hRes = await req('GET', '/home', null, tokens.customerToken);
    const inRec = hRes.data.recommended?.some(s => s.shopId === shopId);
    const inReg = hRes.data.regularShops?.some(s => s.shopId === shopId);
    if (inRec || inReg) {
      results.homePersonalization = "PASS";
    }

    // STEP 7: VERIFY DASHBOARD
    const dRes = await req('GET', '/shops/dashboard', null, tokens.ownerToken);
    if (dRes.data.totalOrders > 0) {
      results.dashboard = "PASS";
    }

    // STEP 8: REPEAT ORDER
    const q2R = await req('POST', '/chat/quotes', {
      conversationId,
      items: [{ productId, quantity: 1, price: 120 }]
    }, tokens.ownerToken);
    const o2R = await req('POST', `/chat/quotes/${q2R.data.quoteId}/accept`, null, tokens.customerToken);
    const o2Id = o2R.data.orderId;
    await req('POST', `/orders/${o2Id}/confirm`, null, tokens.ownerToken);
    await sleep(100);
    await req('POST', `/orders/${o2Id}/complete?dev=true`, null, tokens.driverToken);
    
    await sleep(500);
    const { rows: statsRows2 } = await pool.query(
      "SELECT order_count FROM shop_customer_stats WHERE customer_id = $1 AND shop_id = $2",
      [tokens.customerId, shopId]
    );
    if (statsRows2[0]?.order_count > (statsRows[0]?.order_count || 0)) {
      results.repeatBehavior = "PASS";
    }

    // OVERALL
    const allPass = Object.keys(results).every(k => k === 'overall' || results[k] === "PASS");
    results.overall = allPass ? "PASS" : "FAIL";

  } catch (err) {
    console.error("Test execution aborted:", err.message);
  } finally {
    console.log(JSON.stringify(results, null, 2));
    await pool.end();
    process.exit(results.overall === "PASS" ? 0 : 1);
  }
}

run();
