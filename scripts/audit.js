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
  'scripts/smoke-test.js'
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

if (/holy-divine-saas/i.test(packageJson)) fail('package name is product-safe', 'old package name found'); else pass('package name is product-safe');
if (/tailwindcss|cdn\.tailwindcss/i.test(html)) fail('no Tailwind CDN', 'Tailwind CDN found'); else pass('no Tailwind CDN');
if (/localStorage|sessionStorage/.test(publicSource)) fail('no browser storage persistence', 'browser storage persistence found'); else pass('no browser storage persistence');

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
  ['single generation endpoint from app', /\/api\/generate\/system/],
  ['no schema tabs in app', !/tool-tabs|data-mode|schema-fields|system-fields/.test(appHtml + appJs)],
  ['real checkout buttons wired', /startCheckout\('single'\)/.test(appJs) && /startCheckout\('monthly'\)/.test(appJs)],
  ['saved SPEX wired', /\/api\/specs/.test(appJs) && /loadSpec/.test(appJs)],
  ['mobile styles present', /@media \(max-width: 760px\)/.test(styles) && /grid-template-columns: 1fr/.test(styles)]
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
  ['Merged SPEX prompt', /BNDR \| SPEX converts one plain-language product description/],
  ['One-description backend input', /required_user_input[\s\S]*goal_description/],
  ['Derived output keys', /deterministic_derivation_logic[\s\S]*payment_access_logic[\s\S]*final_schema/],
  ['No old meta tag', !/holy_divine_struct_v3\.4/.test(server)],
  ['Entitlement enforcement', /Payment required/],
  ['Saved specs routes', /\/api\/specs/],
  ['Static traversal guard', /allowedRoot/]
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
