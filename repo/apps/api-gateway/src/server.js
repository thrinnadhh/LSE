const express = require("express");
const { pool, ensureAuthTables } = require("./lib/db");
const { redis } = require("./lib/redis");
const { connectProducer } = require("./lib/kafka");
const { config } = require("./lib/config");
const { errorHandler } = require("./lib/errors");
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

const app = express();

app.use(express.json());

let kafkaProducer;

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "api-gateway",
  });
});

async function start() {
  await ensureAuthTables();
  await ensureShopTables(pool);
  await ensureProductTables(pool);
  await ensureProductsIndex();
  kafkaProducer = await connectProducer();
  await startSearchIndexer({ db: pool });

  app.use("/auth", createAuthRouter({ redis, db: pool }));
  app.use("/users", createUserRouter({ db: pool }));
  app.use("/shops", createShopRouter({ db: pool }));
  app.use("/shops", createShopProductsRouter({ db: pool }));
  app.use("/products", createProductRouter({ db: pool, producer: kafkaProducer }));
  app.use("/inventory", createInventoryRouter({ db: pool }));
  app.use("/search", createSearchRouter());
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`api-gateway listening on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error("failed to start api-gateway", err);
  process.exit(1);
});
