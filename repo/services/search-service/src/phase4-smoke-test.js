// Phase-4 smoke test: node repo/services/search-service/src/phase4-smoke-test.js
(async () => {
  const base = "http://localhost:8080";

  const post = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

    return { status: response.status, body: await response.json() };
  };

  const get = async (path) => {
    const response = await fetch(base + path);
    return { status: response.status, body: await response.json() };
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

  console.log("=== Phase-4 Product Search Smoke Test ===");

  const authSend = await post("/auth/send-otp", { phone: "7005000001" });
  const authVerify = await post("/auth/verify-otp", {
    phone: "7005000001",
    otp: authSend.body.otp,
    role: "shop_owner",
    deviceId: "phase4-owner",
  });
  const token = authVerify.body.accessToken;
  check("owner auth works", authVerify.status === 200 && !!token, authVerify);

  const shop = await post(
    "/shops",
    {
      name: "Search Grocery",
      category: "grocery",
      phone: "9999999999",
      lat: 17.385,
      lng: 78.4867,
    },
    token
  );
  check("shop created", shop.status === 201 && !!shop.body.id, shop);

  const product = await post(
    "/products",
    {
      shopId: shop.body.id,
      name: "Milk 1L",
      description: "Fresh milk",
      category: "dairy",
      price: 60,
      stock: 50,
    },
    token
  );
  check("product created", product.status === 201 && !!product.body.id, product);

  await new Promise((resolve) => setTimeout(resolve, 1500));

  const search = await get("/search/products?q=milk&lat=17.385&lng=78.4867&radius=5000");
  check("search endpoint returns 200", search.status === 200, search);
  check("search returns items array", Array.isArray(search.body.items), search.body);
  check(
    "search contains Milk 1L",
    search.body.items.some((item) => item.productName === "Milk 1L" && item.shopName === "Search Grocery"),
    search.body
  );

  if (search.body.items.length > 0) {
    check("search result has distance", typeof search.body.items[0].distance === "number", search.body.items[0]);
  }

  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});