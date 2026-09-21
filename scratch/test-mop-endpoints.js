const http = require('http');

async function testServerIntegration() {
  console.log('--- Testing Server MOP Endpoints ---');

  // Require express app from server.js if possible, or spawn server.js on custom PORT
  process.env.PORT = '3099';
  process.env.JWT_SECRET = 'test-secret';
  
  // Start server
  const serverProcess = require('child_process').spawn('node', ['server.js'], {
    env: { ...process.env, PORT: '3099' },
    cwd: 'f:\\Infinite Trading',
    stdio: 'pipe'
  });

  serverProcess.stdout.on('data', d => console.log('[SERVER]', d.toString().trim()));
  serverProcess.stderr.on('data', d => console.error('[SERVER ERR]', d.toString().trim()));

  // Wait 1.5s for server to start
  await new Promise(r => setTimeout(r, 1500));

  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const opts = {
        hostname: '127.0.0.1',
        port: 3099,
        path,
        method: options.method || 'GET',
        headers: options.headers || {},
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      if (options.body) req.write(JSON.stringify(options.body));
      req.end();
    });
  }

  try {
    // 1. Test GET /api/mop
    console.log('Testing GET /api/mop...');
    const mopRes = await request('/api/mop');
    console.log('GET /api/mop status:', mopRes.status);
    console.log('Default MOP list:', mopRes.body);
    if (mopRes.status !== 200 || !Array.isArray(mopRes.body.mop)) {
      throw new Error('GET /api/mop failed!');
    }
    console.log('  -> PASS');

    // 2. Sign JWT as admin
    console.log('\nSigning JWT as admin (Toshi)...');
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 1, username: 'Toshi', role: 'admin' }, process.env.JWT_SECRET || 'dev-only-change-me');
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    };

    // 3. Test GET /api/admin/mop
    console.log('\nTesting GET /api/admin/mop...');
    const adminMopRes = await request('/api/admin/mop', { headers: authHeaders });
    console.log('GET /api/admin/mop status:', adminMopRes.status);
    console.log('Channels count:', adminMopRes.body.mop.length);
    if (adminMopRes.status !== 200) throw new Error('GET /api/admin/mop failed!');
    console.log('  -> PASS');

    // 4. Test POST /api/admin/mop (Create Maya channel with QR image)
    console.log('\nTesting POST /api/admin/mop (Create Maya channel)...');
    const createRes = await request('/api/admin/mop', {
      method: 'POST',
      headers: authHeaders,
      body: {
        method: 'Maya',
        account_name: 'Infinite Trading Official Maya',
        account_number: '0918 888 9999',
        qr_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        instructions: 'Scan Maya QR or send to mobile number.',
        is_active: true,
        is_primary: false,
      }
    });
    console.log('Create MOP status:', createRes.status);
    console.log('Created MOP:', createRes.body.mop);
    if (createRes.status !== 200 || !createRes.body.mop || createRes.body.mop.method !== 'Maya') {
      throw new Error('Create MOP failed!');
    }
    const createdId = createRes.body.mop.id;
    console.log('  -> PASS');

    // 5. Test POST /api/admin/mop/:id/toggle
    console.log(`\nTesting POST /api/admin/mop/${createdId}/toggle...`);
    const toggleRes = await request(`/api/admin/mop/${createdId}/toggle`, {
      method: 'POST',
      headers: authHeaders
    });
    console.log('Toggle MOP status:', toggleRes.status, 'New active state:', toggleRes.body.mop.is_active);
    if (toggleRes.status !== 200 || toggleRes.body.mop.is_active !== false) {
      throw new Error('Toggle MOP failed!');
    }
    console.log('  -> PASS');

    // 6. Test DELETE /api/admin/mop/:id
    console.log(`\nTesting DELETE /api/admin/mop/${createdId}...`);
    const delRes = await request(`/api/admin/mop/${createdId}`, {
      method: 'DELETE',
      headers: authHeaders
    });
    console.log('Delete MOP status:', delRes.status);
    if (delRes.status !== 200 || !delRes.body.ok) {
      throw new Error('Delete MOP failed!');
    }
    console.log('  -> PASS');

    // 7. Test /api/dashboard returns official_mop
    console.log('\nTesting /api/dashboard official_mop payload...');
    const dashRes = await request('/api/dashboard', { headers: authHeaders });
    console.log('Dashboard status:', dashRes.status);
    console.log('Dashboard official_mop returned:', Array.isArray(dashRes.body.official_mop));
    console.log('Dashboard metrics:', dashRes.body.metrics);
    if (dashRes.status !== 200 || !Array.isArray(dashRes.body.official_mop)) {
      throw new Error('/api/dashboard does not return official_mop!');
    }
    console.log('  -> PASS');

    console.log('\n======================================');
    console.log('ALL INTEGRATION TESTS PASSED 100%!');
    console.log('======================================');
  } finally {
    serverProcess.kill();
  }
}

testServerIntegration().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
