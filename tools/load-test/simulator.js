const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const CONFIG = {
  SEARCH_CONCURRENCY: 1000,
  ORDERS_PER_MINUTE: 500,
  DRIVERS: 200,
  DRIVER_PING_MS: 2000,
  TIMEOUT_MS: 5000,
  CITY_CENTER: { lat: 40.7128, lng: -74.0060 } // NYC
};

const QUERIES = ['milk', 'bread', 'pizza', 'shoes', 'iphone', 'laptop', 'coffee', 'water'];
const SHOP_IDS = [
  '11111111-1111-1111-1111-111111111111', 
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333'
];
const PRODUCT_IDS = [
  'aaaaiaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
];

let metrics = {
  requests: 0,
  success: 0,
  failures: 0,
  timeouts: 0,
  responseTimes: []
};

// Utils
const randomCoord = (base) => base + (Math.random() - 0.5) * 0.05; // approx 5km radius
const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randomUUID = () => crypto.randomUUID ? crypto.randomUUID() : 'dddddddd-dddd-dddd-dddd-dddddddddddd';

async function sendRequest(name, method, endpoint, body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT_MS);
  
  const start = Date.now();
  try {
    metrics.requests++;
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    
    const duration = Date.now() - start;
    metrics.responseTimes.push(duration);
    if (metrics.responseTimes.length > 5000) metrics.responseTimes.shift();

    if (res.ok) {
      metrics.success++;
    } else {
      metrics.failures++;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      metrics.timeouts++;
    } else {
      metrics.failures++;
    }
  } finally {
    clearTimeout(timeout);
  }
}

// 1. Simulate Searches
async function searchLoop() {
  while (true) {
    const q = randomItem(QUERIES);
    const lat = randomCoord(CONFIG.CITY_CENTER.lat);
    const lng = randomCoord(CONFIG.CITY_CENTER.lng);
    // Note: Assuming /search/products based on existing gateway routes in repo
    await sendRequest('Search', 'GET', `/search/products?q=${q}&lat=${lat}&lng=${lng}`);
    await new Promise(r => setTimeout(r, Math.random() * 2000 + 500)); // Sleep between 0.5-2.5s per virtual user
  }
}

// 2. Simulate Orders
function startOrderSimulation() {
  const msPerOrder = 60000 / CONFIG.ORDERS_PER_MINUTE; // 120ms
  setInterval(() => {
    const payload = {
      shopId: randomItem(SHOP_IDS),
      items: [
        {
          productId: randomItem(PRODUCT_IDS),
          quantity: Math.floor(Math.random() * 3) + 1
        }
      ]
    };
    sendRequest('Order', 'POST', `/orders`, payload);
  }, msPerOrder);
}

// 3. Simulate Drivers
function startDriverSimulation() {
  for (let i = 0; i < CONFIG.DRIVERS; i++) {
    // stagger start times
    setTimeout(() => {
      setInterval(() => {
        const payload = {
          lat: randomCoord(CONFIG.CITY_CENTER.lat),
          lng: randomCoord(CONFIG.CITY_CENTER.lng)
        };
        sendRequest('Driver', 'POST', `/drivers/location`, payload);
      }, CONFIG.DRIVER_PING_MS);
    }, Math.random() * CONFIG.DRIVER_PING_MS);
  }
}

// Reporter
setInterval(() => {
  const avgRt = metrics.responseTimes.length 
    ? (metrics.responseTimes.reduce((a,b) => a+b, 0) / metrics.responseTimes.length).toFixed(2)
    : 0;
    
  console.log(`[Metrics] ${new Date().toISOString()}`);
  console.log(`  Requests: ${metrics.requests} | Success: ${metrics.success} | Failures: ${metrics.failures} | Timeouts: ${metrics.timeouts}`);
  console.log(`  Avg Response Time: ${avgRt}ms`);
  console.log(`---------------------------------------------------`);
}, 5000);

console.log(`🚀 Starting LSE Load Simulator`);
console.log(`- ${CONFIG.SEARCH_CONCURRENCY} Concurrent Search Users`);
console.log(`- ${CONFIG.ORDERS_PER_MINUTE} Orders per minute`);
console.log(`- ${CONFIG.DRIVERS} Active Drivers updating location every 2s`);

// Boot
for (let i = 0; i < CONFIG.SEARCH_CONCURRENCY; i++) {
  searchLoop(); // Do not await
}
startOrderSimulation();
startDriverSimulation();
