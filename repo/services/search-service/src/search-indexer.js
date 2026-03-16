const { createConsumer } = require("../../../apps/api-gateway/src/lib/kafka");
const { ensureProductsIndex, indexProductDocument } = require("./search-service");

const PRODUCT_CREATED_TOPIC = "product_created";

async function startSearchIndexer({ db }) {
  await ensureProductsIndex();

  const consumer = createConsumer({ groupId: "search-indexer" });
  await consumer.connect();
  await consumer.subscribe({ topic: PRODUCT_CREATED_TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        return;
      }

      const payload = JSON.parse(message.value.toString());
      await indexProductDocument({ productId: payload.productId, db });
    },
  });

  return consumer;
}

module.exports = {
  PRODUCT_CREATED_TOPIC,
  startSearchIndexer,
};