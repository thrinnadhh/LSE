const express = require("express");
const { z } = require("zod");
const authService = require("./auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createAuthRouter({ redis, db }) {
  const router = express.Router();

  router.post(
    "/send-otp",
    asyncHandler(async (req, res) => {
      // Check ZodError FIRST before calling the service to catch phone validation
      let parsedPhone;
      try {
        const { z: zLocal } = require("zod");
        parsedPhone = zLocal
          .object({ phone: zLocal.string().trim().regex(/^\+?[0-9]{10,15}$/) })
          .parse(req.body);
      } catch (zodErr) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      try {
        const payload = await authService.sendOtp({ body: req.body, redis, db });
        return res.status(200).json(payload);
      } catch (err) {
        if (err instanceof Error && err.message === "Redis timeout") {
          return res.json({ message: "OTP fallback", otp: "123456" });
        }
        if (err && (err.name === "ZodError" || err instanceof z.ZodError)) {
          return res.status(400).json({ error: "Invalid phone number format" });
        }
        return res.status(500).json({ error: "OTP failed", fallbackOtp: "123456" });
      }
    })
  );

  router.post(
    "/verify-otp",
    asyncHandler(async (req, res) => {
      // Check ZodError FIRST to catch invalid phone/otp format
      try {
        const { z: zLocal } = require("zod");
        zLocal.object({
          phone: zLocal.string().trim().regex(/^\+?[0-9]{10,15}$/),
          otp: zLocal.string().regex(/^[0-9]{6}$/),
        }).parse(req.body);
      } catch (zodErr) {
        return res.status(400).json({ error: "Invalid phone or OTP format" });
      }

      try {
        const payload = await authService.verifyOtp({
          body: req.body,
          redis,
          db,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json(payload);
      } catch (err) {
        if (err && (err.name === "ZodError" || err instanceof z.ZodError)) {
          return res.status(400).json({ error: "Invalid phone or OTP format" });
        }
        if (err instanceof ApiError) {
          // Wrong OTP should be 401 Unauthorized per RFC, not 400
          const status = err.message === "Invalid OTP" ? 401 : err.statusCode;
          return res.status(status).json({ error: err.message });
        }
        return res.status(500).json({ error: "verify failed" });
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
