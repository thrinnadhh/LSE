const express = require("express");
const trackingService = require("./tracking-service");
const { asyncHandler, ApiError } = require("../../../apps/api-gateway/src/lib/errors");

function attachAuth(req, _res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    throw new ApiError(401, "Authorization required");
  }

  try {
    const authService = require("../../auth-service/src/auth-service");
    req.auth = authService.verifyAccessToken(token);
    return next();
  } catch (err) {
    throw new ApiError(401, "Invalid token");
  }
}

function createTrackingRouter({ db }) {
  const router = express.Router();

  // GET /orders/recent — Reorder system
  router.get(
    "/orders/recent",
    attachAuth,
    asyncHandler(async (req, res) => {
      const recentOrders = await trackingService.getRecentOrders(db, req.auth.sub, 10);
      res.status(200).json({ recentOrders });
    })
  );

  // GET /notifications — Get user notifications
  router.get(
    "/notifications",
    attachAuth,
    asyncHandler(async (req, res) => {
      const unreadOnly = req.query.unread === "true";
      const notifications = await trackingService.getNotifications(db, req.auth.sub, 20, unreadOnly);
      res.status(200).json({
        notifications,
        unreadCount: notifications.filter(n => !n.is_read).length,
      });
    })
  );

  // POST /notifications/:id/read — Mark notification as read
  router.post(
    "/notifications/:id/read",
    attachAuth,
    asyncHandler(async (req, res) => {
      await trackingService.markNotificationAsRead(db, req.params.id, req.auth.sub);
      res.status(200).json({ message: "Notification marked as read" });
    })
  );

  return router;
}

module.exports = { createTrackingRouter };
