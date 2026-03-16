// Phase-3 smoke test: node repo/services/product-service/src/phase3-smoke-test.js
(async () => {
  const base = "http://localhost:8080";

  const post = async (path, body, token) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  const get = async (path, token) => {
    const res = await fetch(base + path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return { status: res.status, body: await res.json() };
  };

  const patch = async (path, body, token) => {
    const res = await fetch(base + path, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };

  let pass = 0;
  let fail = 0;

  const check = (label, ok, detail) => {
    if (ok) {
      pass += 1;
      console.log(`  OK ${label}`);
      return;
    }

    fail += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail));
  };

  console.log("=== Phase-3 Products & Inventory Smoke Test ===");

  const ownerPhone = "7004000001";
  const customerPhone = "7004000002";

  const sendOwner = await post("/auth/send-otp", { phone: ownerPhone });
  const ownerOtp = sendOwner.body.otp;
  const verifyOwner = await post("/auth/verify-otp", {
    phone: ownerPhone,
    otp: ownerOtp,
    role: "shop_owner",
    deviceId: "phase3-owner",
  });
  const ownerToken = verifyOwner.body.accessToken;
  check("owner auth works", verifyOwner.status === 200 && !!ownerToken, verifyOwner);

  const sendCustomer = await post("/auth/send-otp", { phone: customerPhone });
  const customerOtp = sendCustomer.body.otp;
  const verifyCustomer = await post("/auth/verify-otp", {
    phone: customerPhone,
    otp: customerOtp,
    role: "customer",
    deviceId: "phase3-customer",
  });
  const customerToken = verifyCustomer.body.accessToken;
  check("customer auth works", verifyCustomer.status === 200 && !!customerToken, verifyCustomer);

  const createShop = await post(
    "/shops",
    {
      name: "Phase3 Shop",
      category: "grocery",
      phone: "9999999999",
      lat: 17.385,
      lng: 78.4867,
    },
    ownerToken
  );

  check("shop created", createShop.status === 201 && !!createShop.body.id, createShop);
  const shopId = createShop.body.id;

  const createProduct = await post(
    "/products",
    {
      shopId,
      name: "Milk 1L",
      description: "Fresh milk",
      category: "dairy",
      price: 60,
      stock: 50,
    },
    ownerToken
  );

  check("POST /products returns 201", createProduct.status === 201, createProduct);
  check("created product has shopId", createProduct.body.shopId === shopId, createProduct.body);
  check("created product has stock", createProduct.body.stockQuantity === 50, createProduct.body);

  const productId = createProduct.body.id;

  const getShopProducts = await get(`/shops/${shopId}/products`);
  check("GET /shops/{shopId}/products returns 200", getShopProducts.status === 200, getShopProducts);
  check("shop products contains created product", getShopProducts.body.items.some((p) => p.id === productId), getShopProducts.body);

  const getProduct = await get(`/products/${productId}`);
  check("GET /products/{id} returns 200", getProduct.status === 200, getProduct);
  check("GET /products/{id} returns inventory", getProduct.body.stockQuantity === 50 && getProduct.body.inStock === true, getProduct.body);

  const updateInventory = await patch(`/inventory/${productId}`, { stockQuantity: 100 }, ownerToken);
  check("PATCH /inventory/{productId} returns 200", updateInventory.status === 200, updateInventory);
  check("inventory updated to 100", updateInventory.body.stockQuantity === 100, updateInventory.body);

  const customerCreate = await post(
    "/products",
    {
      shopId,
      name: "Should Fail",
      category: "dairy",
      price: 10,
      stock: 1,
    },
    customerToken
  );
  check("customer cannot create products", customerCreate.status === 403, customerCreate);

  const customerPatch = await patch(`/inventory/${productId}`, { stockQuantity: 3 }, customerToken);
  check("customer cannot update inventory", customerPatch.status === 403, customerPatch);

  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
