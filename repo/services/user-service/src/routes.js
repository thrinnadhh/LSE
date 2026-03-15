const express = require("express");
const userService = require("./user-service");
const authService = require("../../auth-service/src/auth-service");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

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

  return router;
}

module.exports = { createUserRouter, requireAuth };
