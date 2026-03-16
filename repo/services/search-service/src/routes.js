const express = require("express");
const { z } = require("zod");
const searchService = require("./search-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createSearchRouter() {
  const router = express.Router();

  router.get(
    "/products",
    asyncHandler(async (req, res) => {
      try {
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

  return router;
}

module.exports = { createSearchRouter };