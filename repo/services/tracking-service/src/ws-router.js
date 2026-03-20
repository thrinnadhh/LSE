const { WebSocket } = require("ws");
const { z } = require("zod");
const { authenticateToken } = require("./auth");
const { calculateEtaSeconds, calculateDistanceKm, DEFAULT_SPEED_KMH } = require("./eta");
const { authorizeOrderSubscription } = require("./subscriptions");

const authSchema = z.object({
  type: z.literal("AUTH"),
  token: z.string().min(20),
});

const subscribeOrderSchema = z.object({
  type: z.literal("SUBSCRIBE_ORDER"),
  orderId: z.string().uuid(),
});

const driverLocationSchema = z.object({
  type: z.literal("DRIVER_LOCATION"),
  orderId: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  speed: z.coerce.number().min(0).max(200).optional(),
  heading: z.coerce.number().min(0).max(360).optional(),
});

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(sockets, payload) {
  for (const ws of sockets) {
    safeSend(ws, payload);
  }
}

async function getDriverContext({ db, userId, orderId }) {
  const result = await db.query(
    `
      SELECT
        d.id AS driver_id,
        o.id AS order_id,
        ST_Y(ua.location::geometry) AS delivery_lat,
        ST_X(ua.location::geometry) AS delivery_lng
      FROM drivers d
      JOIN orders o ON o.driver_id = d.id
      LEFT JOIN user_addresses ua ON ua.id = o.delivery_address_id
      WHERE d.user_id = $1
        AND o.id = $2
        AND o.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
      LIMIT 1
    `,
    [userId, orderId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    driverId: row.driver_id,
    orderId: row.order_id,
    deliveryLat: row.delivery_lat !== null ? Number(row.delivery_lat) : null,
    deliveryLng: row.delivery_lng !== null ? Number(row.delivery_lng) : null,
  };
}

async function handleDriverLocation({ ws, payload, db, publisher, store }) {
  if (!ws.auth || ws.auth.role !== "driver") {
    safeSend(ws, { type: "ERROR", message: "Only drivers can publish location" });
    return;
  }

  const ctx = await getDriverContext({ db, userId: ws.auth.userId, orderId: payload.orderId });
  if (!ctx) {
    safeSend(ws, { type: "ERROR", message: "Order is not assigned to this driver" });
    return;
  }

  const updatedAt = new Date().toISOString();
  const locationKey = `driver:location:${ctx.driverId}`;
  const locationPayload = {
    lat: payload.lat,
    lng: payload.lng,
    speed: payload.speed ?? null,
    heading: payload.heading ?? null,
    orderId: payload.orderId,
    updatedAt,
  };

  await publisher.set(locationKey, JSON.stringify(locationPayload), "EX", 30);

  const locationUpdate = {
    type: "DRIVER_LOCATION_UPDATE",
    orderId: payload.orderId,
    lat: payload.lat,
    lng: payload.lng,
    speed: payload.speed ?? null,
    heading: payload.heading ?? null,
    timestamp: updatedAt,
  };
  broadcast(store.subscribersForOrder(payload.orderId), locationUpdate);

  const etaSeconds = calculateEtaSeconds({
    fromLat: payload.lat,
    fromLng: payload.lng,
    toLat: ctx.deliveryLat,
    toLng: ctx.deliveryLng,
    speedKmh: payload.speed || DEFAULT_SPEED_KMH,
  });

  if (etaSeconds !== null) {
    const distanceRemaining = calculateDistanceKm(payload.lat, payload.lng, ctx.deliveryLat, ctx.deliveryLng);
    broadcast(store.subscribersForOrder(payload.orderId), {
      type: "ETA_UPDATE",
      orderId: payload.orderId,
      etaSeconds,
      distanceRemaining: distanceRemaining !== null ? Number(distanceRemaining.toFixed(2)) : null,
      timestamp: updatedAt,
    });
  }
}

function createWsMessageRouter({ db, publisher, store }) {
  return async function route(ws, rawMessage) {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch (_err) {
      safeSend(ws, { type: "ERROR", message: "Invalid JSON payload" });
      return;
    }

    try {
      if (payload.type === "AUTH") {
        const input = authSchema.parse(payload);
        const auth = authenticateToken(input.token);
        if (!auth.ok) {
          safeSend(ws, { type: "AUTH_ERROR", message: auth.error });
          return;
        }

        ws.auth = auth.auth;
        safeSend(ws, {
          type: "AUTH_OK",
          userId: ws.auth.userId,
          role: ws.auth.role,
        });
        return;
      }

      if (!ws.auth) {
        safeSend(ws, { type: "AUTH_REQUIRED", message: "Send AUTH first" });
        return;
      }

      if (payload.type === "SUBSCRIBE_ORDER") {
        const input = subscribeOrderSchema.parse(payload);
        const allowed = await authorizeOrderSubscription({ orderId: input.orderId, auth: ws.auth, db });
        if (!allowed) {
          safeSend(ws, { type: "SUBSCRIBE_DENIED", orderId: input.orderId });
          return;
        }

        store.subscribeOrder(ws, input.orderId);
        safeSend(ws, { type: "SUBSCRIBED_ORDER", orderId: input.orderId });
        return;
      }

      if (payload.type === "DRIVER_LOCATION") {
        const input = driverLocationSchema.parse(payload);
        await handleDriverLocation({ ws, payload: input, db, publisher, store });
        return;
      }

      safeSend(ws, { type: "ERROR", message: "Unsupported message type" });
    } catch (err) {
      safeSend(ws, {
        type: "ERROR",
        message: err.issues?.[0]?.message || err.message || "Request failed",
      });
    }
  };
}

module.exports = { createWsMessageRouter, safeSend, broadcast };
