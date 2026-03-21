const express = require("express");
const { z } = require("zod");
const userService = require("./user-service");
const authService = require("../../auth-service/src/auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

const shopIdParamsSchema = z.object({
  shopId: z.string().uuid(),
});

const regularShopsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

const preferencesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional(),
});

function requireAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return next(new ApiError(401, "Authorization token is required"));
  }

  try {
    const decoded = authService.verifyAccessToken(token);
    req.auth = decoded;
    return next();
  } catch (err) {
    return next(err);
  }
}

function createUserRouter({ db }) {
  const router = express.Router();

  router.get(
    "/me",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await userService.getMe({ userId: req.auth.sub, db });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/favorites/:shopId",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const params = shopIdParamsSchema.parse(req.params);
        const payload = await userService.addFavoriteShop({
          userId: req.auth.sub,
          shopId: params.shopId,
          db,
        });
        res.status(200).json(payload);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/favorites",
    requireAuth,
    asyncHandler(async (req, res) => {
      console.log("Current user:", req.auth.sub);
      const items = await userService.listFavoriteShops({
        userId: req.auth.sub,
        db,
      });
      res.status(200).json({ items });
    })
  );

  router.delete(
    "/favorites/:shopId",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const params = shopIdParamsSchema.parse(req.params);
        const payload = await userService.removeFavoriteShop({
          userId: req.auth.sub,
          shopId: params.shopId,
          db,
        });
        res.status(200).json(payload);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/regular-shops",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const userId = req.user?.id || req.auth?.sub;
        console.log("Regular shops userId:", userId);
        const query = regularShopsQuerySchema.parse(req.query);
        const items = await userService.listRegularShops({
          userId,
          limit: query.limit,
          db,
        });
        res.status(200).json({ items });
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.get(
    "/preferences",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const query = preferencesQuerySchema.parse(req.query);
        const items = await userService.listUserPreferences({
          userId: req.auth.sub,
          limit: query.limit,
          db,
        });
        res.status(200).json({ items });
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

module.exports = { createUserRouter, requireAuth };
