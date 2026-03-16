const express = require("express");
const { pool, ensureAuthTables } = require("./lib/db");
const { redis } = require("./lib/redis");
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

const app = express();

app.use(express.json());

app.use("/auth", createAuthRouter({ redis, db: pool }));
app.use("/users", createUserRouter({ db: pool }));
app.use("/shops", createShopRouter({ db: pool }));
app.use("/shops", createShopProductsRouter({ db: pool }));
app.use("/products", createProductRouter({ db: pool }));
app.use("/inventory", createInventoryRouter({ db: pool }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "api-gateway",
  });
});

app.use(errorHandler);

async function start() {
  await ensureAuthTables();
  await ensureShopTables(pool);
  await ensureProductTables(pool);

  app.listen(config.port, () => {
    console.log(`api-gateway listening on port ${config.port}`);
  });
}

start().catch((err) => {
  console.error("failed to start api-gateway", err);
  process.exit(1);
});
