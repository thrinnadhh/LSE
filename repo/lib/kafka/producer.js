const { Kafka, logLevel, CompressionTypes } = require("kafkajs");

function parseBrokers(brokers) {
  const source =
    brokers ||
    process.env.KAFKA_BROKERS ||
    process.env.KAFKA_BOOTSTRAP_SERVERS ||
    "localhost:9092";

  return String(source)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(task, { retries, baseDelayMs }) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      if (attempt === retries) {
        break;
      }
      const backoffMs = baseDelayMs * (attempt + 1);
      await sleep(backoffMs);
    }
  }

  throw lastError;
}

function createKafkaProducer({
  clientId = "hyperlocal-events",
  brokers,
  retries = 3,
  retryDelayMs = 120,
  maxBatchSize = 200,
} = {}) {
  const kafka = new Kafka({
    clientId,
    brokers: parseBrokers(brokers),
    logLevel: logLevel.NOTHING,
    retry: {
      retries: 8,
      initialRetryTime: 120,
      factor: 0.2,
    },
  });

  const producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: false,
  });

  let connected = false;

  async function connect() {
    if (connected) {
      return;
    }

    await producer.connect();
    connected = true;
  }

  async function disconnect() {
    if (!connected) {
      return;
    }

    await producer.disconnect();
    connected = false;
  }

  async function publish({ topic, event, key, traceId, version = "1.0" }) {
    if (!topic || !event) {
      return;
    }

    await connect();

    const headers = { version };
    if (traceId) {
      headers.traceId = traceId;
    }

    await withRetries(
      () =>
        producer.send({
          topic,
          compression: CompressionTypes.GZIP,
          acks: -1,
          messages: [
            {
              key: key || event?.payload?.orderId || event?.payload?.driverId || event.eventId,
              value: JSON.stringify(event),
              headers,
            },
          ],
        }),
      {
        retries,
        baseDelayMs: retryDelayMs,
      }
    );
  }

  async function publishBatch({ topic, events, keySelector, traceId, version = "1.0" }) {
    if (!topic || !Array.isArray(events) || events.length === 0) {
      return;
    }

    await connect();

    const headers = { version };
    if (traceId) {
      headers.traceId = traceId;
    }

    for (let index = 0; index < events.length; index += maxBatchSize) {
      const chunk = events.slice(index, index + maxBatchSize);

      await withRetries(
        () =>
          producer.send({
            topic,
            compression: CompressionTypes.GZIP,
            acks: -1,
            messages: chunk.map((event) => ({
              key:
                (typeof keySelector === "function" && keySelector(event)) ||
                event?.payload?.orderId ||
                event?.payload?.driverId ||
                event.eventId,
              value: JSON.stringify(event),
              headers,
            })),
          }),
        {
          retries,
          baseDelayMs: retryDelayMs,
        }
      );
    }
  }

  return {
    connect,
    disconnect,
    publish,
    publishBatch,
  };
}

module.exports = {
  createKafkaProducer,
};
