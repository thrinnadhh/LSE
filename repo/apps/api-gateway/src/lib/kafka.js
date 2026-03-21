const { Kafka, logLevel } = require("kafkajs");
const { config } = require("./config");

const kafka = new Kafka({
  clientId: "local-search-engine",
  brokers: config.kafkaBrokers,
  logLevel: logLevel.NOTHING,
});

const producer = kafka.producer();
let producerConnected = false;

async function connectProducer() {
  if (producerConnected) {
    return producer;
  }

  await producer.connect();
  
  // Wrap producer with a publish method to maintain compatibility with service calls
  producer.publish = async (data) => {
    const { topic, event, key } = data;
    return producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(event) }],
    });
  };

  producerConnected = true;
  return producer;
}

function createConsumer({ groupId }) {
  return kafka.consumer({ groupId });
}

module.exports = {
  connectProducer,
  createConsumer,
};