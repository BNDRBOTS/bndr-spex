const assert = require('assert');
const crypto = require('crypto');

process.env.APP_BASE_URL = 'http://127.0.0.1:3999';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-secret';
process.env.DEEPSEEK_API_KEY = 'deepseek-secret';
process.env.STRIPE_SECRET_KEY = 'sk_live_new_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_secret';
process.env.STRIPE_SINGLE_PRICE_ID = 'price_single';
process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
process.env.PRICE_SINGLE_DISPLAY = '$7';
process.env.PRICE_MONTHLY_DISPLAY = '$9/mo';
process.env.SUPABASE_TIMEOUT_MS = '5000';
process.env.STRIPE_TIMEOUT_MS = '5000';
process.env.DEEPSEEK_TIMEOUT_MS = '5000';

const nativeFetch = global.fetch;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'buyer@example.com' };
let profile = { id: user.id, email: user.email, stripe_customer_id: null, subscription_id: null, subscription_status: 'none', subscription_current_period_end: null, cancel_at_period_end: false, single_spec_credits: 0 };
let specs = [];
let subscriptionStatus = 'active';
const billingEvents = new Set();
const stripeCalls = [];
let stripeCheckoutFailures = 0;
let stripeCheckoutBadRequestFailures = 0;
let failNextProfilePatch = false;
let deepseekTimeouts = 0;
let deepseekDriftedOutputs = 0;

