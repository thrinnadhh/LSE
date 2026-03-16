const { WebSocketServer, WebSocket } = require("ws");
const Redis = require("ioredis");
const authService = require("../../auth-service/src/auth-service");
const chatService = require("./chat-service");

function parseBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice(7);
}

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function setupChatRealtime({ server, db, redisUrl }) {
  const publisher = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  const subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  const wss = new WebSocketServer({ noServer: true });
  const socketsByUser = new Map();

  function addSocket(userId, ws) {
    const sockets = socketsByUser.get(userId) || new Set();
    sockets.add(ws);
    socketsByUser.set(userId, sockets);
  }

  function removeSocket(userId, ws) {
    const sockets = socketsByUser.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(ws);
    if (sockets.size === 0) {
      socketsByUser.delete(userId);
    }
  }

  async function publishChatMessage(payload) {
    const channel = `chat:${payload.conversationId}`;
    await publisher.publish(channel, JSON.stringify(payload));
  }

  function fanOut(payload) {
    const recipients = [payload.customerId, payload.shopOwnerId].filter(Boolean);

    recipients.forEach((userId) => {
      const sockets = socketsByUser.get(userId);
      if (!sockets) {
        return;
      }

      sockets.forEach((ws) => {
        safeSend(ws, {
          conversationId: payload.conversationId,
          senderId: payload.senderId,
          message: payload.message,
          createdAt: payload.createdAt,
        });
      });
    });
  }

  subscriber.psubscribe("chat:*").catch((err) => {
    console.error("chat redis psubscribe error", err);
  });

  subscriber.on("pmessage", (_pattern, _channel, message) => {
    try {
      const payload = JSON.parse(message);
      fanOut(payload);
    } catch (err) {
      console.error("chat redis message parse error", err.message);
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !request.url.startsWith("/ws/chat")) {
      socket.destroy();
      return;
    }

    const token = parseBearerToken(request);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    try {
      const auth = authService.verifyAccessToken(token);
      request.auth = auth;
    } catch (_err) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws, request) => {
    const userId = request.auth.sub;
    addSocket(userId, ws);

    safeSend(ws, { type: "connected", userId });

    ws.on("message", async (raw) => {
      let payload;
      try {
        payload = JSON.parse(raw.toString());
      } catch (_err) {
        safeSend(ws, { error: "Invalid JSON payload" });
        return;
      }

      if (payload.type !== "message") {
        safeSend(ws, { error: "Unsupported message type" });
        return;
      }

      try {
        const { message, participants } = await chatService.sendMessage({
          body: {
            conversationId: payload.conversationId,
            message: payload.message,
          },
          auth: { sub: userId },
          db,
        });

        await publishChatMessage({
          conversationId: message.conversationId,
          senderId: message.senderId,
          message: message.message,
          createdAt: message.createdAt,
          customerId: participants.customerId,
          shopOwnerId: participants.shopOwnerId,
        });
      } catch (err) {
        safeSend(ws, { error: err.message || "Failed to send message" });
      }
    });

    ws.on("close", () => {
      removeSocket(userId, ws);
    });
  });

  return {
    publishChatMessage,
    close: async () => {
      await subscriber.quit();
      await publisher.quit();
      wss.close();
    },
  };
}

module.exports = { setupChatRealtime };
