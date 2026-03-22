require("../../../../src/tracing"); // MUST be first

const express = require("express");
const http = require("http");
const { context, trace } = require("@opentelemetry/api");
const logger = require("../../../../src/logger");
const { pool, ensureAuthTables, ensureTrackingTables, ensureBaseTables } = require("./lib/db");
const { redis } = require("./lib/redis");
const { connectProducer } = require("./lib/kafka");
const { config } = require("./lib/config");
const { errorHandler } = require("./lib/errors");
const authService = require("../../../services/auth-service/src/auth-service");
const { createAuthRouter } = require("../../../services/auth-service/src/routes");
const { createUserRouter } = require("../../../services/user-service/src/routes");
const { createShopRouter } = require("../../../services/shop-service/src/routes");
const { ensureShopTables } = require("../../../services/shop-service/src/shop-service");
const {
  createProductRouter,
  createInventoryRouter,
  createShopProductsRouter,
} = require("../../../services/product-service/src/routes");
const { ensureProductTables } = require("../../../services/product-service/src/product-service");
const { createSearchRouter } = require("../../../services/search-service/src/routes");
const { ensureProductsIndex } = require("../../../services/search-service/src/search-service");
const { startSearchIndexer } = require("../../../services/search-service/src/search-indexer");
const { createHomeRouter } = require("../../../services/home-service/src/routes");
const { ensureChatTables } = require("../../../services/chat-service/src/chat-service");
const { createChatRouter } = require("../../../services/chat-service/src/routes");
const { setupChatRealtime } = require("../../../services/chat-service/src/realtime");
const { createOrderRouter } = require("../../../services/order-service/src/routes");
const { ensureOrderLifecycleTables } = require("../../../services/order-service/src/order-service");
const { ensureUserCommerceTables } = require("../../../services/user-service/src/user-service");
const { createDriverRouter } = require("../../../services/driver-service/src/routes");
const { ensureDriverTables } = require("../../../services/driver-service/src/driver-service");

const app = express();
const server = http.createServer(app);

app.use(express.json());

// Trace ID Middleware
app.use((req, res, next) => {
  const span = trace.getSpan(context.active());
  if (span) {
    req.traceId = span.spanContext().traceId;
  }
  next();
});

app.use((req, res, next) => {
  logger.info({
    traceId: req.traceId,
    method: req.method,
    url: req.url,
    event: "http.request"
  });
  next();
});

let kafkaProducer;
let chatRealtime;

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authorization required" });
  }

  try {
    req.auth = authService.verifyAccessToken(token);
    return next();
  } catch (_err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "api-gateway",
  });
});

async function start() {
  await ensureBaseTables();
  await ensureAuthTables();
  await ensureTrackingTables();
  logger.info({ event: "system.info", message: "User preference engine active" });
  logger.info({ event: "system.info", message: "Behavior tracking enabled" });
  await ensureShopTables(pool);
  await ensureProductTables(pool);
  await ensureUserCommerceTables(pool);
  await ensureOrderLifecycleTables(pool);
  await ensureChatTables(pool);
  await ensureDriverTables(pool);
  await ensureProductsIndex();
  kafkaProducer = await connectProducer();
  await startSearchIndexer({ db: pool });
  chatRealtime = setupChatRealtime({
    server,
    db: pool,
    redisUrl: config.redisUrl,
  });

  app.use("/auth", createAuthRouter({ redis, db: pool }));
  app.use("/users", createUserRouter({ db: pool }));
  app.use("/shops", createShopRouter({ db: pool }));
  app.use("/shops", createShopProductsRouter({ db: pool }));
  app.use("/products", createProductRouter({ db: pool, producer: kafkaProducer }));
  app.use("/inventory", createInventoryRouter({ db: pool }));
  app.use("/search", createSearchRouter({ db: pool }));
  app.use("/drivers", authMiddleware, createDriverRouter({ db: pool, redis, kafkaProducer }));
  app.use("/home", authMiddleware, createHomeRouter({ db: pool }));
  app.use("/", createOrderRouter({ db: pool, redis, kafkaProducer }));
  logger.info({ event: "system.info", message: "Home route mounted" });
  const chatRouter = createChatRouter({
    db: pool,
    onMessagePersisted: chatRealtime.publishChatMessage,
  });
  app.use("/chat", chatRouter);
  app.use("/", chatRouter);
  app.use(errorHandler);

  server.listen(config.port, () => {
    logger.info({ event: "server.started", port: config.port, message: `api-gateway listening on port ${config.port}` });
  });
}

start().catch((err) => {
  logger.error({ event: "server.startup_failed", error: err.message, stack: err.stack });
  process.exit(1);
});
