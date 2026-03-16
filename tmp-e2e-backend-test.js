const base = 'http://localhost:8080';
const phone = '7989330247';

const pretty = (value) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

async function callApi({ method, path, body, token }) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  return {
    status: response.status,
    body: json,
  };
}

function printStep(step, title, req, res) {
  console.log(`\n=== ${step} - ${title} ===`);
  console.log(`${req.method} ${req.path}`);
  if (req.body) {
    console.log('Request Body:', pretty(req.body));
  }
  console.log('Status:', res.status);
  console.log('Response:', pretty(res.body));
}

function assertOk(step, title, res, allowedStatuses = [200]) {
  if (!allowedStatuses.includes(res.status)) {
    console.log(`\nFAILED at ${step} - ${title}`);
    process.exit(1);
  }
}

(async () => {
  let accessToken = '';
  let shopId = '';
  let conversationId = '';

  const s1Req = { method: 'POST', path: '/auth/send-otp', body: { phone } };
  const s1Res = await callApi(s1Req);
  printStep('STEP 1', 'Send OTP', s1Req, s1Res);
  assertOk('STEP 1', 'Send OTP', s1Res, [200]);
  const otp = s1Res.body?.otp;
  if (!otp) {
    console.log('\nFAILED at STEP 1 - OTP missing in response');
    process.exit(1);
  }

  const s2Req = {
    method: 'POST',
    path: '/auth/verify-otp',
    body: {
      phone,
      otp,
      role: 'shop_owner',
      deviceId: 'dev-cli',
    },
  };
  const s2Res = await callApi(s2Req);
  printStep('STEP 2', 'Verify OTP', s2Req, s2Res);
  assertOk('STEP 2', 'Verify OTP', s2Res, [200]);
  accessToken = s2Res.body?.accessToken;
  const userId = s2Res.body?.user?.id;
  if (!accessToken || !userId) {
    console.log('\nFAILED at STEP 2 - accessToken or user.id missing');
    process.exit(1);
  }

  const s3Req = { method: 'GET', path: '/users/me', token: accessToken };
  const s3Res = await callApi(s3Req);
  printStep('STEP 3', 'Get Current User', s3Req, s3Res);
  assertOk('STEP 3', 'Get Current User', s3Res, [200]);

  const s4Req = {
    method: 'POST',
    path: '/shops',
    token: accessToken,
    body: {
      name: 'Test Grocery',
      category: 'grocery',
      phone: '7989330247',
      lat: 17.385,
      lng: 78.4867,
    },
  };
  const s4Res = await callApi(s4Req);
  printStep('STEP 4', 'Create Shop', s4Req, s4Res);
  assertOk('STEP 4', 'Create Shop', s4Res, [200, 201]);
  shopId = s4Res.body?.id || s4Res.body?.shopId;
  if (!shopId) {
    console.log('\nFAILED at STEP 4 - shopId missing in response');
    process.exit(1);
  }

  const s5Req = {
    method: 'POST',
    path: '/products',
    token: accessToken,
    body: {
      shopId,
      name: 'Milk 1L',
      description: 'Fresh milk',
      category: 'dairy',
      price: 60,
      stockQuantity: 50,
    },
  };
  const s5Res = await callApi(s5Req);
  printStep('STEP 5', 'Add Product', s5Req, s5Res);
  assertOk('STEP 5', 'Add Product', s5Res, [200, 201]);

  const s6Req = { method: 'GET', path: `/shops/${shopId}/products` };
  const s6Res = await callApi(s6Req);
  printStep('STEP 6', 'List Shop Products', s6Req, s6Res);
  assertOk('STEP 6', 'List Shop Products', s6Res, [200]);

  const s7Req = {
    method: 'GET',
    path: '/search/products?q=milk&lat=17.385&lng=78.4867&radius=5000',
  };
  const s7Res = await callApi(s7Req);
  printStep('STEP 7', 'Search Products', s7Req, s7Res);
  assertOk('STEP 7', 'Search Products', s7Res, [200]);

  const s8Req = {
    method: 'GET',
    path: '/shops/nearby?lat=17.385&lng=78.4867&radius=5000',
  };
  const s8Res = await callApi(s8Req);
  printStep('STEP 8', 'Find Nearby Shops', s8Req, s8Res);
  assertOk('STEP 8', 'Find Nearby Shops', s8Res, [200]);

  const s9Req = {
    method: 'POST',
    path: '/conversations',
    token: accessToken,
    body: { shopId },
  };
  const s9Res = await callApi(s9Req);
  printStep('STEP 9', 'Create Conversation', s9Req, s9Res);
  assertOk('STEP 9', 'Create Conversation', s9Res, [200, 201]);
  conversationId = s9Res.body?.id || s9Res.body?.conversationId;
  if (!conversationId) {
    console.log('\nFAILED at STEP 9 - conversationId missing in response');
    process.exit(1);
  }

  const s10Req = {
    method: 'POST',
    path: '/messages',
    token: accessToken,
    body: {
      conversationId,
      message: 'Milk 1L price?',
    },
  };
  const s10Res = await callApi(s10Req);
  printStep('STEP 10', 'Send Message', s10Req, s10Res);
  assertOk('STEP 10', 'Send Message', s10Res, [200, 201]);

  const s11Req = {
    method: 'GET',
    path: `/conversations/${conversationId}/messages`,
    token: accessToken,
  };
  const s11Res = await callApi(s11Req);
  printStep('STEP 11', 'Fetch Messages', s11Req, s11Res);
  assertOk('STEP 11', 'Fetch Messages', s11Res, [200]);

  console.log('\n=== OUTPUT SUMMARY ===');
  console.log('Auth ✔');
  console.log('User ✔');
  console.log('Shop ✔');
  console.log('Products ✔');
  console.log('Search ✔');
  console.log('Nearby shops ✔');
  console.log('Conversation ✔');
  console.log('Messages ✔');
})();