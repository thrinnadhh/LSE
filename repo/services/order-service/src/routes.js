const express = require("express");
const { z } = require("zod");
const orderService = require("./order-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");

function createOrderRouter({ db, redis, kafkaProducer }) {
  const router = express.Router();

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
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "CREATED",
        toStatus: "CONFIRMED",
        actor: "shop",
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/pickup",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "ASSIGNED",
        toStatus: "PICKED_UP",
        actor: "driver",
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/start-delivery",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "PICKED_UP",
        toStatus: "DELIVERING",
        actor: "driver",
      });
      res.status(200).json(payload);
    })
  );

  router.post(
    "/orders/:orderId/complete",
    requireAuth,
    asyncHandler(async (req, res) => {
      const payload = await orderService.updateOrderStatus({
        orderId: req.params.orderId,
        auth: req.auth,
        db,
        redis,
        kafkaProducer,
        fromStatus: "DELIVERING",
        toStatus: "DELIVERED",
        actor: "driver",
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
