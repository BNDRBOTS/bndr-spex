const assert = require('assert');
const crypto = require('crypto');

process.env.APP_BASE_URL = 'http://127.0.0.1:3999';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-secret';
process.env.DEEPSEEK_API_KEY = 'deepseek-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_secret';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_secret';
process.env.STRIPE_SINGLE_PRICE_ID = 'price_single';
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
process.env.PRICE_SINGLE_DISPLAY = '$7';
process.env.PRICE_MONTHLY_DISPLAY = '$9/mo';

const { server } = require('../server');

function listen() {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close() {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch (_) {}
  return { response, body, text };
}

function signatureFor(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

(async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const pages = ['/', '/login.html', '/app.html', '/styles.css', '/app.js', '/env.js'];
    for (const page of pages) {
      const { response, text } = await request(base, page);
      assert.strictEqual(response.status, 200, `${page} should load`);
      assert.ok(response.headers.get('x-content-type-options'), `${page} has security headers`);
      if (page === '/env.js') {
        assert.ok(!text.includes('service-test-secret'), 'env.js must not expose service role');
        assert.ok(!text.includes('sk_test_secret'), 'env.js must not expose Stripe secret');
        assert.ok(!text.includes('whsec_secret'), 'env.js must not expose Stripe webhook secret');
        assert.ok(!text.includes('deepseek-secret'), 'env.js must not expose DeepSeek key');
        assert.ok(text.includes('anon-public-key'), 'env.js should expose Supabase anon key');
      }
    }

    const health = await request(base, '/api/health');
    assert.strictEqual(health.response.status, 200, 'health endpoint should return 200');
    assert.strictEqual(health.body.status, 'ok', 'health endpoint status ok');

    const protectedRoutes = [
      ['/api/me', { method: 'GET' }],
      ['/api/specs', { method: 'GET' }],
      ['/api/generate/system', { method: 'POST', body: JSON.stringify({ goal_description: 'Build something real' }) }],
      ['/api/generate/schema', { method: 'POST', body: JSON.stringify({ goal_description: 'Build something real' }) }],
      ['/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan: 'single' }) }],
      ['/api/billing/portal', { method: 'POST', body: JSON.stringify({}) }]
    ];
    for (const [route, options] of protectedRoutes) {
      const result = await request(base, route, { ...options, headers: { 'Content-Type': 'application/json' } });
      assert.strictEqual(result.response.status, 401, `${route} should require auth`);
    }

    const traversal = await request(base, '/../server.js');
    assert.notStrictEqual(traversal.response.status, 200, 'path traversal must not serve server.js');
    assert.ok(!String(traversal.text).includes('STRIPE_SECRET_KEY'), 'path traversal response must not leak source');

    const invalidWebhook = await request(base, '/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=1,v1=bad' },
      body: '{}'
    });
    assert.strictEqual(invalidWebhook.response.status, 400, 'invalid Stripe signature should fail');

    const oldTimestamp = Math.floor(Date.now() / 1000) - 1000;
    const signedOld = await request(base, '/api/stripe/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signatureFor('{}', 'whsec_secret', oldTimestamp) },
      body: '{}'
    });
    assert.strictEqual(signedOld.response.status, 400, 'old Stripe signature should fail tolerance');

    console.log('SMOKE_PASS pages routes auth headers env webhook traversal');
  } finally {
    await close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
