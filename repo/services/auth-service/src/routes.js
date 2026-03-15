const express = require("express");
const { z } = require("zod");
const authService = require("./auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createAuthRouter({ redis, db }) {
  const router = express.Router();

  router.post(
    "/send-otp",
    asyncHandler(async (req, res) => {
      try {
        const payload = await authService.sendOtp({ body: req.body, redis, db });
        res.status(200).json(payload);
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new ApiError(400, err.issues[0].message);
        }
        throw err;
      }
    })
  );

  router.post(
    "/verify-otp",
    asyncHandler(async (req, res) => {
      try {
        const payload = await authService.verifyOtp({
          body: req.body,
          redis,
          db,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
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

  router.post(
    "/refresh-token",
    asyncHandler(async (req, res) => {
      try {
        const payload = await authService.refreshToken({ body: req.body, db });
        res.status(200).json(payload);
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

module.exports = { createAuthRouter };
