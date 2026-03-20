const express = require("express");
const { z } = require("zod");
const homeService = require("./home-service");
const authService = require("../../auth-service/src/auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function attachAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    throw new ApiError(401, "Authorization required");
  }

  try {
    req.auth = authService.verifyAccessToken(token);
    return next();
  } catch (err) {
    throw new ApiError(401, "Invalid token");
  }
}

const homepageQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

const categoryShopsSchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

function createHomeRouter({ db }) {
  const router = express.Router();

  // GET /home — Homepage with all discovery sections
  router.get(
    "/",
    attachAuth,
    asyncHandler(async (req, res) => {
      try {
        const input = homepageQuerySchema.parse(req.query);
        
        // Default to Hyderabad if lat/lng not provided
        const lat = input.lat || 17.385;
        const lng = input.lng || 78.4867;
        
        const userId = req.auth.sub;
        const homepage = await homeService.getHomepage({
          userId,
          userLat: lat,
          userLng: lng,
          db,
        });

        res.status(200).json(homepage);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  // GET /categories — List all categories
  router.get(
    "/categories",
    asyncHandler(async (_req, res) => {
      res.status(200).json({
        categories: homeService.STATIC_CATEGORIES.map(c => ({
          id: c.id,
          name: c.name,
        })),
      });
    })
  );

  // GET /categories/:category/shops — Shops by category
  router.get(
    "/categories/:category/shops",
    asyncHandler(async (req, res) => {
      try {
        const input = categoryShopsSchema.parse(req.query);
        const category = req.params.category;

        const lat = input.lat || 17.385;
        const lng = input.lng || 78.4867;

        const shops = await homeService.getShopsByCategory({
          category,
          userLat: lat,
          userLng: lng,
          db,
          limit: 20,
        });

        res.status(200).json({
          category,
          shops,
        });
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

module.exports = { createHomeRouter };
