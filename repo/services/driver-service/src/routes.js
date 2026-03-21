const express = require("express");
const { z } = require("zod");
const driverService = require("./driver-service");
const orderService = require("../../order-service/src/order-service");
const { requireAuth } = require("../../user-service/src/routes");
const { ApiError, asyncHandler } = require("../../../apps/api-gateway/src/lib/errors");
const { setDriverBusy, setDriverOnline } = require("../../dispatch-service/src/availability-store");
const { KAFKA_TOPICS, EVENT_TYPES, createEventEnvelope } = require("../../../lib/kafka/event-schema");

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

async function publishDriverEvent({ kafkaProducer, eventType, payload }) {
  if (!kafkaProducer) {
    return;
  }

  const event = createEventEnvelope({
    eventType,
    source: "driver-service",
    payload,
  });

  await kafkaProducer.publish({
    topic: KAFKA_TOPICS.driverEvents,
    event,
    key: payload.driverId,
  });
}

function createDriverRouter({ db, redis, kafkaProducer }) {
  const router = express.Router();

  router.get(
    "/",
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
    "/",
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

  router.post(
    "/location",
    requireAuth,
    asyncHandler(async (req, res) => {
      try {
        const before = await db.query(
          `
            SELECT id, is_online
            FROM drivers
            WHERE user_id = $1
            LIMIT 1
          `,
          [req.auth.sub]
        );

        const wasOnline = before.rowCount > 0 ? Boolean(before.rows[0].is_online) : false;

        const payload = await orderService.upsertDriverLocation({
          body: req.body,
          auth: req.auth,
          db,
          redis,
        });

        if (!wasOnline) {
          await publishDriverEvent({
            kafkaProducer,
            eventType: EVENT_TYPES.DRIVER_ONLINE,
            payload: {
              driverId: payload.driverId,
              lat: payload.lat,
              lng: payload.lng,
              orderId: payload.currentOrderId || null,
            },
          });
        }

        await publishDriverEvent({
          kafkaProducer,
          eventType: EVENT_TYPES.DRIVER_LOCATION_UPDATE,
          payload: {
            driverId: payload.driverId,
            lat: payload.lat,
            lng: payload.lng,
            orderId: payload.currentOrderId || null,
          },
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
    "/offline",
    requireAuth,
    asyncHandler(async (req, res) => {
      const role = normalizeRole(req.auth.role);
      if (role !== "driver") {
        throw new ApiError(403, "Only drivers can go offline");
      }

      const result = await db.query(
        `
          UPDATE drivers
          SET is_online = FALSE, is_busy = FALSE, updated_at = NOW()
          WHERE user_id = $1
          RETURNING id, lat, lng, updated_at
        `,
        [req.auth.sub]
      );

      if (result.rowCount === 0) {
        throw new ApiError(404, "Driver profile not found");
      }

      const row = result.rows[0];
      await setDriverOnline({ redis, driverId: row.id, isOnline: false });
      await setDriverBusy({ redis, driverId: row.id, isBusy: false });

      await publishDriverEvent({
        kafkaProducer,
        eventType: EVENT_TYPES.DRIVER_OFFLINE,
        payload: {
          driverId: row.id,
          lat: row.lat !== null ? Number(row.lat) : null,
          lng: row.lng !== null ? Number(row.lng) : null,
        },
      });

      res.status(200).json({
        driverId: row.id,
        isOnline: false,
        updatedAt: row.updated_at,
      });
    })
  );

  return router;
}

module.exports = { createDriverRouter };