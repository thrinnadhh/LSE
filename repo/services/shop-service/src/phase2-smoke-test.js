// Phase-2 smoke test — run with: node repo/services/shop-service/src/phase2-smoke-test.js
(async () => {
  const base = "http://localhost:8080";

  const post = async (path, body, token) => {
    const r = await fetch(base + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: "Bearer " + token } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  const get = async (path, token) => {
    const r = await fetch(base + path, {
      headers: token ? { authorization: "Bearer " + token } : {},
    });
    return { status: r.status, body: await r.json() };
  };

  const put = async (path, body, token) => {
    const r = await fetch(base + path, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  const patch = async (path, body, token) => {
    const r = await fetch(base + path, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  let pass = 0;
  let fail = 0;

  function check(label, condition, detail) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ ${label}`, detail !== undefined ? `(got: ${JSON.stringify(detail)})` : "");
      fail++;
    }
  }

  console.log("\n=== Phase-2 Shop Service Smoke Test ===\n");

  // ── Auth: shop_owner ──
  const a1 = await post("/auth/send-otp", { phone: "7002000001" });
  const v1 = await post("/auth/verify-otp", { phone: "7002000001", otp: a1.body.otp, role: "shop_owner", deviceId: "d1" });
  const ownerToken = v1.body.accessToken;
  check("shop_owner auth", ownerToken, v1.body);

  // ── Auth: customer ──
  const a2 = await post("/auth/send-otp", { phone: "7002000002" });
  const v2 = await post("/auth/verify-otp", { phone: "7002000002", otp: a2.body.otp, role: "customer", deviceId: "d2" });
  const custToken = v2.body.accessToken;
  check("customer auth", custToken, v2.body);

  // ── POST /shops ──
  console.log("\n[POST /shops]");
  const createRes = await post("/shops", { name: "Smoke Test Shop", category: "grocery", phone: "9876543210", lat: 17.385, lng: 78.4867 }, ownerToken);
  check("status 201", createRes.status === 201, createRes.status);
  check("has id", !!createRes.body.id, createRes.body);
  check("has acceptingOrders field", typeof createRes.body.acceptingOrders === "boolean", createRes.body);
  check("has isOpen field", typeof createRes.body.isOpen === "boolean", createRes.body);
  const shopId = createRes.body.id;

  // ── GET /shops/:id ──
  console.log("\n[GET /shops/:id]");
  const getRes = await get(`/shops/${shopId}`);
  check("status 200", getRes.status === 200, getRes.status);
  check("correct id", getRes.body.id === shopId, getRes.body.id);
  check("has lat/lng", getRes.body.lat !== null && getRes.body.lng !== null, getRes.body);

  // ── PUT /shops/:id ──
  console.log("\n[PUT /shops/:id]");
  const putRes = await put(`/shops/${shopId}`, { description: "Updated desc" }, ownerToken);
  check("status 200", putRes.status === 200, putRes.status);
  check("description updated", putRes.body.description === "Updated desc", putRes.body.description);

  // ── PATCH /shops/:id/availability ──
  console.log("\n[PATCH /shops/:id/availability]");
  const patchRes = await patch(`/shops/${shopId}/availability`, { acceptingOrders: false }, ownerToken);
  check("status 200", patchRes.status === 200, patchRes.status);
  check("acceptingOrders is false", patchRes.body.acceptingOrders === false, patchRes.body.acceptingOrders);

  // Toggle back on
  const patchOn = await patch(`/shops/${shopId}/availability`, { acceptingOrders: true }, ownerToken);
  check("toggle back on (200)", patchOn.status === 200, patchOn.status);
  check("acceptingOrders is true", patchOn.body.acceptingOrders === true, patchOn.body.acceptingOrders);

  // Customer cannot PATCH availability
  const custPatch = await patch(`/shops/${shopId}/availability`, { acceptingOrders: false }, custToken);
  check("customer gets 403", custPatch.status === 403, custPatch.status);

  // ── GET /shops/nearby ──
  console.log("\n[GET /shops/nearby]");
  const nearbyRes = await get("/shops/nearby?lat=17.3850&lng=78.4867&radius=5000");
  check("status 200", nearbyRes.status === 200, nearbyRes.status);
  check("returns items array", Array.isArray(nearbyRes.body.items), nearbyRes.body);
  check("at least one shop in range", nearbyRes.body.items.length >= 1, nearbyRes.body.items.length);
  if (nearbyRes.body.items.length > 0) {
    check("items have distance field", nearbyRes.body.items[0].distance !== undefined, nearbyRes.body.items[0]);
    check("items sorted by distance", nearbyRes.body.items[0].distance <= (nearbyRes.body.items[1]?.distance ?? Infinity), nearbyRes.body.items.map(i => i.distance));
  }

  // ── Authorization: customer cannot create shop ──
  console.log("\n[Authorization]");
  const forbidRes = await post("/shops", { name: "Bad Shop", category: "grocery", phone: "9876543211", lat: 17.38, lng: 78.48 }, custToken);
  check("customer POST /shops gets 403", forbidRes.status === 403, forbidRes.status);

  // ── Regression: auth endpoints still work ──
  console.log("\n[Regression: auth endpoints]");
  const meRes = await get("/users/me", ownerToken);
  check("GET /users/me returns 200", meRes.status === 200, meRes.status);

  // ── Summary ──
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
