const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const requiredFiles = [
  'server.js',
  'package.json',
  'railway.json',
  'README.md',
  'db/supabase.sql',
  'public/index.html',
  'public/login.html',
  'public/app.html',
  'public/app.js',
  'public/styles.css',
  'scripts/smoke-test.js',
  'scripts/full-path-test.js'
];

const checks = [];
function pass(name) { checks.push({ name, ok: true }); }
function fail(name, detail) { checks.push({ name, ok: false, detail }); }
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8'); }

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(root, file))) pass(`exists: ${file}`);
  else fail(`exists: ${file}`, 'missing');
}

const server = read('server.js');
const sql = read('db/supabase.sql');
const appHtml = read('public/app.html');
const appJs = read('public/app.js');
const styles = read('public/styles.css');
const packageJson = read('package.json');
const html = ['public/index.html', 'public/login.html', 'public/app.html'].map(read).join('\n');
const publicSource = ['public/index.html', 'public/login.html', 'public/app.html', 'public/app.js', 'public/styles.css'].map(read).join('\n');
const projectSource = requiredFiles.map((file) => fs.existsSync(path.join(root, file)) ? read(file) : '').join('\n');

if (/holy-divine-saas/i.test(packageJson)) fail('package name is product-safe', 'old package name found'); else pass('package name is product-safe');
if (/tailwindcss|cdn\.tailwindcss/i.test(html)) fail('no Tailwind CDN', 'Tailwind CDN found'); else pass('no Tailwind CDN');
if (/localStorage|sessionStorage/.test(publicSource)) fail('no browser storage persistence', 'browser storage persistence found'); else pass('no browser storage persistence');

const chars = (...codes) => codes.map((code) => String.fromCharCode(code)).join('');
const personalMarkers = [
  new RegExp(chars(115, 99, 111, 116, 116), 'i'),
  new RegExp(`p\\s*${chars(115, 99, 111, 116, 116)}`, 'i'),
  new RegExp(chars(98, 101, 110, 100, 101, 114), 'i'),
  new RegExp(`${chars(103, 109, 97, 105, 108)}\\.com`, 'i')
];
const foundPersonalMarkers = personalMarkers.filter((pattern) => pattern.test(projectSource)).map(String);
if (foundPersonalMarkers.length) fail('no personal owner identifiers', foundPersonalMarkers.join(', ')); else pass('no personal owner identifiers');

const blockedMarkers = [/\bTO\s*DO\b/i, /\bSTUB\b/i, /\bMOCK\b/i, /\bSIMULATION\b/i];
const foundMarkers = blockedMarkers.filter((pattern) => pattern.test(server + publicSource)).map(String);
if (foundMarkers.length) fail('no unfinished markers in runtime source', foundMarkers.join(', ')); else pass('no unfinished markers in runtime source');

