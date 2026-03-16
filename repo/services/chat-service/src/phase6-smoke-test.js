// Phase-6 chat smoke test: node repo/services/chat-service/src/phase6-smoke-test.js
const { WebSocket } = require("ws");

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

  const openSocket = (token) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket("ws://localhost:8080/ws/chat", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const timer = setTimeout(() => reject(new Error("ws open timeout")), 8000);

      ws.on("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });

      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  console.log("=== Phase-6 Real-Time Chat Smoke Test ===");

  const customerPhone = "7036000001";
  const ownerPhone = "7036000002";

  const sendCustomer = await post("/auth/send-otp", { phone: customerPhone });
  const verifyCustomer = await post("/auth/verify-otp", {
    phone: customerPhone,
    otp: sendCustomer.body.otp,
    role: "customer",
    deviceId: "phase6-customer",
  });
  const customerToken = verifyCustomer.body.accessToken;
  check("customer auth works", verifyCustomer.status === 200 && !!customerToken, verifyCustomer);

  const sendOwner = await post("/auth/send-otp", { phone: ownerPhone });
  const verifyOwner = await post("/auth/verify-otp", {
    phone: ownerPhone,
    otp: sendOwner.body.otp,
    role: "shop_owner",
    deviceId: "phase6-owner",
  });
  const ownerToken = verifyOwner.body.accessToken;
  check("shop owner auth works", verifyOwner.status === 200 && !!ownerToken, verifyOwner);

  const createShop = await post(
    "/shops",
    {
      name: "Chat Smoke Shop",
      category: "grocery",
      phone: "9876511111",
      lat: 17.381,
      lng: 78.481,
    },
    ownerToken
  );
  check("shop created", createShop.status === 201 && !!createShop.body.id, createShop);

  const createConversation = await post(
    "/conversations",
    { shopId: createShop.body.id },
    customerToken
  );
  check("conversation created", createConversation.status === 200 && !!createConversation.body.id, createConversation);

  const createConversationAgain = await post(
    "/conversations",
    { shopId: createShop.body.id },
    customerToken
  );
  check(
    "conversation reused for customer-shop pair",
    createConversationAgain.status === 200 && createConversationAgain.body.id === createConversation.body.id,
    createConversationAgain
  );

  const conversationId = createConversation.body.id;

  const customerWs = await openSocket(customerToken);
  const ownerWs = await openSocket(ownerToken);
  check("websocket connects for both users", true);

  const ownerInbox = [];
  const customerInbox = [];

  ownerWs.on("message", (raw) => {
    try {
      ownerInbox.push(JSON.parse(raw.toString()));
    } catch (_err) {
      // ignore malformed non-json messages
    }
  });

  customerWs.on("message", (raw) => {
    try {
      customerInbox.push(JSON.parse(raw.toString()));
    } catch (_err) {
      // ignore malformed non-json messages
    }
  });

  customerWs.send(
    JSON.stringify({
      type: "message",
      conversationId,
      message: "Milk 1L price?",
    })
  );

  await wait(1000);

  ownerWs.send(
    JSON.stringify({
      type: "message",
      conversationId,
      message: "60 INR",
    })
  );

  await wait(1000);

  check(
    "owner receives customer websocket message",
    ownerInbox.some((m) => m.conversationId === conversationId && m.message === "Milk 1L price?"),
    ownerInbox
  );

  check(
    "customer receives owner websocket reply",
    customerInbox.some((m) => m.conversationId === conversationId && m.message === "60 INR"),
    customerInbox
  );

  const httpMessage = await post(
    "/messages",
    {
      conversationId,
      message: "Can you do 55 INR?",
    },
    customerToken
  );

  check("HTTP fallback message works", httpMessage.status === 201, httpMessage);

  await wait(1000);

  check(
    "owner receives HTTP fallback message in realtime",
    ownerInbox.some((m) => m.conversationId === conversationId && m.message === "Can you do 55 INR?"),
    ownerInbox
  );

  const history = await get(`/conversations/${conversationId}/messages`, ownerToken);
  check("message history endpoint returns 200", history.status === 200, history);
  check("message history returns items", Array.isArray(history.body.items), history.body);
  check("message history contains latest fallback message", history.body.items.some((m) => m.message === "Can you do 55 INR?"), history.body.items);

  customerWs.close();
  ownerWs.close();

  console.log(`=== Results: ${pass} passed, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
})().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
