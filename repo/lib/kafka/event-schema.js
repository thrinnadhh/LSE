const { randomUUID } = require("crypto");

const KAFKA_TOPICS = {
  orderEvents: "order-events",
  driverEvents: "driver-events",
};

const EVENT_TYPES = {
  ORDER_STATUS_CHANGED: "ORDER_STATUS_CHANGED",
  DRIVER_ONLINE: "DRIVER_ONLINE",
  DRIVER_OFFLINE: "DRIVER_OFFLINE",
  DRIVER_LOCATION_UPDATE: "DRIVER_LOCATION_UPDATE",
};

function createEventEnvelope({ eventType, source, payload, eventId, timestamp }) {
  if (!eventType) {
    throw new Error("eventType is required");
  }

  if (!source) {
    throw new Error("source is required");
  }

  return {
    eventType,
    eventId: eventId || randomUUID(),
    source,
    timestamp: timestamp || new Date().toISOString(),
    payload: payload || {},
  };
}

module.exports = {
  KAFKA_TOPICS,
  EVENT_TYPES,
  createEventEnvelope,
};
