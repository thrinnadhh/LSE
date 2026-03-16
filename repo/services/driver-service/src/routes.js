const express = require("express");
const { z } = require("zod");
const driverService = require("./driver-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createDriverRouter({ db, redis }) {
  const router = express.Router();

  router.get(
    "/drivers",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = await driverService.listDrivers({
        auth: req.auth,
        db,
      });

      res.status(200).json({ items });
    })
  );

  router.post(
    "/drivers",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const payload = await driverService.createDriver({
          body: req.body,
          auth: req.auth,
          db,
          redis,
        });

        res.status(201).json(payload);
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

module.exports = { createDriverRouter };