const http = require("http");

const BASE_URL = "http://localhost:3000";

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const { body, ...rest } = options;
  const start = Date.now();
  
  const bodyData = body ? JSON.stringify(body) : null;
  const headers = {
    "Content-Type": "application/json",
    ...rest.headers,
  };
  if (bodyData) {
    headers["Content-Length"] = Buffer.byteLength(bodyData);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      ...rest,
      headers,
      timeout: 10000,
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        const result = {
          status: res.statusCode,
          body: json || data,
          duration: Date.now() - start,
        };
        if (res.statusCode >= 400) {
          console.error(`❌ [${res.statusCode}] ${path}:`, result.body);
        }
        resolve(result);
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

async function runLifecycle() {
  try {
    console.log("🚀 Starting Order Lifecycle Flow Demonstration...");

    // 1. Shop Owner Setup
    const soPhone = `999${Math.floor(Math.random() * 8999999 + 1000000)}`;
    const soSend = await request("/auth/send-otp", { method: "POST", body: { phone: soPhone } });
    const soOtp = soSend.body.otp || "123456";
    const soVerify = await request("/auth/verify-otp", { method: "POST", body: { phone: soPhone, otp: soOtp, role: "shop_owner" } });
    const soToken = soVerify.body.accessToken;
    console.log("✅ Shop Owner Logged In");

    const shopRes = await request("/shops", {
      method: "POST",
      headers: { Authorization: `Bearer ${soToken}` },
      body: { 
        name: "Lifecycle Shop", 
        description: "Testing Flow", 
        lat: 17.3850, 
        lng: 78.4867, 
        address: "Hyderabad",
        category: "pet_store",
        phone: soPhone
      }
    });
    const shopId = shopRes.body.id;
    console.log(`✅ Shop Created: ${shopId}`);

    const prodRes = await request("/products", {
      method: "POST",
      headers: { Authorization: `Bearer ${soToken}` },
      body: { shopId, name: "Test Item", description: "Test", price: 100, category: "Food" }
    });
    const productId = prodRes.body.id;
    console.log(`✅ Product Added: ${productId}`);

    // 2. Customer Order
    const cPhone = `910${Math.floor(Math.random() * 8999999 + 1000000)}`;
    const cSend = await request("/auth/send-otp", { method: "POST", body: { phone: cPhone } });
    const cOtp = cSend.body.otp || "123456";
    const cVerify = await request("/auth/verify-otp", { method: "POST", body: { phone: cPhone, otp: cOtp, role: "customer" } });
    const cToken = cVerify.body.accessToken;
    console.log("✅ Customer Logged In");

    const orderRes = await request("/orders", {
      method: "POST",
      headers: { Authorization: `Bearer ${cToken}` },
      body: { 
        shopId, 
        items: [{ productId, quantity: 1 }], 
        address: { name: "Home", city: "Hyderabad", addressLine1: "123 St", lat: 17.3850, lng: 78.4867 }, 
        paymentMethod: "CASH" 
      }
    });
    const orderId = orderRes.body.orderId;
    console.log(`✅ Order Placed: ${orderId} (Status: ${orderRes.body.status})`);

    // 3. Confirm
    const confirmRes = await request(`/orders/${orderId}/confirm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${soToken}` }
    });
    console.log(`✅ Order Confirmed (Status: ${confirmRes.body.status})`);

    // 4. Driver Flow
    const dPhone = `920${Math.floor(Math.random() * 8999999 + 1000000)}`;
    const dSend = await request("/auth/send-otp", { method: "POST", body: { phone: dPhone } });
    const dOtp = dSend.body.otp || "123456";
    const dVerify = await request("/auth/verify-otp", { method: "POST", body: { phone: dPhone, otp: dOtp, role: "driver" } });
    const dToken = dVerify.body.accessToken;
    console.log("✅ Driver Logged In");

    const locRes = await request("/drivers/location", {
      method: "POST",
      headers: { Authorization: `Bearer ${dToken}` },
      body: { lat: 17.3850, lng: 78.4867 }
    });
    const driverId = locRes.body.driverId || locRes.body.id;
    console.log(`✅ Driver Online (ID: ${driverId})`);

    // 5. Admin Assignment
    const aSend = await request("/auth/send-otp", { method: "POST", body: { phone: "1110002222" } });
    const aOtp = aSend.body.otp || "123456";
    const aVerify = await request("/auth/verify-otp", { method: "POST", body: { phone: "1110002222", otp: aOtp, role: "admin" } });
    const aToken = aVerify.body.accessToken;
    
    const assignRes = await request(`/orders/${orderId}/assign-driver`, {
      method: "POST",
      headers: { Authorization: `Bearer ${aToken}` },
      body: { driverId }
    });
    console.log(`✅ Driver Assigned (Status: ${assignRes.body.status})`);

    // 6. Pickup & Complete
    const pickupRes = await request(`/orders/${orderId}/pickup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dToken}` }
    });
    console.log(`✅ Order Picked Up (Status: ${pickupRes.body.status})`);

    const completeRes = await request(`/orders/${orderId}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dToken}` }
    });
    console.log(`✅ Order Completed (Status: ${completeRes.body.status})`);

    console.log("\n🎊 LIFECYCLE DEMONSTRATION COMPLETE!");

  } catch (err) {
    console.error("❌ Fatal Error:", err);
  }
}

runLifecycle();
