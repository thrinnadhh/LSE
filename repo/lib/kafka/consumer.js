const { Kafka, logLevel } = require("kafkajs");

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

async function processWithRetries(handler, event, { maxProcessingRetries, retryDelayMs }) {
  let lastError;
  for (let attempt = 0; attempt <= maxProcessingRetries; attempt += 1) {
    try {
      await handler(event);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === maxProcessingRetries) {
        break;
      }

      await sleep(retryDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

function createKafkaConsumer({
  clientId = "hyperlocal-events",
  groupId,
  brokers,
  topics,
  maxProcessingRetries = 3,
  retryDelayMs = 150,
  partitionsConsumedConcurrently = 3,
  eachEvent,
}) {
  if (!groupId) {
    throw new Error("groupId is required");
  }

  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error("topics is required");
  }

  if (typeof eachEvent !== "function") {
    throw new Error("eachEvent handler is required");
  }

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

  const consumer = kafka.consumer({ groupId });
  let running = false;
  let connected = false;

  async function start() {
    if (running) {
      return;
    }

    await consumer.connect();
    connected = true;

    for (const topic of topics) {
      await consumer.subscribe({ topic, fromBeginning: false });
    }

    running = true;

    consumer.run({
      partitionsConsumedConcurrently,
      eachBatchAutoResolve: true,
      eachBatch: async ({ batch, heartbeat }) => {
        for (const message of batch.messages) {
          if (!message.value) {
            continue;
          }

          let event;
          try {
            event = JSON.parse(message.value.toString());
          } catch (err) {
            console.error("kafka consumer parse failed", {
              topic: batch.topic,
              partition: batch.partition,
              offset: message.offset,
              error: err.message,
            });
            continue;
          }

          try {
            await processWithRetries(eachEvent, event, {
              maxProcessingRetries,
              retryDelayMs,
            });
          } catch (err) {
            console.error("kafka consumer processing failed", {
              topic: batch.topic,
              partition: batch.partition,
              offset: message.offset,
              eventType: event.eventType,
              error: err.message,
            });
          }

          await heartbeat();
        }
      },
    }).catch((err) => {
      console.error("kafka consumer run failed", { groupId, error: err.message });
      running = false;
    });
  }

  async function stop() {
    if (!running && !connected) {
      return;
    }

    await consumer.disconnect();
    running = false;
    connected = false;
  }

  return {
    start,
    stop,
  };
}

module.exports = {
  createKafkaConsumer,
};