const systemSpecKeys = [
  'system_overview', 'user_intent_translation', 'architecture_spec', 'module_definitions', 'api_layer', 'data_flow', 'state_management', 'integration_points', 'deterministic_derivation_logic', 'ui_ux_spec', 'component_backend_bindings', 'payment_access_logic', 'security_privacy_logic', 'failure_modes', 'fallback_recovery_logic', 'observability_support_logic', 'deployment_strategy', 'validation_logic', 'test_plan', 'acceptance_criteria', 'final_schema', 'final_instruction'
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function readBody(options) {
  return options && options.body ? JSON.parse(options.body) : {};
}
function requestHeader(options, name) {
  const headers = new Headers(options && options.headers || {});
  return headers.get(name);
}
function authHeader(options) { return requestHeader(options, 'authorization'); }
function idempotencyHeader(options) { return requestHeader(options, 'idempotency-key'); }
function stripeBody(options) {
  return new URLSearchParams(String(options.body || ''));
}
function profileRowsFor(url) {
  const query = new URL(url).searchParams;
  const id = query.get('id');
  const customer = query.get('stripe_customer_id');
  const subscription = query.get('subscription_id');
  if (id && id === `eq.${profile.id}`) return [profile];
  if (customer && customer === `eq.${profile.stripe_customer_id}`) return [profile];
  if (subscription && subscription === `eq.${profile.subscription_id}`) return [profile];
  return [];
}
function specRowsFor(url) {
  const query = new URL(url).searchParams;
  const id = query.get('id');
  if (id) return specs.filter((spec) => `eq.${spec.id}` === id);
  return [...specs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
function goalFromDeepSeekInput(raw) {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed.goal_description || parsed.original_input && parsed.original_input.goal_description || 'client project intake dashboard';
  } catch (_) {
    return 'client project intake dashboard';
  }
}
function makeSpecOutput(goal = 'client project intake dashboard') {
  const output = Object.fromEntries(systemSpecKeys.map((key) => [key, { covered: true }]));
  output.system_overview = { goal, purpose: `Build the requested product workflow for ${goal}.` };
  output.user_intent_translation = { confirmed_input: goal, derived_requirements: ['product dashboard', 'client project intake', 'role-based account access'] };
  output.architecture_spec = { client: 'responsive product UI for dashboard and intake work', server: 'authenticated product API', data: 'project intake, client, user, and audit tables' };
  output.module_definitions = [{ name: 'client project intake dashboard', responsibility: 'collect client project intake details and display dashboard status' }];
  output.component_backend_bindings = [{
    ui_component: 'client project intake form',
    backend_action: '/api/projects/intake',
    request_contract: { client_name: 'string', project_scope: 'string', intake_notes: 'string' },
    response_contract: { project: 'object', dashboard_status: 'object' },
    auth_or_entitlement: 'authenticated product user with dashboard permission',
    state_mutation: 'dashboard appends the new client project and updates intake status',
    persistence_target: 'projects, clients, intake_events, and audit_events tables',
    errors_and_fallbacks: ['validation message for incomplete intake', 'retry save after network failure', 'preserve draft project notes']
  }];
  output.failure_modes = [{ condition: 'client project intake save timeout', user_cause: false, expected_system_behavior: 'preserve intake draft and show retry action' }];
  output.fallback_recovery_logic = [{ trigger: 'project intake save failure', fallback: 'keep draft locally in memory for the current session', recovery: 'retry save or export project intake summary' }];
  output.observability_support_logic = { logs: ['request id', 'user id', 'safe route'], redaction: ['email', 'tokens', 'provider keys'], developer_notification: 'system errors only' };
  output.test_plan = ['Submit a client project intake and verify it appears on the dashboard with preserved audit data.'];
  output.acceptance_criteria = ['Client project intake dashboard includes UI, backend, payload, response, auth, state, persistence, and fallback details.'];
  output.final_schema = { product: 'client project intake dashboard', input: { project_scope: 'string' }, output: { dashboard_status: 'object' } };
  output.final_instruction = 'Build the client project intake dashboard without omitting validation, fallback, or persistence requirements.';
  return output;
}
function makeDriftedSpecOutput() {
  const output = makeSpecOutput();
  output.system_overview = { goal: 'BNDR | SPEX saved SPEX generation workspace', purpose: 'Turn one product description into a build-ready implementation contract with bounded generation recovery.' };
  output.user_intent_translation = { confirmed_input: 'BNDR | SPEX compiler', derived_requirements: ['saved SPEX library', 'billing entitlement gate'] };
  output.architecture_spec = { client: 'static HTML/CSS/JS app shell', server: 'Node HTTP API with authenticated routes', data: 'Supabase profiles and specs tables', provider: 'DeepSeek JSON generation with bounded recovery output' };
  output.component_backend_bindings = [{ ui_component: 'Generate SPEX form', backend_action: '/api/generate/system', request_contract: { goal_description: 'string' }, response_contract: { spec: 'object' }, auth_or_entitlement: 'billing entitlement gate', state_mutation: 'saved SPEX list refreshes', persistence_target: 'specs table', errors_and_fallbacks: ['provider generation timeout'] }];
  return output;
}
function makeSchemaOutput(goal = 'client project intake schema') {
  return {
    structured_schema: { instruction: `Reusable intake schema for ${goal}`, input_contract: { required_fields: ['client_name', 'project_request', 'intake_priority'] }, output_contract: { response_fields: { client_project: 'object', intake_status: 'string' } }, implementation_notes: ['Validate client project request before persistence'], final_instruction: 'Implement client project request intake schema.' },
    component_backend_bindings: [{ ui_component: 'client project request form', backend_action: '/api/projects/intake-schema', request_contract: { client_name: 'string', project_request: 'string' }, response_contract: { client_project: 'object' }, auth_or_entitlement: 'authenticated product user', state_mutation: 'client project request is validated and queued', persistence_target: 'client_projects table', errors_and_fallbacks: ['show validation error or preserve intake draft'] }],
    validation_flags: ['Client project intake key presence confirmed', 'Intake schema logic consistent', 'Model-ready'],
    failure_modes: [{ condition: 'invalid client project intake input', user_cause: true, expected_system_behavior: 'return validation error' }],
    fallback_recovery_logic: [{ trigger: 'client project request save failure', fallback: 'preserve intake draft', recovery: 'retry save or export request' }],
    acceptance_criteria: ['Client project intake schema rejects missing required fields'],
    meta_tag: 'bndr_spex_merged_schema_v1'
  };
}
function sign(body, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}
async function sendWebhook(base, event) {
  const body = JSON.stringify(event);
  return request(base, '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sign(body) }, body });
}

function mockFetch(url, options = {}) {
  const href = String(url);
  if (href === 'https://example.supabase.co/auth/v1/user') return Promise.resolve(json(user));

  if (href.startsWith('https://example.supabase.co/rest/v1/profiles')) {
    if (options.method === 'GET') return Promise.resolve(json(profileRowsFor(href)));
    if (options.method === 'POST') { profile = { ...profile, ...readBody(options) }; return Promise.resolve(json([profile])); }
    if (options.method === 'PATCH') {
      if (failNextProfilePatch) { failNextProfilePatch = false; return Promise.resolve(json({ message: 'temporary profile update outage' }, 500)); }
      profile = { ...profile, ...readBody(options) }; return Promise.resolve(json([profile]));
    }
  }

  if (href.startsWith('https://example.supabase.co/rest/v1/specs')) {
    if (options.method === 'GET') return Promise.resolve(json(specRowsFor(href)));
    if (options.method === 'POST') {
      const body = readBody(options);
      const spec = { id: '22222222-2222-4222-8222-222222222222', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
      specs.unshift(spec);
      return Promise.resolve(json([spec]));
    }
    if (options.method === 'PATCH') {
      const rows = specRowsFor(href);
      Object.assign(rows[0], readBody(options));
      return Promise.resolve(json(rows[0] || null));
    }
    if (options.method === 'DELETE') return Promise.resolve(json(null));
  }

  if (href.endsWith('/rest/v1/rpc/record_billing_event_once')) {
    const body = readBody(options);
    const firstSeen = !billingEvents.has(body.event_id);
    billingEvents.add(body.event_id);
    return Promise.resolve(json(firstSeen));
  }
  if (href.startsWith('https://example.supabase.co/rest/v1/billing_events') && options.method === 'DELETE') {
    const marker = new URL(href).searchParams.get('id') || '';
    billingEvents.delete(marker.replace(/^eq\./, ''));
    return Promise.resolve(json(null));
  }
  if (href.endsWith('/rest/v1/rpc/grant_spec_credit_once')) {
    const body = readBody(options);
    if (billingEvents.has(body.source_id)) return Promise.resolve(json(false));
    billingEvents.add(body.source_id);
    profile.single_spec_credits += Number(body.credit_count || 0);
    return Promise.resolve(json(true));
  }
  if (href.endsWith('/rest/v1/rpc/grant_spec_credits')) {
    const body = readBody(options);
    profile.single_spec_credits += Number(body.credit_count || 0);
    return Promise.resolve(json(true));
  }
  if (href.endsWith('/rest/v1/rpc/save_spec_with_credit')) {
    if (profile.single_spec_credits <= 0) return Promise.resolve(json({ message: 'No generation credit available' }, 400));
    profile.single_spec_credits -= 1;
    const body = readBody(options);
    const spec = { id: '33333333-3333-4333-8333-333333333333', user_id: body.target_user, type: body.spec_type, title: body.spec_title, input: body.spec_input, output: body.spec_output, model: body.spec_model, request_id: body.spec_request_id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    specs.unshift(spec);
    return Promise.resolve(json(spec));
  }

  if (href === 'https://api.stripe.com/v1/checkout/sessions') {
    stripeCalls.push({ path: '/checkout/sessions', auth: authHeader(options), idempotency: idempotencyHeader(options), body: stripeBody(options) });
    if (stripeCheckoutBadRequestFailures > 0) {
      stripeCheckoutBadRequestFailures -= 1;
      return Promise.resolve(json({ error: { message: 'You must configure terms of service consent in the Dashboard.' } }, 400));
    }
    if (stripeCheckoutFailures > 0) {
      stripeCheckoutFailures -= 1;
      return Promise.resolve(json({ error: { message: 'Stripe API/provider sk_live_new_key raw failure' } }, 500));
    }
    const body = stripeBody(options);
    return Promise.resolve(json({ id: 'cs_test', url: `https://checkout.stripe.test/${body.get('mode')}/${body.get('line_items[0][price]')}` }));
  }

  if (href === 'https://api.stripe.com/v1/checkout/sessions/cs_single') {
    stripeCalls.push({ path: '/checkout/sessions/cs_single', auth: authHeader(options), idempotency: idempotencyHeader(options), body: null });
    return Promise.resolve(json({ id: 'cs_single', mode: 'payment', status: 'complete', payment_status: 'paid', customer: 'cus_123', client_reference_id: user.id, metadata: { user_id: user.id, plan: 'single' } }));
  }

  if (href === 'https://api.stripe.com/v1/billing_portal/sessions') {
    stripeCalls.push({ path: '/billing_portal/sessions', auth: authHeader(options), idempotency: idempotencyHeader(options), body: stripeBody(options) });
    return Promise.resolve(json({ id: 'bps_test', url: 'https://billing.stripe.test/session' }));
  }
  if (href === 'https://api.stripe.com/v1/subscriptions/sub_123') {
    stripeCalls.push({ path: '/subscriptions/sub_123', auth: authHeader(options), idempotency: idempotencyHeader(options), body: null });
    return Promise.resolve(json({ id: 'sub_123', customer: 'cus_123', status: subscriptionStatus, current_period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false, metadata: { user_id: user.id, plan: 'monthly' } }));
  }

  if (href === 'https://api.deepseek.com/chat/completions') {
    assert.strictEqual(authHeader(options), 'Bearer deepseek-secret', 'generation uses DeepSeek server key');
    if (deepseekTimeouts > 0) {
      deepseekTimeouts -= 1;
      const error = new Error('provider hung');
      error.name = 'AbortError';
      return Promise.reject(error);
    }
    const body = readBody(options);
    const systemPrompt = String(body.messages && body.messages[0] && body.messages[0].content || '');
    const goal = goalFromDeepSeekInput(body.messages && body.messages[1] && body.messages[1].content);
    const output = systemPrompt.includes('structured_schema, component_backend_bindings, validation_flags, failure_modes, fallback_recovery_logic, acceptance_criteria, meta_tag') ? makeSchemaOutput(goal) : (deepseekDriftedOutputs-- > 0 ? makeDriftedSpecOutput() : makeSpecOutput(goal));
    return Promise.resolve(json({ id: 'deepseek-request-1', choices: [{ message: { content: JSON.stringify(output) } }] }));
  }

  return Promise.reject(new Error(`Unexpected fetch: ${href}`));
}

global.fetch = mockFetch;
const { server } = require('../server');

function listen() {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close() {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
async function request(base, path, options = {}) {
  const response = await nativeFetch(`${base}${path}`, options);
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch (_) {}
  return { response, body, text };
}
function authed(options = {}) {
  return { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user-token', ...(options.headers || {}) } };
}

(async () => {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;
  try {
    const appPage = await request(base, '/app.html');
    assert.strictEqual(appPage.response.status, 200, 'app loads');
    assert.ok(appPage.text.includes('billing-modal'), 'billing modal exists');

    const single = await request(base, '/api/billing/checkout', authed({ method: 'POST', body: JSON.stringify({ plan: 'single' }) }));
    assert.strictEqual(single.response.status, 200, 'buy checkout opens');
    assert.ok(single.body.url.includes('price_single'), 'buy uses one-time price');

    const monthly = await request(base, '/api/billing/checkout', authed({ method: 'POST', body: JSON.stringify({ plan: 'monthly' }) }));
    assert.strictEqual(monthly.response.status, 200, 'subscribe checkout opens');
    assert.ok(monthly.body.url.includes('price_monthly'), 'subscribe uses monthly price');

    for (const call of stripeCalls) assert.strictEqual(call.auth, 'Bearer sk_live_new_key', `${call.path} uses configured Stripe key`);
    for (const call of stripeCalls.filter((item) => ['/checkout/sessions', '/billing_portal/sessions'].includes(item.path))) assert.ok(call.idempotency && call.idempotency.startsWith('spex-'), `${call.path} has idempotency key`);
    const singleCall = stripeCalls.find((call) => call.path === '/checkout/sessions' && call.body.get('line_items[0][price]') === 'price_single');
    const monthlyCall = stripeCalls.find((call) => call.path === '/checkout/sessions' && call.body.get('line_items[0][price]') === 'price_monthly');
    assert.strictEqual(singleCall.body.get('payment_intent_data[metadata][user_id]'), user.id, 'buy session carries user metadata');
    assert.strictEqual(monthlyCall.body.get('subscription_data[metadata][user_id]'), user.id, 'subscribe session carries user metadata');

    const missingCustomerBilling = await request(base, '/api/billing/portal', authed({ method: 'POST', body: '{}' }));
    assert.strictEqual(missingCustomerBilling.response.status, 200, 'missing customer does not dead-end');
    assert.strictEqual(missingCustomerBilling.body.mode, 'checkout', 'missing customer falls back to checkout');
    assert.ok(missingCustomerBilling.body.url.includes('price_monthly'), 'billing fallback opens subscription checkout');

    const checkoutEvent = { id: 'evt_single', type: 'checkout.session.completed', data: { object: { id: 'cs_single', mode: 'payment', payment_status: 'paid', customer: 'cus_123', client_reference_id: user.id, metadata: { user_id: user.id, plan: 'single' } } } };
    const webhookSingle = await sendWebhook(base, checkoutEvent);
    assert.strictEqual(webhookSingle.response.status, 200, 'single webhook accepted');
    assert.strictEqual(profile.stripe_customer_id, 'cus_123', 'checkout webhook syncs customer');
    assert.strictEqual(profile.single_spec_credits, 1, 'checkout webhook grants credit');

    const confirm = await request(base, '/api/billing/confirm', authed({ method: 'POST', body: JSON.stringify({ session_id: 'cs_single' }) }));
    assert.strictEqual(confirm.response.status, 200, 'checkout return confirms billing');
    assert.strictEqual(profile.single_spec_credits, 1, 'checkout confirm does not duplicate credit');

    const generate = await request(base, '/api/generate/system', authed({ method: 'POST', body: JSON.stringify({ goal_description: 'Build a paid dashboard for client project intake.' }) }));
    assert.strictEqual(generate.response.status, 200, 'generate succeeds');
    assert.strictEqual(profile.single_spec_credits, 0, 'credit consumed atomically on save');
    assert.ok(generate.body.spec.id, 'generated SPEX saved');
    assert.ok(generate.body.spec.output.failure_modes, 'system spec includes failure modes');
    assert.ok(generate.body.spec.output.fallback_recovery_logic, 'system spec includes fallback recovery logic');
    assert.ok(generate.body.spec.output.observability_support_logic, 'system spec includes observability/support logic');
    assert.ok(generate.body.spec.output.component_backend_bindings, 'system spec includes UI/backend component bindings');
    assert.ok(generate.body.spec.output.acceptance_criteria, 'system spec includes acceptance criteria');

    const list = await request(base, '/api/specs', authed({ method: 'GET' }));
    assert.strictEqual(list.response.status, 200, 'saved list opens');
    assert.strictEqual(list.body.specs.length, 1, 'saved SPEX listed');

    const reopen = await request(base, `/api/specs/${generate.body.spec.id}`, authed({ method: 'GET' }));
    assert.strictEqual(reopen.response.status, 200, 'saved SPEX reopens');
    assert.ok(reopen.body.spec.output.final_instruction, 'reopened SPEX has output');

    const portal = await request(base, '/api/billing/portal', authed({ method: 'POST', body: '{}' }));
    assert.strictEqual(portal.response.status, 200, 'billing opens with customer');
    assert.strictEqual(portal.body.mode, 'portal', 'customer opens portal');

    const notify = await request(base, '/api/support/notify', authed({ method: 'POST', body: JSON.stringify({ title: 'Generation failed', message: 'Sanitized browser error', path: '/app.html', timestamp: new Date().toISOString() }) }));
    assert.strictEqual(notify.response.status, 200, 'developer notification endpoint accepts sanitized report');
    assert.strictEqual(notify.body.notified, true, 'developer notification returns success');

    const subscriptionCheckout = { id: 'evt_subscription', type: 'checkout.session.completed', data: { object: { id: 'cs_sub', mode: 'subscription', customer: 'cus_123', subscription: 'sub_123', client_reference_id: user.id, metadata: { user_id: user.id, plan: 'monthly' } } } };
    const webhookSub = await sendWebhook(base, subscriptionCheckout);
    assert.strictEqual(webhookSub.response.status, 200, 'subscription webhook accepted');
    assert.strictEqual(profile.subscription_status, 'active', 'subscription checkout syncs active status');

    profile.subscription_status = 'past_due';
    subscriptionStatus = 'active';
    let me = await request(base, '/api/me', authed({ method: 'GET' }));
    assert.strictEqual(me.body.access.state, 'paid', 'stale billing status self-heals from Stripe');

    const trialEvent = { id: 'evt_trial_retry', type: 'customer.subscription.updated', data: { object: { id: 'sub_123', customer: 'cus_123', status: 'trialing', current_period_end: Math.floor(Date.now() / 1000) + 86400, cancel_at_period_end: false, metadata: { user_id: user.id } } } };
    failNextProfilePatch = true;
    const trialConsoleError = console.error;
    console.error = () => {};
    const failedTrial = await sendWebhook(base, trialEvent);
    console.error = trialConsoleError;
    assert.strictEqual(failedTrial.response.status, 502, 'failed webhook asks Stripe to retry');
    assert.ok(!billingEvents.has('evt_trial_retry'), 'failed webhook releases idempotency marker');
    const retriedTrial = await sendWebhook(base, trialEvent);
    assert.strictEqual(retriedTrial.response.status, 200, 'webhook retry completes after release');
    me = await request(base, '/api/me', authed({ method: 'GET' }));
    assert.strictEqual(me.body.access.state, 'trial', 'trial access label returned');

    subscriptionStatus = 'past_due';
    const failedInvoice = { id: 'evt_invoice_failed', type: 'invoice.payment_failed', data: { object: { id: 'in_123', customer: 'cus_123', subscription: 'sub_123' } } };
    await sendWebhook(base, failedInvoice);
    me = await request(base, '/api/me', authed({ method: 'GET' }));
    assert.strictEqual(me.body.access.state, 'past_due', 'past due access label returned');

    profile = { ...profile, subscription_id: null, subscription_status: 'none', subscription_current_period_end: null, single_spec_credits: 1 };
    me = await request(base, '/api/me', authed({ method: 'GET' }));
    assert.strictEqual(me.body.access.state, 'credit', 'credit access label returned');

    const schemaGenerate = await request(base, '/api/generate/schema', authed({ method: 'POST', body: JSON.stringify({ goal_description: 'Build a reusable intake schema for client project requests.' }) }));
    assert.strictEqual(schemaGenerate.response.status, 200, 'schema generate succeeds');
    assert.strictEqual(schemaGenerate.body.spec.type, 'schema', 'schema generation saves schema type');
    assert.strictEqual(schemaGenerate.body.spec.output.meta_tag, 'bndr_spex_merged_schema_v1', 'schema output has expected meta tag');
    assert.deepStrictEqual(Object.keys(schemaGenerate.body.spec.output).sort(), ['acceptance_criteria', 'component_backend_bindings', 'failure_modes', 'fallback_recovery_logic', 'meta_tag', 'structured_schema', 'validation_flags'], 'schema output has exact keys');
    assert.ok(schemaGenerate.body.spec.output.component_backend_bindings.length, 'schema output includes UI/backend component bindings');
    assert.ok(schemaGenerate.body.spec.output.fallback_recovery_logic.length, 'schema output includes fallback recovery logic');
    assert.strictEqual(profile.single_spec_credits, 0, 'schema generation consumes credit atomically on save');

    profile = { ...profile, subscription_id: null, subscription_status: 'none', subscription_current_period_end: null, single_spec_credits: 1 };
    deepseekDriftedOutputs = 1;
    const repairedDrift = await request(base, '/api/generate/system', authed({ method: 'POST', body: JSON.stringify({ goal_description: 'Build an app that helps me build a legal case through an agent with forensic turn-by-turn logging, court API accuracy, deterministic state machine, full memory logging, hashed evidence history, any-file upload analysis, and court-ready letter writing.' }) }));
    assert.strictEqual(repairedDrift.response.status, 200, 'drifted BNDR/SPEX output repairs and succeeds');
    const repairedText = JSON.stringify(repairedDrift.body.spec.output).toLowerCase();
    assert.ok(repairedText.includes('legal') || repairedText.includes('court') || repairedText.includes('forensic'), 'repaired SPEX preserves requested domain');
    assert.ok(!repairedText.includes('/api/generate/system'), 'repaired SPEX does not describe internal generator route');
    assert.ok(!repairedText.includes('saved spex library'), 'repaired SPEX does not describe BNDR/SPEX saved library');

    stripeCheckoutBadRequestFailures = 1;
    const checkoutFallback = await request(base, '/api/billing/checkout', authed({ method: 'POST', body: JSON.stringify({ plan: 'single' }) }));
    assert.strictEqual(checkoutFallback.response.status, 200, 'checkout retries without optional Stripe parameters after 400');
    const fallbackCalls = stripeCalls.filter((call) => call.path === '/checkout/sessions').slice(-2);
    assert.strictEqual(fallbackCalls.length, 2, 'checkout fallback uses two Stripe attempts');
    assert.ok(fallbackCalls[0].body.has('tax_id_collection[enabled]'), 'first checkout attempt includes enhanced billing parameters');
    assert.ok(!fallbackCalls[1].body.has('tax_id_collection[enabled]'), 'fallback checkout attempt removes optional billing parameters');
    assert.strictEqual(fallbackCalls[1].body.get('line_items[0][price]'), 'price_single', 'fallback checkout preserves requested one-shot price');

    profile = { ...profile, subscription_id: null, subscription_status: 'none', subscription_current_period_end: null, single_spec_credits: 1 };
    deepseekTimeouts = 1;
    const providerTimeout = await request(base, '/api/generate/system', authed({ method: 'POST', body: JSON.stringify({ goal_description: 'Build a field service scheduler with dispatch views and billing recovery.' }) }));
    assert.strictEqual(providerTimeout.response.status, 504, 'provider timeout returns timeout error');
    assert.ok(/Generation is taking too long/i.test(providerTimeout.body.error), 'provider timeout message is safe and clear');
    assert.strictEqual(profile.single_spec_credits, 1, 'provider timeout does not consume credit');
    assert.ok(!providerTimeout.body.spec, 'provider timeout does not return fake SPEX output');

    profile = { ...profile, subscription_id: null, subscription_status: 'canceled', subscription_current_period_end: new Date(Date.now() - 86400).toISOString(), single_spec_credits: 0 };
    me = await request(base, '/api/me', authed({ method: 'GET' }));
    assert.strictEqual(me.body.access.state, 'expired', 'expired access label returned');

    stripeCheckoutFailures = 1;
    const retriedCheckout = await request(base, '/api/billing/checkout', authed({ method: 'POST', body: JSON.stringify({ plan: 'monthly' }) }));
    assert.strictEqual(retriedCheckout.response.status, 200, 'transient Stripe checkout failure retries safely');

    stripeCheckoutFailures = 2;
    const originalConsoleError = console.error;
    console.error = () => {};
    const rawStripeFailure = await request(base, '/api/billing/checkout', authed({ method: 'POST', body: JSON.stringify({ plan: 'single' }) }));
    console.error = originalConsoleError;
    assert.strictEqual(rawStripeFailure.response.status, 502, 'provider failure maps to upstream error');
    assert.ok(!/stripe|provider|sk_live|api key/i.test(rawStripeFailure.body.error), 'customer error is sanitized');

    const css = await request(base, '/styles.css');
    assert.ok(/@media \(max-width: 720px\)/.test(css.text), 'mobile breakpoint present');
    assert.ok(css.text.includes('.modal-actions'), 'billing modal mobile styles present');

    console.log('FULL_PATH_PASS buy subscribe billing-recovery checkout-confirm self-heal-retry generate schema timeout-error notify save reopen webhook-labels sanitized-errors mobile');
  } finally {
    await close();
    global.fetch = nativeFetch;
  }
})().catch(async (error) => {
  try { await close(); } catch (_) {}
  global.fetch = nativeFetch;
  console.error(error);
  process.exit(1);
});
