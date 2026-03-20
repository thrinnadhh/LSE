const http = require("http");
const { WebSocketServer } = require("ws");
const { pool } = require("../../../apps/api-gateway/src/lib/db");
const { config } = require("../../../apps/api-gateway/src/lib/config");
const { createRedisPubSub } = require("./redis-pubsub");
const { createSubscriptionStore } = require("./subscriptions");
const { createWsMessageRouter, broadcast, safeSend } = require("./ws-router");
const { createKafkaConsumer } = require("../../../lib/kafka/consumer");
const { KAFKA_TOPICS, EVENT_TYPES } = require("../../../lib/kafka/event-schema");

function setupTrackingRealtime({ server, db, redisUrl }) {
  const { publisher, close } = createRedisPubSub(redisUrl);
  const store = createSubscriptionStore();
  const wss = new WebSocketServer({ noServer: true });
  const routeMessage = createWsMessageRouter({ db, publisher, store });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !request.url.startsWith("/ws")) {
      return;
    }

    if (request.url !== "/ws" && !request.url.startsWith("/ws?")) {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    safeSend(ws, { type: "CONNECTED", message: "Send AUTH to start" });

    ws.on("message", (message) => {
      routeMessage(ws, message).catch((err) => {
        safeSend(ws, { type: "ERROR", message: err.message || "Message failed" });
      });
    });

    ws.on("close", () => {
      store.unsubscribeSocket(ws);
    });
  });

  const kafkaConsumer = createKafkaConsumer({
    clientId: "tracking-service",
    groupId: "tracking-service-group",
    brokers: config.kafkaBrokers,
    topics: [KAFKA_TOPICS.orderEvents, KAFKA_TOPICS.driverEvents],
    eachEvent: async (event) => {
      const payload = event.payload || {};

      if (event.eventType === EVENT_TYPES.ORDER_STATUS_CHANGED) {
        if (!payload.orderId || !payload.status) {
          return;
        }

        broadcast(store.subscribersForOrder(payload.orderId), {
          type: "ORDER_STATUS",
          orderId: payload.orderId,
          status: payload.status,
          timestamp: event.timestamp || new Date().toISOString(),
        });
        return;
      }

      if (event.eventType === EVENT_TYPES.DRIVER_LOCATION_UPDATE) {
        if (!payload.driverId || payload.lat === undefined || payload.lng === undefined) {
          return;
        }

        const updatedAt = event.timestamp || new Date().toISOString();
        await publisher.set(
          `driver:location:${payload.driverId}`,
          JSON.stringify({
            lat: payload.lat,
            lng: payload.lng,
            orderId: payload.orderId || null,
            updatedAt,
          }),
          "EX",
          30
        );

        if (payload.orderId) {
          broadcast(store.subscribersForOrder(payload.orderId), {
            type: "DRIVER_LOCATION_UPDATE",
            orderId: payload.orderId,
            driverId: payload.driverId,
            lat: payload.lat,
            lng: payload.lng,
            timestamp: updatedAt,
          });
        }
      }
    },
  });

  kafkaConsumer.start().catch((err) => {
    console.error("tracking kafka consumer failed", err.message);
  });

  return {
    close: async () => {
      wss.close();
      await kafkaConsumer.stop();
      await close();
    },
  };
}

function startTrackingServerStandalone() {
  const appServer = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "ok", service: "tracking-service" }));
  });

  setupTrackingRealtime({
    server: appServer,
    db: pool,
    redisUrl: config.redisUrl,
  });

  const port = Number(process.env.TRACKING_PORT || 8090);
  appServer.listen(port, () => {
    console.log(`tracking-service listening on port ${port}`);
  });
}

module.exports = {
  setupTrackingRealtime,
  startTrackingServerStandalone,
};

if (require.main === module) {
  startTrackingServerStandalone();
}
