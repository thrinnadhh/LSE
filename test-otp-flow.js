#!/usr/bin/env node
/* OTP Authentication Flow Test */

const BASE = "http://localhost:8080";

async function req(method, path, body) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    return { status: res.status, body: parsed };
  } catch (err) {
    return { status: 0, body: { error: err.message } };
  }
}

(async () => {
  const result = {
    "Send OTP": "FAIL",
    "Verify OTP": "FAIL",
    "User created": "FAIL",
    "Refresh token": "FAIL",
  };

  try {
    const testPhone = "+919" + String(Date.now()).slice(-7);
    console.log("Testing OTP Authentication Flow\n");
    console.log(`Using phone: ${testPhone}\n`);

    // Step 1: Send OTP
    console.log("--- Step 1: Send OTP ---");
    const sendRes = await req("POST", "/auth/send-otp", { phone: testPhone });
    console.log(`Status: ${sendRes.status}`);
    console.log(`Body:`, JSON.stringify(sendRes.body, null, 2));

    if (sendRes.status === 200 && sendRes.body.otp) {
      result["Send OTP"] = "PASS";
      const otp = sendRes.body.otp;
      console.log(`✓ OTP sent: ${otp}\n`);

      // Step 2: Verify OTP
      console.log("--- Step 2: Verify OTP ---");
      const verifyRes = await req("POST", "/auth/verify-otp", {
        phone: testPhone,
        otp,
        role: "customer",
        deviceId: "test-device-123",
      });
      console.log(`Status: ${verifyRes.status}`);
      console.log(`Body keys:`, Object.keys(verifyRes.body));

      if (verifyRes.status === 200 && verifyRes.body.accessToken) {
        result["Verify OTP"] = "PASS";
        result["User created"] = "PASS";
        const { accessToken, refreshToken, user } = verifyRes.body;
        console.log(`✓ User authenticated successfully`);
        console.log(`  - User ID: ${user.id}`);
        console.log(`  - Phone: ${user.phone}`);
        console.log(`  - Role: ${user.role}`);
        console.log(`  - Access Token: ${accessToken.substring(0, 50)}...`);
        console.log(`  - Refresh Token: ${refreshToken.substring(0, 50)}...\n`);

        // Step 3: Refresh Token
        console.log("--- Step 3: Refresh Token ---");
        const refreshRes = await req("POST", "/auth/refresh-token", { refreshToken });
        console.log(`Status: ${refreshRes.status}`);

        if (refreshRes.status === 200 && refreshRes.body.accessToken) {
          result["Refresh token"] = "PASS";
          console.log(`✓ Token refreshed successfully`);
          console.log(`  - New access token: ${refreshRes.body.accessToken.substring(0, 50)}...`);
        } else {
          console.log(`✗ Token refresh failed: ${refreshRes.body?.error}`);
        }
      } else {
        console.log(`✗ OTP verification failed: ${verifyRes.body?.error}`);
      }
    } else {
      console.log(`✗ Send OTP failed: ${sendRes.body?.error}`);
    }

    // Summary
    console.log("\n=== OTP FLOW TEST SUMMARY ===");
    Object.entries(result).forEach(([key, val]) => {
      console.log(`${val === "PASS" ? "✓" : "✗"} ${key}: ${val}`);
    });

    const allPass = Object.values(result).every(v => v === "PASS");
    console.log(`\nResult: ${allPass ? "✓ PASS" : "✗ FAIL"}`);

    if (allPass) {
      console.log("\nOTP Authentication Flow:");
      console.log("✓ POST /auth/send-otp — Working");
      console.log("✓ POST /auth/verify-otp — Working");
    }

    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error("Test error:", err.message);
    process.exit(1);
  }
})();
