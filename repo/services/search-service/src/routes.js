const express = require("express");
const { z } = require("zod");
const searchService = require("./search-service");
const authService = require("../../auth-service/src/auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function attachOptionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return next();
  }

  try {
    req.auth = authService.verifyAccessToken(token);
    return next();
  } catch (_err) {
    return next();
  }
}

function createSearchRouter({ db }) {
  const router = express.Router();

  router.get(
    "/products",
    asyncHandler(async (req, res) => {
      try {
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", "Wed, 31 Dec 2026 23:59:59 GMT");
        res.setHeader("Warning", "299 - /search/products is deprecated; use /search/shops");
        const items = await searchService.searchProducts({ query: req.query });
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
    "/shops",
    attachOptionalAuth,
    asyncHandler(async (req, res) => {
      try {
        const items = await searchService.searchShops({
          query: req.query,
          db,
          userId: req.auth?.sub || null,
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

module.exports = { createSearchRouter };