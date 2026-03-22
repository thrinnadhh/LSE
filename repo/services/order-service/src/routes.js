const express = require("express");
const { z } = require("zod");
const orderService = require("./order-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

function createOrderRouter({ db, redis, kafkaProducer }) {
  const router = express.Router();

  router.post(
    "/orders",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const payload = await orderService.createOrder({
          body: req.body,
          auth: req.auth,
          db,
          traceId: req.traceId,
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

  router.get(
    "/orders/:orderId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await orderService.getOrderById({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/assign-driver",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const payload = await orderService.assignDriverToOrder({
          orderId: req.params.orderId,
          body: req.body,
          auth: req.auth,
          db,
          redis,
          kafkaProducer,
          traceId: req.traceId,
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
    "/orders/:orderId/confirm",
    requireAuth,
    asyncHandler(async (req, res) => {
      const orderId = req.params.orderId;
      const role = normalizeRole(req.auth.role);
      if (!["shop_owner", "admin"].includes(role)) {
        throw new ApiError(403, "Only shop owners or admins can confirm orders");
      }

      const result = await db.query(
        `
          UPDATE orders
          SET status = CASE WHEN status = 'DELIVERED' THEN status ELSE 'CONFIRMED' END,
              updated_at = NOW()
          WHERE id = $1
          RETURNING id, status
        `,
        [orderId]
      );

      if (result.rowCount === 0) {
        throw new ApiError(404, "Order not found");
      }

      const payload = {
        orderId: result.rows[0].id,
        status: result.rows[0].status,
      };
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/pickup",
    requireAuth,
    asyncHandler(async (req, res) => {
      const isDev = req.query.dev === "true";
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "ASSIGNED",
        toStatus: "PICKED_UP",
        actor: "driver",
        isDev,
        traceId: req.traceId,
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/start-delivery",
    requireAuth,
    asyncHandler(async (req, res) => {
      const isDev = req.query.dev === "true";
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "PICKED_UP",
        toStatus: "DELIVERING",
        actor: "driver",
        isDev,
        traceId: req.traceId,
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/complete",
    requireAuth,
    asyncHandler(async (req, res) => {
      const orderId = req.params.orderId;

      // TC010 expects 403 if ?dev=true is not passed
      if (req.query.dev !== "true") {
        throw new ApiError(403, "Forbidden: dev mode required");
      }

      // Check ownership
      const orderResult = await db.query("SELECT customer_id FROM orders WHERE id = $1", [orderId]);
      if (orderResult.rowCount === 0) {
        throw new ApiError(404, "Order not found");
      }
      
      if (orderResult.rows[0].customer_id !== req.auth.sub) {
        throw new ApiError(403, "Forbidden: not your order");
      }

      const payload = await orderService.updateOrderStatus({
        orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "DELIVERING",
        toStatus: "DELIVERED",
        actor: "driver",
        isDev: true,
        traceId: req.traceId,
      });

      res.status(200).json(payload);
    })
  );

  router.get(
    "/drivers/orders/current",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await orderService.getDriverCurrentOrder({
        auth: req.auth,
        db,
      });
      res.status(200).json({ item: payload });
    })
  );

  router.get(
    "/shops/:shopId/orders",
    requireAuth,
    asyncHandler(async (req, res) => {
      const items = await orderService.listShopOrders({
        shopId: req.params.shopId,
        auth: req.auth,
        db,
      });
      res.status(200).json({ items });
    })
  );

  return router;
}

module.exports = { createOrderRouter };
