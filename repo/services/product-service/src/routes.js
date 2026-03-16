const express = require("express");
const { z } = require("zod");
const productService = require("./product-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function validationMessage(err) {
  return err.issues?.[0]?.message || "Invalid request";
}

function createProductRouter({ db, producer }) {
  const router = express.Router();

  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const product = await productService.createProduct({ body: req.body, auth: req.auth, db, producer });
        res.status(201).json(product);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, validationMessage(err));
        }
        throw err;
      }
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const product = await productService.getProductById({ id: req.params.id, db });
      res.status(200).json(product);
    })
  );

  return router;
}

function createInventoryRouter({ db }) {
  const router = express.Router();

  router.patch(
    "/:productId",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const product = await productService.updateInventory({
          productId: req.params.productId,
          body: req.body,
          auth: req.auth,
          db,
        });
        res.status(200).json(product);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, validationMessage(err));
        }
        throw err;
      }
    })
  );

  return router;
}

function createShopProductsRouter({ db }) {
  const router = express.Router();

  router.get(
    "/:shopId/products",
    asyncHandler(async (req, res) => {
      const items = await productService.listProductsByShop({ shopId: req.params.shopId, db });
      res.status(200).json({ items });
    })
  );

  return router;
}

module.exports = {
  createProductRouter,
  createInventoryRouter,
  createShopProductsRouter,
};
