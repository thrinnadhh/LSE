// Phase-7 quote negotiation smoke test: node repo/services/chat-service/src/phase7-smoke-test.js
(async () => {
  const base = "http://localhost:8080";

  const post = async (path, body, token) => {
    const res = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      parsed = { raw: text };
    }

    return { status: res.status, body: parsed };
  };

  const get = async (path, token) => {
    const res = await fetch(base + path, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      parsed = { raw: text };
    }

    return { status: res.status, body: parsed };
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

  console.log("=== Phase-7 Quote / Negotiation Smoke Test ===");

  const customerPhone = "7047000001";
  const ownerPhone = "7047000002";

  const sendCustomer = await post("/auth/send-otp", { phone: customerPhone });
  const verifyCustomer = await post("/auth/verify-otp", {
    phone: customerPhone,
    otp: sendCustomer.body.otp,
    role: "customer",
    deviceId: "phase7-customer",
  });
  const customerToken = verifyCustomer.body.accessToken;
  check("customer auth works", verifyCustomer.status === 200 && !!customerToken, verifyCustomer);

  const sendOwner = await post("/auth/send-otp", { phone: ownerPhone });
  const verifyOwner = await post("/auth/verify-otp", {
    phone: ownerPhone,
    otp: sendOwner.body.otp,
    role: "shop_owner",
    deviceId: "phase7-owner",
  });
  const ownerToken = verifyOwner.body.accessToken;
  check("shop owner auth works", verifyOwner.status === 200 && !!ownerToken, verifyOwner);

  const createShop = await post(
    "/shops",
    {
      name: "Quote Smoke Shop",
      category: "grocery",
      phone: "9888800011",
      lat: 17.381,
      lng: 78.481,
    },
    ownerToken
  );
  check("shop created", createShop.status === 201 && !!createShop.body.id, createShop);

  const createProduct = await post(
    "/products",
    {
      shopId: createShop.body.id,
      name: "Milk 1L",
      description: "Fresh milk",
      category: "dairy",
      price: 60,
      stock: 50,
    },
    ownerToken
  );
  check("product created", createProduct.status === 201 && !!createProduct.body.id, createProduct);

  const createConversation = await post(
    "/conversations",
    { shopId: createShop.body.id },
    customerToken
  );
  check("conversation created", createConversation.status === 200 && !!createConversation.body.id, createConversation);

  const quoteDenied = await post(
    "/quotes",
    {
      conversationId: createConversation.body.id,
      items: [{ productId: createProduct.body.id, quantity: 1, price: 55 }],
    },
    customerToken
  );
  check("customer cannot create quote", quoteDenied.status === 403, quoteDenied);

  const createQuote = await post(
    "/quotes",
    {
      conversationId: createConversation.body.id,
      items: [{ productId: createProduct.body.id, quantity: 1, price: 55 }],
    },
    ownerToken
  );

  check(
    "shop owner creates quote",
    createQuote.status === 201 && createQuote.body.status === "PENDING" && Number(createQuote.body.totalPrice) === 55,
    createQuote
  );

  const listQuotesCustomer = await get(`/conversations/${createConversation.body.id}/quotes`, customerToken);
  check("customer can list quotes", listQuotesCustomer.status === 200, listQuotesCustomer);
  check(
    "listed quote includes line item",
    Array.isArray(listQuotesCustomer.body.items)
      && listQuotesCustomer.body.items.length > 0
      && Array.isArray(listQuotesCustomer.body.items[0].items)
      && listQuotesCustomer.body.items[0].items[0].productName === "Milk 1L",
    listQuotesCustomer.body
  );

  const acceptDenied = await post(`/quotes/${createQuote.body.quoteId}/accept`, {}, ownerToken);
  check("shop owner cannot accept quote", acceptDenied.status === 403, acceptDenied);

  const acceptQuote = await post(`/quotes/${createQuote.body.quoteId}/accept`, {}, customerToken);
  check(
    "customer accepts quote",
    acceptQuote.status === 200 && acceptQuote.body.status === "ACCEPTED",
    acceptQuote
  );

  const listAfterAccept = await get(`/conversations/${createConversation.body.id}/quotes`, customerToken);
  check(
    "quote status persisted as ACCEPTED",
    listAfterAccept.status === 200
      && Array.isArray(listAfterAccept.body.items)
      && listAfterAccept.body.items.some((q) => q.quoteId === createQuote.body.quoteId && q.status === "ACCEPTED"),
    listAfterAccept
  );

  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
