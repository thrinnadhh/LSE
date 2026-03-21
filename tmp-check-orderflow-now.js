const base = "http://localhost:8080";

async function req(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return { status: res.status, body: parsed };
}

(async () => {
  const seed = Date.now().toString().slice(-6);
  const customerPhone = `7998${seed}`;
  const ownerPhone = `7997${seed}`;

  const sendCustomer = await req("POST", "/auth/send-otp", {
    body: { phone: customerPhone },
  });
  const verifyCustomer = await req("POST", "/auth/verify-otp", {
    body: {
      phone: customerPhone,
      otp: sendCustomer.body?.otp || "123456",
      role: "customer",
      deviceId: "of-c",
    },
  });

  const sendOwner = await req("POST", "/auth/send-otp", {
    body: { phone: ownerPhone },
  });
  const verifyOwner = await req("POST", "/auth/verify-otp", {
    body: {
      phone: ownerPhone,
      otp: sendOwner.body?.otp || "123456",
      role: "shop_owner",
      deviceId: "of-o",
    },
  });

  const customerToken = verifyCustomer.body?.accessToken;
  const ownerToken = verifyOwner.body?.accessToken;

  const createShop = await req("POST", "/shops", {
    token: ownerToken,
    body: {
      name: `OF Shop ${seed}`,
      category: "grocery",
      phone: "9000012345",
      lat: 17.385,
      lng: 78.4867,
    },
  });

  const shopId = createShop.body?.id;

  const createProduct = await req("POST", "/products", {
    token: ownerToken,
    body: {
      shopId,
      name: `OF milk ${seed}`,
      description: "milk",
      category: "dairy",
      price: 50,
      stock: 10,
    },
  });

  const productId = createProduct.body?.id;

  const createOrder = await req("POST", "/orders", {
    token: customerToken,
    body: {
      shopId,
      items: [{ productId, quantity: 2 }],
      addressId: null,
    },
  });

  const orderId = createOrder.body?.orderId;

  const confirm = orderId
    ? await req("POST", `/orders/${orderId}/confirm`, { token: ownerToken })
    : { status: 0, body: {} };

  const complete = orderId
    ? await req("POST", `/orders/${orderId}/complete`, { token: customerToken })
    : { status: 0, body: {} };

  const finalOrder = orderId
    ? await req("GET", `/orders/${orderId}`, { token: customerToken })
    : { status: 0, body: {} };

  console.log(
    JSON.stringify(
      {
        sendOtpCustomer: sendCustomer.status,
        verifyCustomer: verifyCustomer.status,
        verifyOwner: verifyOwner.status,
        createShop: createShop.status,
        createProduct: createProduct.status,
        createOrder: createOrder.status,
        createOrderBody: createOrder.body,
        confirm: confirm.status,
        complete: complete.status,
        finalStatus: finalOrder.body?.status || null,
      },
      null,
      2
    )
  );
})();
