const baseUrl = 'http://localhost:8080';
const phone = '+919' + Date.now().toString().slice(-7);

async function testHomepage() {
  try {
    // Step 1: Send OTP
    console.log('📱 Sending OTP to', phone);
    const sendRes = await fetch(`${baseUrl}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    }).then(r => r.json());

    const otp = sendRes.otp;
    console.log('📩 OTP received:', otp);

    // Step 2: Verify OTP
    console.log('🔑 Verifying OTP...');
    const verifyRes = await fetch(`${baseUrl}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        otp,
        role: 'customer'
      })
    }).then(r => r.json());

    const token = verifyRes.accessToken;
    console.log('✅ Authenticated! Token:', token?.substring(0, 50) + '...\n');

    // Step 3: Get homepage
    console.log('🏠 Fetching homepage...');
    const homeRes = await fetch(`${baseUrl}/home?lat=17.385&lng=78.4867`, {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json());

    console.log('\n📊 HOMEPAGE RESPONSE:\n');
    console.log(JSON.stringify(homeRes, null, 2));

    // Summary
    console.log('\n📈 SUMMARY:');
    console.log('- Favorites:', homeRes.favorites?.length || 0);
    console.log('- Regular Shops:', homeRes.regularShops?.length || 0);
    console.log('- Recommended:', homeRes.recommended?.length || 0);
    console.log('- Categories:', homeRes.categories?.length || 0);

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testHomepage();
