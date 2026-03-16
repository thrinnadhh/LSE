/* eslint-disable no-console */
const WebSocket = require("ws");

const base = "http://localhost:8080";

async function http(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch (_err) {
    return { status: res.status, body: { raw: text } };
  }
}

async function auth(phone, role, deviceId) {
  const send = await http("POST", "/auth/send-otp", { phone });
  const verify = await http("POST", "/auth/verify-otp", {
    phone,
    otp: send.body.otp,
    role,
    deviceId,
  });
  return verify.body.accessToken;
}

function connectWs(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:8080/ws");
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "AUTH", token }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "AUTH_OK") {
        clearTimeout(timer);
        resolve(ws);
      }
    });

    ws.on("error", reject);
  });
}

function waitFor(ws, predicate, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("waitFor timeout"));
    }, timeoutMs);

    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (predicate(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    }

    ws.on("message", onMessage);
  });
}

(async () => {
  const stamp = String(Date.now()).slice(-6);
  const ownerToken = await auth(`71${stamp}01`, "shop_owner", "p10-owner");
  const customerToken = await auth(`71${stamp}02`, "customer", "p10-customer");
  const driverToken = await auth(`71${stamp}03`, "driver", "p10-driver");

  const shop = await http("POST", "/shops", {
    name: `P10 Shop ${stamp}`,
    category: "grocery",
    phone: "9999999999",
    lat: 17.385,
    lng: 78.4867,
  }, ownerToken);

  const product = await http("POST", "/products", {
    shopId: shop.body.id,
    name: "P10 Milk",
    category: "dairy",
    price: 55,
    stock: 50,
  }, ownerToken);

  await http("POST", "/drivers/location", { lat: 17.385, lng: 78.4867 }, driverToken);

  const conversation = await http("POST", "/conversations", { shopId: shop.body.id }, customerToken);
  const quote = await http("POST", "/quotes", {
    conversationId: conversation.body.id,
    items: [{ productId: product.body.id, quantity: 1, price: 55 }],
  }, ownerToken);
  const accepted = await http("POST", `/quotes/${quote.body.quoteId}/accept`, undefined, customerToken);
  const orderId = accepted.body.orderId;

  let assignedOrder;
  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const current = await http("GET", `/orders/${orderId}`, undefined, customerToken);
    if (current.body?.status === "ASSIGNED" && current.body?.driverId) {
      assignedOrder = current.body;
      break;
    }
  }

  if (!assignedOrder) {
    throw new Error("order did not become ASSIGNED in time");
  }

  const driverWs = await connectWs(driverToken);
  const customerWs = await connectWs(customerToken);
  const ownerWs = await connectWs(ownerToken);

  customerWs.send(JSON.stringify({ type: "SUBSCRIBE_ORDER", orderId }));
  ownerWs.send(JSON.stringify({ type: "SUBSCRIBE_ORDER", orderId }));

  await waitFor(customerWs, (m) => m.type === "SUBSCRIBED_ORDER" && m.orderId === orderId);
  await waitFor(ownerWs, (m) => m.type === "SUBSCRIBED_ORDER" && m.orderId === orderId);

  driverWs.send(JSON.stringify({
    type: "DRIVER_LOCATION",
    orderId,
    lat: 17.386,
    lng: 78.487,
    speed: 30,
    heading: 80,
  }));

  const customerLocation = await waitFor(
    customerWs,
    (m) => m.type === "DRIVER_LOCATION_UPDATE" && m.orderId === orderId
  );
  const ownerLocation = await waitFor(ownerWs, (m) => m.type === "DRIVER_LOCATION_UPDATE" && m.orderId === orderId);
  const customerEta = await waitFor(customerWs, (m) => m.type === "ETA_UPDATE" && m.orderId === orderId);

  await http("POST", `/orders/${orderId}/pickup`, undefined, driverToken);
  const statusEvent = await waitFor(customerWs, (m) => m.type === "ORDER_STATUS" && m.orderId === orderId);

  console.log(
    JSON.stringify(
      {
        orderId,
        driverId: assignedOrder.driverId,
        locationReceivedByCustomer: customerLocation.type,
        locationReceivedByShop: ownerLocation.type,
        etaSeconds: customerEta.etaSeconds,
        statusEvent: statusEvent.status,
      },
      null,
      2
    )
  );

  driverWs.close();
  customerWs.close();
  ownerWs.close();
})();
