const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY_BYTES = 1024 * 1024;
const STRIPE_API = 'https://api.stripe.com/v1';
const DEFAULT_TIMEOUT_MS = Number(process.env.OUTBOUND_TIMEOUT_MS || 45000);
const SUPABASE_TIMEOUT_MS = Number(process.env.SUPABASE_TIMEOUT_MS || 15000);
const STRIPE_TIMEOUT_MS = Number(process.env.STRIPE_TIMEOUT_MS || 20000);
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS || 165000);
const SERVER_REQUEST_TIMEOUT_MS = Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 190000);
const ACCOUNT_RETRY_ATTEMPTS = Number(process.env.ACCOUNT_RETRY_ATTEMPTS || 1);
const BILLING_RETRY_ATTEMPTS = Number(process.env.BILLING_RETRY_ATTEMPTS || 1);
const OUTBOUND_RETRY_DELAY_MS = Number(process.env.OUTBOUND_RETRY_DELAY_MS || 300);

const systemSpecKeys = [
  'system_overview',
  'user_intent_translation',
  'architecture_spec',
  'module_definitions',
  'api_layer',
  'data_flow',
  'state_management',
  'integration_points',
  'deterministic_derivation_logic',
  'ui_ux_spec',
  'payment_access_logic',
  'security_privacy_logic',
  'failure_modes',
  'fallback_recovery_logic',
  'observability_support_logic',
  'deployment_strategy',
  'validation_logic',
  'test_plan',
  'acceptance_criteria',
  'final_schema',
  'final_instruction'
];
const schemaKeys = ['structured_schema', 'validation_flags', 'failure_modes', 'fallback_recovery_logic', 'acceptance_criteria', 'meta_tag'];

const publicEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
  PRICE_SINGLE_DISPLAY: process.env.PRICE_SINGLE_DISPLAY || '$7',
  PRICE_MONTHLY_DISPLAY: process.env.PRICE_MONTHLY_DISPLAY || '$9/mo',
  APP_NAME: process.env.APP_NAME || 'BNDR | SPEX'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function writePublicEnv() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(PUBLIC_DIR, 'env.js'), `window.HD_ENV = ${JSON.stringify(publicEnv)};\n`, 'utf8');
}
function envValue(primary, aliases = []) {
  for (const key of [primary, ...aliases]) {
    const value = process.env[key];
    if (value && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}
function appBaseUrl() { return envValue('APP_BASE_URL', ['APP_ORIGIN']).replace(/\/$/, ''); }
function stripeSinglePriceId() { return envValue('STRIPE_SINGLE_PRICE_ID', ['STRIPE_ONE_TIME_PRICE_ID']); }
function stripeMonthlyPriceId() { return envValue('STRIPE_MONTHLY_PRICE_ID'); }
function configStatus() {
  const missing = [];
  if (!appBaseUrl()) missing.push('APP_BASE_URL');
  for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DEEPSEEK_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
    if (!process.env[key] || String(process.env[key]).trim() === '') missing.push(key);
  }
  if (!stripeSinglePriceId()) missing.push('STRIPE_SINGLE_PRICE_ID');
  if (!stripeMonthlyPriceId()) missing.push('STRIPE_MONTHLY_PRICE_ID');
  return { ok: missing.length === 0, missing };
}
function securityHeaders(contentType) {
  return {
    'Content-Type': contentType || 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': contentType && contentType.includes('text/html') ? 'no-store' : 'public, max-age=300',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.deepseek.com",
      "img-src 'self' data:",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; ')
  };
}
function send(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const type = typeof payload === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8';
  res.writeHead(status, { ...securityHeaders(type), ...headers });
  res.end(body);
}
function appError(message, status = 500, code = 'server_error', publicMessage = message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}
function configError(name) {
  return appError(`${name} is not configured`, 500, 'service_unavailable', 'This service is temporarily unavailable. Please try again shortly.');
}
function servicePublicMessage(service, status) {
  if (service === 'billing') return status === 504 ? 'Billing is taking too long to respond. Please try again.' : 'Billing is unavailable right now. Please try again.';
  if (service === 'generation') return status === 504 ? 'Generation is taking too long to respond. Please try again.' : 'Generation could not finish right now. Please try again.';
  if (service === 'account') return status === 504 ? 'Account data is taking too long to respond. Please try again.' : 'Account data is unavailable right now. Please try again.';
  return status === 504 ? 'The request timed out. Please try again.' : 'The request could not be completed. Please try again.';
}
function publicErrorPayload(error, status) {
  const safeStatuses = new Set([400, 401, 402, 403, 404, 405, 413]);
  const message = error.publicMessage || (safeStatuses.has(status) ? error.message : 'Something went wrong. Please try again.');
  const payload = { error: message };
  if (error.code && !String(error.code).includes('secret')) payload.code = error.code;
  if (status === 402) payload.plans = { single: publicEnv.PRICE_SINGLE_DISPLAY, monthly: publicEnv.PRICE_MONTHLY_DISPLAY };
  return payload;
}
function redactLog(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_]+\b/g, '[redacted-stripe-key]')
    .replace(/\bwhsec_[A-Za-z0-9_]+\b/g, '[redacted-webhook-secret]')
    .replace(/Bearer\s+[^\s,}]+/gi, 'Bearer [redacted]');
}
function logServerError(context, error) {
  console.error(context, { status: error.status || 500, code: error.code || 'server_error', message: redactLog(error.message) });
}
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); } catch (_) { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}
function safeString(value, max = 8000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function titleFromInput(type, body) {
  const source = safeString(body.goal_description || body.title || type, 96);
  return source || (type === 'schema' ? 'Structured schema' : 'System specification');
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryAttemptsForService(service) {
  if (service === 'billing') return BILLING_RETRY_ATTEMPTS;
  return 0;
}
function retryDelay(attempt) {
  return OUTBOUND_RETRY_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 75);
}
function isRetryableError(error) {
  const status = Number(error && error.status || 0);
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}
async function fetchJson(url, options = {}) {
  const { retries, ...requestOptions } = options;
  const service = requestOptions.service || 'request';
  const maxRetries = Number.isFinite(Number(retries)) ? Number(retries) : retryAttemptsForService(service);
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try { return await fetchJsonOnce(url, requestOptions); }
    catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRetryableError(error)) throw error;
      await delay(retryDelay(attempt));
    }
  }
  throw lastError;
}
async function fetchJsonOnce(url, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, service = 'request', publicMessage, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let text = '';
  try {
    response = await fetch(url, { ...fetchOptions, signal: fetchOptions.signal || controller.signal });
    text = await response.text();
  } catch (error) {
    const status = error.name === 'AbortError' ? 504 : 502;
    throw appError(`${service} request ${status === 504 ? 'timed out' : 'failed'}: ${error.message}`, status, `${service}_${status === 504 ? 'timeout' : 'unavailable'}`, publicMessage || servicePublicMessage(service, status));
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (_) { data = { raw: text }; } }
  if (!response.ok) {
    const detail = data && data.error && (data.error.message || data.error) || data && data.message || `HTTP ${response.status}`;
    const status = response.status >= 500 ? 502 : response.status;
    const error = appError(`${service} request failed (${response.status}): ${detail}`, status, `${service}_request_failed`, publicMessage || servicePublicMessage(service, status));
    error.data = data;
    throw error;
  }
  return data;
}
function supabaseUrl(pathname) {
  const base = process.env.SUPABASE_URL;
  if (!base) throw configError('SUPABASE_URL');
  return `${base.replace(/\/$/, '')}${pathname}`;
}
async function supabaseRest(pathname, options = {}) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw configError('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: options.prefer || 'return=representation', ...(options.headers || {}) };
  return fetchJson(supabaseUrl(`/rest/v1${pathname}`), { ...options, headers, service: 'account', timeoutMs: options.timeoutMs || SUPABASE_TIMEOUT_MS });
}
async function verifyUser(req) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const token = match[1];
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw configError('SUPABASE_ANON_KEY');
  const user = await fetchJson(supabaseUrl('/auth/v1/user'), { headers: { apikey: anonKey, Authorization: `Bearer ${token}` }, service: 'account', timeoutMs: SUPABASE_TIMEOUT_MS, retries: ACCOUNT_RETRY_ATTEMPTS, publicMessage: 'Please sign in again.' });
  if (!user || !user.id) throw Object.assign(new Error('Invalid session'), { status: 401 });
  return { user, token };
}
async function getProfile(user) {
  const rows = await supabaseRest(`/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`, { method: 'GET', prefer: 'return=representation', retries: ACCOUNT_RETRY_ATTEMPTS });
  if (Array.isArray(rows) && rows[0]) return rows[0];
  const created = await supabaseRest('/profiles', { method: 'POST', body: JSON.stringify({ id: user.id, email: user.email || null }), headers: { Prefer: 'resolution=merge-duplicates,return=representation' } });
  return Array.isArray(created) ? created[0] : created;
}
async function updateProfileByUserId(userId, patch) {
  const rows = await supabaseRest(`/profiles?id=eq.${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
  return Array.isArray(rows) ? rows[0] : rows;
}
async function getProfileByStripeCustomer(customerId) {
  const rows = await supabaseRest(`/profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`, { method: 'GET', retries: ACCOUNT_RETRY_ATTEMPTS });
  return Array.isArray(rows) ? rows[0] : null;
}
async function getProfileBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const rows = await supabaseRest(`/profiles?subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`, { method: 'GET', retries: ACCOUNT_RETRY_ATTEMPTS });
  return Array.isArray(rows) ? rows[0] : null;
}
function subscriptionWindowActive(profile) {
  if (!profile || !profile.subscription_current_period_end) return true;
  const periodEnd = new Date(profile.subscription_current_period_end).getTime();
  return Number.isFinite(periodEnd) && periodEnd > Date.now();
}
function isSubscriptionActive(profile) {
  if (!profile) return false;
  const status = String(profile.subscription_status || 'none').toLowerCase();
  return ['active', 'trialing'].includes(status) && subscriptionWindowActive(profile);
}
function accessState(profile) {
  const status = String(profile && profile.subscription_status || 'none').toLowerCase();
  const credits = Number(profile && profile.single_spec_credits || 0);
  const periodActive = subscriptionWindowActive(profile);
  const pastDueStatuses = new Set(['past_due', 'unpaid', 'incomplete', 'incomplete_expired']);
  if (status === 'trialing' && periodActive) return { state: 'trial', label: 'Trial access', source: 'subscription', canGenerate: true, credits };
  if (status === 'active' && periodActive) return { state: 'paid', label: 'Paid access', source: 'subscription', canGenerate: true, credits };
  if (pastDueStatuses.has(status)) return { state: 'past_due', label: 'Past due', source: credits > 0 ? 'credit' : null, canGenerate: credits > 0, credits };
  if (credits > 0) return { state: 'credit', label: 'Credit access', source: 'credit', canGenerate: true, credits };
  return { state: 'expired', label: 'Expired', source: null, canGenerate: false, credits };
}
async function requireEntitlement(user) {
  let profile = await getProfile(user);
  let access = accessState(profile);
  if (!access.canGenerate && profile.subscription_id) {
    profile = await refreshBillingProfile(profile);
    access = accessState(profile);
  }
  if (isSubscriptionActive(profile)) return { profile, source: 'subscription', access };
  if ((profile.single_spec_credits || 0) > 0) return { profile, source: 'credit', access };
  throw appError('Payment required', 402, 'payment_required', 'Buy one SPEX or subscribe monthly to generate.');
}
async function grantCredit(userId, amount, sourceId = null, sourcePayload = {}) {
  if (sourceId) {
    return supabaseRest('/rpc/grant_spec_credit_once', { method: 'POST', body: JSON.stringify({ target_user: userId, credit_count: amount, source_id: sourceId, source_type: 'checkout.credit', source_payload: sourcePayload }), prefer: 'return=representation' });
  }
  return supabaseRest('/rpc/grant_spec_credits', { method: 'POST', body: JSON.stringify({ target_user: userId, credit_count: amount }), prefer: 'return=representation' });
}
function validateKeys(obj, requiredKeys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  return requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(obj, key)) && keys.every((key) => requiredKeys.includes(key));
}
function expectedJsonExample(mode) {
  if (mode === 'schema') {
    return JSON.stringify({
      structured_schema: {
        instruction: 'directive',
        input_contract: { required_fields: [], optional_fields: [], assumptions: [] },
        output_contract: { response_fields: {}, types: {}, constraints: {} },
        implementation_notes: [],
        final_instruction: 'instruction'
      },
      validation_flags: ['Key presence confirmed', 'Logic consistent', 'Model-ready'],
      failure_modes: [{ condition: 'what can fail', user_cause: false, expected_system_behavior: 'specific behavior' }],
      fallback_recovery_logic: [{ trigger: 'failure trigger', fallback: 'fallback behavior', recovery: 'recovery path' }],
      acceptance_criteria: ['Specific, testable condition'],
      meta_tag: 'bndr_spex_merged_schema_v1'
    }, null, 2);
  }
  return JSON.stringify(Object.fromEntries(systemSpecKeys.map((key) => {
    if (key.endsWith('_definitions') || ['failure_modes', 'test_plan', 'acceptance_criteria'].includes(key)) return [key, []];
    if (key === 'final_instruction') return [key, 'concise execution directive'];
    return [key, {}];
  })), null, 2);
}
function mergedSpexPrompt() {
  return [
    'BNDR | SPEX converts one plain-language product description into a complete build-ready system specification.',
    'The only customer input is goal_description. Derive every needed technical dimension internally unless it is explicitly stated inside that description.',
    'Merge schema-standardization with end-to-end system-specification. Produce reusable JSON that a developer can implement without theatrical filler. Do not produce conversational advice.',
    'Derive runtime model, scope, platforms, constraints, dependencies, design requirements, data requirements, architecture, APIs, database and storage logic, auth, billing, UI states, deployment, validation, and testing from the description.',
    'Include concrete graceful fallback and failsafe behavior for expected failure paths: invalid input, unauthenticated access, authorization failure, payment failure, provider/model timeout, provider/model invalid JSON, database read/write failure, save-after-generation failure, network failure, rate limiting, empty states, loading states, retry exhaustion, and user recovery paths.',
    'Include observability and support handoff requirements: what should be logged, what must be redacted, what user-facing error is safe to show, when a developer notification is appropriate, and how support can reproduce the issue.',
    'Preserve the original description. Label inferred items as inferred. Put unclear items in open questions or validation requirements instead of inventing facts.',
    'Every acceptance criterion and test item must be specific and objectively verifiable.',
    'Do not include server credentials, payment credentials, database admin credentials, webhook credentials, provider tokens, internal system text, or implementation secrets.',
    'Do not require the customer to know dependencies, integrations, runtime model, target platforms, database design, or API routes.',
    'Return strict JSON only. No markdown, code fences, or commentary.'
  ].join(' ');
}
function buildSystemPrompt() {
  return [
    mergedSpexPrompt(),
    'Return exactly these top-level keys and no others:',
    systemSpecKeys.join(', '),
    'Populate every field with concrete build-relevant content.',
    'failure_modes must list realistic failure conditions, whether they are user-caused or system-caused, visible symptoms, and expected system behavior.',
    'fallback_recovery_logic must map each important failure trigger to fallback behavior, retry/escape behavior, user messaging, and recovery path.',
    'observability_support_logic must define logging, redaction, developer notification, support contact, and reproduction context requirements.',
    'acceptance_criteria must be a list of specific pass/fail checks that prove the spec is complete.',
    'final_schema must be a reusable schema representation of the derived system, including required fields, optional fields, validations, fallback rules, and output contract.',
    'final_instruction must be a concise execution directive.'
  ].join('\n\n');
}
function buildSchemaPrompt() {
  return [
    mergedSpexPrompt(),
    'Return exactly these top-level keys and no others:',
    schemaKeys.join(', '),
    'structured_schema must include input_contract, output_contract, implementation_notes, and final_instruction.',
    'failure_modes must list schema-level validation, runtime, persistence, integration, and user recovery failures.',
    'fallback_recovery_logic must map schema validation and runtime failures to concrete fallback and recovery behavior.',
    'acceptance_criteria must be testable conditions proving the schema is complete and reusable.',
    'meta_tag must be bndr_spex_merged_schema_v1.'
  ].join('\n\n');
}
function deepSeekPrompt(mode) { return [(mode === 'schema' ? buildSchemaPrompt() : buildSystemPrompt()), 'Expected JSON shape:', expectedJsonExample(mode)].join('\n\n'); }
function parseModelJson(content) {
  const text = String(content || '').trim();
  if (!text) throw Object.assign(new Error('DeepSeek returned no content'), { status: 502 });
  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch (_) {
    const first = unfenced.indexOf('{');
    const last = unfenced.lastIndexOf('}');
    if (first >= 0 && last > first) return JSON.parse(unfenced.slice(first, last + 1));
    throw Object.assign(new Error('DeepSeek returned invalid JSON'), { status: 502 });
  }
}
async function callDeepSeek({ mode, input }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw configError('DEEPSEEK_API_KEY');
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
  const isSystem = mode === 'system';
  const maxTokens = Number(process.env.DEEPSEEK_MAX_TOKENS || (isSystem ? 9000 : 4500));
  const response = await fetchJson('https://api.deepseek.com/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'system', content: deepSeekPrompt(mode) }, { role: 'user', content: JSON.stringify(input) }], response_format: { type: 'json_object' }, thinking: { type: process.env.DEEPSEEK_THINKING || 'enabled' }, reasoning_effort: process.env.DEEPSEEK_REASONING_EFFORT || 'high', temperature: 0.2, max_tokens: maxTokens, stream: false }), service: 'generation', timeoutMs: DEEPSEEK_TIMEOUT_MS });
  const requestId = response.id || null;
  const content = response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  const parsed = parseModelJson(content);
  if (isSystem && !validateKeys(parsed, systemSpecKeys)) throw Object.assign(new Error('System spec failed schema validation'), { status: 502 });
  if (!isSystem && !validateKeys(parsed, schemaKeys)) throw Object.assign(new Error('Structured schema failed validation'), { status: 502 });
  return { output: parsed, model, requestId };
}
async function saveSpec(userId, type, title, input, result, entitlementSource) {
  const payload = { target_user: userId, spec_type: type, spec_title: title, spec_input: input, spec_output: result.output, spec_model: result.model, spec_request_id: result.requestId };
  if (entitlementSource === 'credit') {
    const saved = await supabaseRest('/rpc/save_spec_with_credit', { method: 'POST', body: JSON.stringify(payload), prefer: 'return=representation' });
    return Array.isArray(saved) ? saved[0] : saved;
  }
  const rows = await supabaseRest('/specs', { method: 'POST', body: JSON.stringify({ user_id: userId, type, title, input, output: result.output, model: result.model, request_id: result.requestId }) });
  return Array.isArray(rows) ? rows[0] : rows;
}
function formEncode(object) { const params = new URLSearchParams(); Object.entries(object).forEach(([key, value]) => { if (value !== undefined && value !== null) params.append(key, String(value)); }); return params.toString(); }
function stripeIdempotencyKey() {
  return `spex-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}
async function stripeRequest(pathname, options = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw configError('STRIPE_SECRET_KEY');
  const method = String(options.method || 'GET').toUpperCase();
  const headers = { Authorization: `Bearer ${key}`, ...(options.headers || {}) };
  if (method !== 'GET' && !headers['Idempotency-Key']) headers['Idempotency-Key'] = stripeIdempotencyKey();
  return fetchJson(`${STRIPE_API}${pathname}`, { ...options, headers, service: 'billing', timeoutMs: options.timeoutMs || STRIPE_TIMEOUT_MS, retries: options.retries === undefined ? BILLING_RETRY_ATTEMPTS : options.retries });
}
async function createCheckoutSession(user, profile, plan) {
  const isMonthly = plan === 'monthly';
  const priceId = isMonthly ? stripeMonthlyPriceId() : stripeSinglePriceId();
  if (!priceId) throw configError('STRIPE_PRICE_ID');
  const baseUrl = appBaseUrl();
  if (!baseUrl) throw configError('APP_BASE_URL');
  const params = { mode: isMonthly ? 'subscription' : 'payment', success_url: `${baseUrl}/app.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${baseUrl}/app.html?checkout=cancelled`, client_reference_id: user.id, 'metadata[user_id]': user.id, 'metadata[plan]': plan, 'line_items[0][price]': priceId, 'line_items[0][quantity]': '1', allow_promotion_codes: 'true', billing_address_collection: 'required', 'phone_number_collection[enabled]': 'false', 'tax_id_collection[enabled]': 'true', 'consent_collection[terms_of_service]': 'required', 'custom_text[terms_of_service_acceptance][message]': `I agree to BNDR | SPEX Terms of Service: ${baseUrl}/terms.html` };
  if (isMonthly) {
    params['subscription_data[metadata][user_id]'] = user.id;
    params['subscription_data[metadata][plan]'] = plan;
  } else {
    params['payment_intent_data[metadata][user_id]'] = user.id;
    params['payment_intent_data[metadata][plan]'] = plan;
  }
  if (process.env.STRIPE_AUTOMATIC_TAX === 'true') params['automatic_tax[enabled]'] = 'true';
  if (!isMonthly) params.customer_creation = 'always';
  if (profile.stripe_customer_id) { params.customer = profile.stripe_customer_id; params['customer_update[address]'] = 'auto'; params['customer_update[name]'] = 'auto'; } else if (user.email) { params.customer_email = user.email; }
  return stripeRequest('/checkout/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode(params) });
}
async function createPortalSession(profile) {
  if (!profile || !profile.stripe_customer_id) return null;
  return stripeRequest('/billing_portal/sessions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formEncode({ customer: profile.stripe_customer_id, return_url: `${appBaseUrl()}/app.html` }) });
}
async function createBillingEntrySession(user, profile) {
  if (profile && profile.stripe_customer_id) {
    try {
      const portal = await createPortalSession(profile);
      if (portal && portal.url) return { url: portal.url, mode: 'portal' };
    } catch (error) {
      logServerError('Billing portal fallback to checkout', error);
    }
  }
  const checkoutProfile = profile && profile.stripe_customer_id ? { ...profile, stripe_customer_id: null } : profile;
  const checkout = await createCheckoutSession(user, checkoutProfile || {}, 'monthly');
  return { url: checkout.url, mode: 'checkout' };
}
function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw configError('STRIPE_WEBHOOK_SECRET');
  if (!signatureHeader) throw Object.assign(new Error('Missing Stripe signature'), { status: 400 });
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => { const [key, value] = part.split('='); return [key, value]; }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) throw Object.assign(new Error('Invalid Stripe signature header'), { status: 400 });
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) throw Object.assign(new Error('Stripe signature timestamp outside tolerance'), { status: 400 });
  const computed = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('Stripe signature verification failed'), { status: 400 });
}
async function recordBillingEvent(event) {
  const result = await supabaseRest('/rpc/record_billing_event_once', { method: 'POST', body: JSON.stringify({ event_id: event.id, event_type: event.type, event_payload: event }), prefer: 'return=representation' });
  if (typeof result === 'boolean') return result;
  if (Array.isArray(result)) return result[0] === true;
  return Boolean(result);
}
function stripeObjectId(value) { return typeof value === 'string' ? value : value && value.id; }
function stripeMetadataUserId(object) {
  return object && (object.client_reference_id || object.metadata && object.metadata.user_id || object.subscription_details && object.subscription_details.metadata && object.subscription_details.metadata.user_id);
}
async function getProfileForBillingObject(object) {
  const customerId = stripeObjectId(object && object.customer);
  if (customerId) {
    const profile = await getProfileByStripeCustomer(customerId);
    if (profile) return profile;
  }
  const subscriptionId = stripeObjectId(object && object.subscription);
  if (subscriptionId) {
    const profile = await getProfileBySubscription(subscriptionId);
    if (profile) return profile;
  }
  const userId = stripeMetadataUserId(object);
  return userId ? { id: userId } : null;
}
async function retrieveSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  return stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' });
}
async function retrieveCheckoutSession(sessionId) {
  if (!sessionId) return null;
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' });
}
function shouldRefreshBillingProfile(profile) {
  if (!profile || !profile.subscription_id) return false;
  const access = accessState(profile);
  if (access.canGenerate && access.source === 'subscription') return false;
  const status = String(profile.subscription_status || 'none').toLowerCase();
  return ['none', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'canceled'].includes(status) || !subscriptionWindowActive(profile);
}
async function refreshBillingProfile(profile) {
  if (!shouldRefreshBillingProfile(profile)) return profile;
  try {
    await handleSubscription(await retrieveSubscription(profile.subscription_id));
    const rows = await supabaseRest(`/profiles?id=eq.${encodeURIComponent(profile.id)}&select=*`, { method: 'GET', retries: ACCOUNT_RETRY_ATTEMPTS });
    return Array.isArray(rows) && rows[0] ? rows[0] : profile;
  } catch (error) {
    logServerError('Billing self-heal refresh failed', error);
    return profile;
  }
}
async function handleCheckoutCompleted(session) {
  const userId = stripeMetadataUserId(session);
  if (!userId) return;
  const patch = { stripe_customer_id: stripeObjectId(session.customer) || null };
  if (session.mode === 'subscription') {
    const subscriptionId = stripeObjectId(session.subscription);
    patch.subscription_id = subscriptionId || null;
    patch.subscription_status = 'active';
    await updateProfileByUserId(userId, patch);
    if (subscriptionId) {
      try { await handleSubscription(await retrieveSubscription(subscriptionId)); } catch (error) { logServerError('Subscription sync after checkout failed', error); }
    }
    return;
  }
  await updateProfileByUserId(userId, patch);
  if (session.mode === 'payment' && (!session.payment_status || session.payment_status === 'paid')) await grantCredit(userId, 1, session.id ? `checkout:${session.id}` : null, session);
}
async function handleSubscription(subscription) {
  if (!subscription) return;
  const profile = await getProfileForBillingObject(subscription);
  if (!profile) return;
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  await updateProfileByUserId(profile.id, { stripe_customer_id: stripeObjectId(subscription.customer) || undefined, subscription_id: subscription.id, subscription_status: subscription.status || 'none', subscription_current_period_end: periodEnd, cancel_at_period_end: Boolean(subscription.cancel_at_period_end) });
}
async function handleInvoice(invoice, fallbackStatus) {
  const subscriptionId = stripeObjectId(invoice && invoice.subscription);
  if (!subscriptionId) return;
  try {
    await handleSubscription(await retrieveSubscription(subscriptionId));
    return;
  } catch (error) {
    logServerError('Invoice subscription sync fallback', error);
  }
  const profile = await getProfileForBillingObject(invoice);
  if (!profile) return;
  await updateProfileByUserId(profile.id, { subscription_id: subscriptionId, subscription_status: fallbackStatus });
}
async function releaseBillingEvent(eventId) {
  if (!eventId) return;
  try {
    await supabaseRest(`/billing_events?id=eq.${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } catch (error) {
    logServerError('Billing event retry release failed', error);
  }
}
async function processStripeEvent(event) {
  const object = event.data && event.data.object;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') await handleCheckoutCompleted(object);
  if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') await handleSubscription(object);
  if (event.type === 'invoice.payment_succeeded') await handleInvoice(object, 'active');
  if (event.type === 'invoice.payment_failed' || event.type === 'invoice.payment_action_required') await handleInvoice(object, 'past_due');
}
async function handleStripeWebhook(req, res) {
  const raw = await readRawBody(req);
  verifyStripeSignature(raw, req.headers['stripe-signature']);
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (_) { throw Object.assign(new Error('Invalid Stripe event JSON'), { status: 400 }); }
  const firstSeen = await recordBillingEvent(event);
  if (!firstSeen) return send(res, 200, { received: true, duplicate: true });
  try {
    await processStripeEvent(event);
  } catch (error) {
    await releaseBillingEvent(event.id);
    throw error;
  }
  send(res, 200, { received: true });
}
function staticPath(pathname) {
  let clean = pathname === '/' ? '/index.html' : pathname;
  if (clean === '/app') clean = '/app.html';
  if (clean === '/login') clean = '/login.html';
  const decoded = decodeURIComponent(clean);
  const resolved = path.resolve(PUBLIC_DIR, `.${decoded}`);
  const allowedRoot = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${path.sep}`;
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(allowedRoot)) return null;
  return resolved;
}
async function serveStatic(req, res, pathname) {
  const filePath = staticPath(pathname);
  if (!filePath) return send(res, 403, 'Forbidden');
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, 'Not Found');
  const contentType = mimeTypes[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, securityHeaders(contentType));
  fs.createReadStream(filePath).pipe(res);
}
function inputForSystem(body) {
  return { goal_description: safeString(body.goal_description), required_user_input: ['goal_description'], derivation_rule: 'All technical fields are derived internally from goal_description. Missing details become open questions or validation requirements.' };
}
function inputForSchema(body) { return inputForSystem(body); }
function requireGoal(input) {
  const goal = input.goal_description || input.context && input.context.goal_description;
  if (!goal || goal.length < 8) throw Object.assign(new Error('Product description must be at least 8 characters'), { status: 400 });
}
async function generateHandler(req, res, type) {
  const startedAt = Date.now();
  const { user } = await verifyUser(req);
  const entitlement = await requireEntitlement(user);
  const body = await readJson(req);
  const input = type === 'system' ? inputForSystem(body) : inputForSchema(body);
  const title = titleFromInput(type, body);
  requireGoal(input);
  const result = await callDeepSeek({ mode: type, input });
  let saved;
  try {
    saved = await saveSpec(user.id, type, title, input, result, entitlement.source);
  } catch (error) {
    if (![500, 502, 503, 504].includes(Number(error.status || 0))) throw error;
    logServerError('Generated SPEX save fallback', error);
    const profile = await getProfile(user).catch(() => entitlement.profile);
    return send(res, 200, { saved: false, spec: { id: null, type, title, input, output: result.output, model: result.model, request_id: result.requestId, unsaved: true }, timing_ms: Date.now() - startedAt, entitlement: { source: entitlement.source, profile, access: accessState(profile) } });
  }
  const profile = await getProfile(user);
  send(res, 200, { saved: true, spec: saved, timing_ms: Date.now() - startedAt, entitlement: { source: entitlement.source, profile, access: accessState(profile) } });
}
async function listSpecs(req, res) {
  const { user } = await verifyUser(req);
  const rows = await supabaseRest(`/specs?user_id=eq.${encodeURIComponent(user.id)}&select=id,type,title,created_at,updated_at,model&order=created_at.desc`, { method: 'GET', retries: ACCOUNT_RETRY_ATTEMPTS });
  send(res, 200, { specs: rows });
}
async function getSpec(req, res, id) {
  const { user } = await verifyUser(req);
  const rows = await supabaseRest(`/specs?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`, { method: 'GET', retries: ACCOUNT_RETRY_ATTEMPTS });
  const spec = Array.isArray(rows) ? rows[0] : null;
  if (!spec) return send(res, 404, { error: 'SPEX not found' });
  send(res, 200, { spec });
}
async function updateSpec(req, res, id) {
  const { user } = await verifyUser(req);
  const body = await readJson(req);
  const title = safeString(body.title, 140);
  if (!title) throw Object.assign(new Error('Title is required'), { status: 400 });
  const rows = await supabaseRest(`/specs?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'PATCH', body: JSON.stringify({ title, updated_at: new Date().toISOString() }) });
  const spec = Array.isArray(rows) ? rows[0] : rows;
  if (!spec) return send(res, 404, { error: 'SPEX not found' });
  send(res, 200, { spec });
}
async function deleteSpec(req, res, id) {
  const { user } = await verifyUser(req);
  await supabaseRest(`/specs?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  send(res, 200, { deleted: true });
}
async function notifyDeveloperHandler(req, res) {
  const { user } = await verifyUser(req);
  const body = await readJson(req);
  const payload = {
    user_id: user.id,
    user_email: user.email ? '[redacted-email]' : null,
    title: safeString(body.title, 120),
    message: safeString(body.message, 500),
    path: safeString(body.path, 300),
    timestamp: safeString(body.timestamp, 80) || new Date().toISOString()
  };
  console.log('Developer notification', JSON.parse(redactLog(JSON.stringify(payload))));
  send(res, 200, { notified: true });
}
async function meHandler(req, res) {
  const { user } = await verifyUser(req);
  const profile = await refreshBillingProfile(await getProfile(user));
  send(res, 200, { user: { id: user.id, email: user.email }, profile, subscription_active: isSubscriptionActive(profile), access: accessState(profile) });
}
async function checkoutHandler(req, res) {
  const { user } = await verifyUser(req);
  const body = await readJson(req);
  const plan = body.plan === 'monthly' ? 'monthly' : body.plan === 'single' ? 'single' : null;
  if (!plan) throw Object.assign(new Error('Billing plan must be single or monthly'), { status: 400 });
  const profile = await getProfile(user);
  const session = await createCheckoutSession(user, profile, plan);
  send(res, 200, { url: session.url });
}
async function confirmCheckoutHandler(req, res) {
  const { user } = await verifyUser(req);
  const body = await readJson(req);
  const sessionId = safeString(body.session_id, 120);
  if (!/^cs_/.test(sessionId)) throw appError('Invalid checkout session', 400, 'invalid_checkout_session', 'Checkout could not be verified yet.');
  const session = await retrieveCheckoutSession(sessionId);
  const owner = stripeMetadataUserId(session);
  if (owner !== user.id) throw appError('Checkout session account mismatch', 403, 'checkout_account_mismatch', 'Checkout could not be verified for this account.');
  if (session.status && session.status !== 'complete' && session.payment_status !== 'paid') return send(res, 202, { pending: true, message: 'Checkout is still processing.' });
  await handleCheckoutCompleted(session);
  const profile = await refreshBillingProfile(await getProfile(user));
  send(res, 200, { confirmed: true, profile, access: accessState(profile) });
}
async function portalHandler(req, res) {
  const { user } = await verifyUser(req);
  const profile = await refreshBillingProfile(await getProfile(user));
  const session = await createBillingEntrySession(user, profile);
  send(res, 200, session);
}
async function route(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;
  if (req.method === 'GET' && pathname === '/api/health') return send(res, 200, { status: 'ok', config: configStatus() });
  if (req.method === 'POST' && pathname === '/api/stripe/webhook') return handleStripeWebhook(req, res);
  if (req.method === 'GET' && pathname === '/api/me') return meHandler(req, res);
  if (req.method === 'POST' && pathname === '/api/billing/checkout') return checkoutHandler(req, res);
  if (req.method === 'POST' && pathname === '/api/billing/portal') return portalHandler(req, res);
  if (req.method === 'POST' && pathname === '/api/billing/confirm') return confirmCheckoutHandler(req, res);
  if (req.method === 'POST' && pathname === '/api/support/notify') return notifyDeveloperHandler(req, res);
  if (req.method === 'POST' && pathname === '/api/generate/system') return generateHandler(req, res, 'system');
  if (req.method === 'POST' && pathname === '/api/generate/schema') return generateHandler(req, res, 'schema');
  if (req.method === 'GET' && pathname === '/api/specs') return listSpecs(req, res);
  const specMatch = pathname.match(/^\/api\/specs\/([0-9a-fA-F-]{36})$/);
  if (specMatch && req.method === 'GET') return getSpec(req, res, specMatch[1]);
  if (specMatch && req.method === 'PATCH') return updateSpec(req, res, specMatch[1]);
  if (specMatch && req.method === 'DELETE') return deleteSpec(req, res, specMatch[1]);
  if (pathname.startsWith('/api/')) return send(res, 404, { error: 'API route not found' });
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  send(res, 405, { error: 'Method not allowed' });
}
writePublicEnv();
const server = http.createServer(async (req, res) => {
  try { await route(req, res); } catch (error) {
    const status = error.status || 500;
    if (status >= 500) logServerError('Request failed', error);
    send(res, status, publicErrorPayload(error, status));
  }
});
server.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
server.headersTimeout = SERVER_REQUEST_TIMEOUT_MS + 5000;
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => console.log(`${publicEnv.APP_NAME} listening on ${port}`));
}
module.exports = { server, configStatus, verifyStripeSignature, accessState };