const envBlock = server.match(/const publicEnv = \{[\s\S]*?\};/);
if (!envBlock) fail('public env block exists', 'missing');
else {
  const block = envBlock[0];
  const forbidden = ['SUPABASE_SERVICE_ROLE_KEY', 'DEEPSEEK_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  const leaked = forbidden.filter((key) => block.includes(key));
  if (leaked.length) fail('public env excludes server secrets', leaked.join(', '));
  else pass('public env excludes server secrets');
}

const forbiddenCustomerFields = [
  'Runtime model',
  'System scope',
  'Target platforms',
  'Constraints',
  'Dependencies',
  'Design requirements',
  'Data requirements'
];
const leakedFields = forbiddenCustomerFields.filter((field) => appHtml.includes(field));
if (leakedFields.length) fail('customer UI has no required technical fields', leakedFields.join(', ')); else pass('customer UI has no required technical fields');

const appChecks = [
  ['one required product field', /id="goal_description"[\s\S]*required/],
  ['generation endpoints from app', /\/api\/generate\/system/.test(appJs) && /\/api\/generate\/schema/.test(appJs)],
  ['schema mode wired in app', /id="mode-schema"/.test(appHtml) && /setMode\('schema'\)/.test(appJs) && /outputModes[\s\S]*schema[\s\S]*\/api\/generate\/schema/.test(appJs)],
  ['real checkout buttons wired', /startCheckout\('single'/.test(appJs) && /startCheckout\('monthly'/.test(appJs)],
  ['saved SPEX wired', /\/api\/specs/.test(appJs) && /loadSpec/.test(appJs)],
  ['mobile styles present', /@media \(max-width: 720px\)/.test(styles) && /grid-template-columns: 1fr/.test(styles)],
  ['billing modal wired', /billing-modal/.test(appHtml) && /showBillingModal/.test(appJs)],
  ['truthful access labels', /paid[\s\S]*trial[\s\S]*credit[\s\S]*past_due[\s\S]*expired/.test(appJs)],
  ['customer action fallbacks', /safeRun[\s\S]*safeRedirect[\s\S]*Clipboard unavailable/.test(appJs)],
  ['checkout return recovery', /recoverCheckoutReturn[\s\S]*\/api\/billing\/confirm/.test(appJs)],
  ['unsaved generation fallback shown', /data\.saved === false[\s\S]*Download or copy/.test(appJs)],
  ['login errors sanitized', /cleanAuthMessage[\s\S]*Email or password is incorrect/.test(html)]
];
for (const [name, condition] of appChecks) {
  if (condition === true || condition instanceof RegExp && condition.test(appHtml + appJs + styles)) pass(name);
  else fail(name, 'missing or false');
}

const serverChecks = [
  ['Stripe webhook route', /\/api\/stripe\/webhook/],
  ['Stripe signature verification', /timingSafeEqual/],
  ['Stripe Checkout route', /\/api\/billing\/checkout/],
  ['Stripe Billing Portal route', /\/api\/billing\/portal/],
  ['Supabase user verification', /\/auth\/v1\/user/],
  ['Supabase service role REST', /SUPABASE_SERVICE_ROLE_KEY/],
  ['DeepSeek JSON output', /response_format[\s\S]*json_object/],
  ['Structured schema route', /\/api\/generate\/schema[\s\S]*generateHandler\(req, res, 'schema'\)/],
  ['Structured schema validation', /schemaKeys[\s\S]*structured_schema[\s\S]*validation_flags[\s\S]*meta_tag[\s\S]*Structured schema failed validation/],
  ['Merged SPEX prompt', /BNDR \| SPEX converts one plain-language product description/],
  ['One-description backend input', /required_user_input[\s\S]*goal_description/],
  ['Derived output keys', /deterministic_derivation_logic[\s\S]*payment_access_logic[\s\S]*final_schema/],
  ['No old meta tag', !/holy_divine_struct_v3\.4/.test(server)],
  ['Entitlement enforcement', /Payment required/],
  ['Saved specs routes', /\/api\/specs/],
  ['Static traversal guard', /allowedRoot/],
  ['Billing portal fallback', /createBillingEntrySession[\s\S]*mode: 'checkout'/],
  ['Checkout confirm recovery route', /confirmCheckoutHandler[\s\S]*\/api\/billing\/confirm/],
  ['Stripe idempotency keys', /Idempotency-Key[\s\S]*stripeIdempotencyKey/],
  ['Billing status self-heal', /refreshBillingProfile[\s\S]*retrieveSubscription/],
  ['Webhook retry release', /releaseBillingEvent[\s\S]*billing_events/],
  ['Transient outbound retry', /retryAttemptsForService[\s\S]*isRetryableError/],
  ['Public error sanitization', /publicErrorPayload[\s\S]*Something went wrong/],
  ['Server request timeouts', /requestTimeout[\s\S]*SERVER_REQUEST_TIMEOUT_MS/],
  ['Server log redaction', /redactLog[\s\S]*redacted-email[\s\S]*redacted-stripe-key/]
];
for (const [name, condition] of serverChecks) {
  if (condition === true || condition instanceof RegExp && condition.test(server)) pass(name);
  else fail(name, 'missing source pattern');
}

const sqlChecks = [
  ['profiles table', /create table if not exists public\.profiles/],
  ['specs table', /create table if not exists public\.specs/],
  ['billing_events table', /create table if not exists public\.billing_events/],
  ['RLS profiles', /alter table public\.profiles enable row level security/],
  ['RLS specs', /alter table public\.specs enable row level security/],
  ['auth trigger', /on_auth_user_created/],
  ['grant credits RPC', /function public\.grant_spec_credits/],
  ['idempotent checkout credit RPC', /function public\.grant_spec_credit_once/],
  ['atomic credit save RPC', /function public\.save_spec_with_credit/],
  ['billing idempotency RPC', /function public\.record_billing_event_once/],
  ['service role grants', /grant execute[\s\S]*to service_role/]
];
for (const [name, pattern] of sqlChecks) {
  if (pattern.test(sql)) pass(name); else fail(name, 'missing SQL pattern');
}

for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}
const failed = checks.filter((check) => !check.ok);
if (failed.length) process.exitCode = 1;
else console.log(`AUDIT_PASS ${checks.length} checks`);
