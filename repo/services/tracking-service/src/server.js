const http = require("http");
const { WebSocketServer } = require("ws");
const { pool } = require("../../../apps/api-gateway/src/lib/db");
const { config } = require("../../../apps/api-gateway/src/lib/config");
const { createRedisPubSub } = require("./redis-pubsub");
const { createSubscriptionStore } = require("./subscriptions");
const { createWsMessageRouter, broadcast, safeSend } = require("./ws-router");

const ORDER_EVENTS_CHANNEL = "order:events";

function setupTrackingRealtime({ server, db, redisUrl }) {
  const { publisher, subscriber, close } = createRedisPubSub(redisUrl);
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

  subscriber.subscribe(ORDER_EVENTS_CHANNEL).catch((err) => {
    console.error("tracking subscribe failed", err.message);
  });

  subscriber.on("message", (_channel, raw) => {
    try {
      const event = JSON.parse(raw);
      if (!event.orderId || !event.status) {
        return;
      }

      broadcast(store.subscribersForOrder(event.orderId), {
        type: "ORDER_STATUS",
        orderId: event.orderId,
        status: event.status,
        timestamp: event.timestamp || new Date().toISOString(),
      });
    } catch (err) {
      console.error("tracking event parse failed", err.message);
    }
  });

  return {
    close: async () => {
      wss.close();
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
