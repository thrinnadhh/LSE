const express = require("express");
const { z } = require("zod");
const shopService = require("./shop-service");
const authService = require("../../auth-service/src/auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return next(new ApiError(401, "Authorization token is required"));
  }

  try {
    req.auth = authService.verifyAccessToken(token);
    return next();
  } catch (err) {
    return next(err);
  }
}

function createShopRouter({ db }) {
  const router = express.Router();

  router.get(
    "/nearby",
    asyncHandler(async (req, res) => {
      try {
        const shops = await shopService.findNearbyShops({ query: req.query, db });
        res.status(200).json({ items: shops });
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const created = await shopService.createShop({ body: req.body, auth: req.auth, db });
        res.status(201).json(created);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/dashboard",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await shopService.getShopDashboard({
        auth: req.auth,
        db,
      });
      res.status(200).json(payload);
    })
  );

  router.get(
    "/:id",
    asyncHandler(async (req, res) => {
      const shop = await shopService.getShopById({ id: req.params.id, query: req.query, db });
      res.status(200).json(shop);
    })
  );

  router.put(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const updated = await shopService.updateShop({
          id: req.params.id,
          body: req.body,
          auth: req.auth,
          db,
        });
        res.status(200).json(updated);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.patch(
    "/:id/availability",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const updated = await shopService.patchAvailability({
          id: req.params.id,
          body: req.body,
          auth: req.auth,
          db,
        });
        res.status(200).json(updated);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  return router;
}

module.exports = { createShopRouter };
