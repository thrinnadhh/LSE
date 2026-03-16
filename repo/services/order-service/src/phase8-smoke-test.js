// Phase-8 lifecycle smoke test: node repo/services/order-service/src/phase8-smoke-test.js
(async () => {
  const base = "http://localhost:8080";
  const shopId = "6e913887-13aa-4c74-ba14-f7337be29b41";

  const phones = {
    customer: "7989330247",
    owner: "9999999999",
    driver: "7999011111",
    admin: "7999012222",
  };

  const post = async (path, body, token) => {
    const res = await fetch(base + path, {
      method: "POST",
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

  const auth = async (phone, role, deviceId) => {
    const send = await post("/auth/send-otp", { phone });
    const verify = await post("/auth/verify-otp", {
      phone,
      otp: send.body.otp,
      role,
      deviceId,
    });

    return verify.body.accessToken;
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
    console.error(`  FAIL ${label}`, JSON.stringify(detail));
  };

  console.log("=== Phase-8 Lifecycle Smoke Test ===");

  const customerToken = await auth(phones.customer, "customer", "p8-smoke-customer");
  const ownerToken = await auth(phones.owner, "shop_owner", "p8-smoke-owner");
  const driverToken = await auth(phones.driver, "driver", "p8-smoke-driver");
  const adminToken = await auth(phones.admin, "admin", "p8-smoke-admin");

  const conversation = await post("/conversations", { shopId }, customerToken);
  check("conversation created", conversation.status === 200, conversation);

  const products = await get(`/shops/${shopId}/products`);
  const product = (products.body.items || []).find((it) => String(it.name || "").toLowerCase().includes("milk")) || (products.body.items || [])[0];
  check("product exists for quote", !!product?.id, products);

  const quote = await post(
    "/quotes",
    {
      conversationId: conversation.body.id,
      items: [{ productId: product.id, quantity: 1, price: 55 }],
    },
    ownerToken
  );
  check("quote created", quote.status === 201 && quote.body.status === "PENDING", quote);

  const accept = await post(`/quotes/${quote.body.quoteId}/accept`, null, customerToken);
  check("quote accepted and order created", accept.status === 200 && !!accept.body.orderId, accept);

  const orderId = accept.body.orderId;

  const confirm = await post(`/orders/${orderId}/confirm`, null, ownerToken);
  check("order confirmed", confirm.status === 200 && confirm.body.status === "CONFIRMED", confirm);

  const driverLocation = await post("/drivers/location", { lat: 17.385, lng: 78.4867 }, driverToken);
  check("driver location updated", driverLocation.status === 200 && !!driverLocation.body.driverId, driverLocation);

  const assign = await post(`/orders/${orderId}/assign-driver`, { driverId: driverLocation.body.driverId }, adminToken);
  check("driver assigned", assign.status === 200 && assign.body.status === "ASSIGNED", assign);

  const pickup = await post(`/orders/${orderId}/pickup`, null, driverToken);
  check("pickup transition", pickup.status === 200 && pickup.body.status === "PICKED_UP", pickup);

  const startDelivery = await post(`/orders/${orderId}/start-delivery`, null, driverToken);
  check("start-delivery transition", startDelivery.status === 200 && startDelivery.body.status === "DELIVERING", startDelivery);

  const complete = await post(`/orders/${orderId}/complete`, null, driverToken);
  check("complete transition", complete.status === 200 && complete.body.status === "DELIVERED", complete);

  const customerOrder = await get(`/orders/${orderId}`, customerToken);
  check("customer order fetch", customerOrder.status === 200 && customerOrder.body.status === "DELIVERED", customerOrder);

  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})();
