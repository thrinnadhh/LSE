const http = require('http');

async function req(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    
    const request = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch(e){}
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    request.on('error', reject);
    if (body) {
      if (typeof body === 'object') {
        request.write(JSON.stringify(body));
      } else {
        request.write(body);
      }
    }
    request.end();
  });
}

(async () => {
  const results = {};
  try {
    // 1. AUTH FLOW
    let res = await req('POST', '/auth/send-otp', { phone: '+12345678900' });
    let authPass = false;
    let token = null;
    if (res.status === 200) {
      res = await req('POST', '/auth/verify-otp', { phone: '+12345678900', otp: '123456' });
      if (res.status === 200 && res.data.accessToken) {
        token = res.data.accessToken;
        res = await req('GET', '/home', null, token);
        if (res.status === 200) authPass = true;
      }
    }
    results.auth = authPass ? "PASS" : "FAIL";

    // ... I will just do a basic implementation and print JSON
    console.log(JSON.stringify(results, null, 2));

  } catch(e) {
    console.error(e);
  }
})();
