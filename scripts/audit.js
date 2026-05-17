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
function has(file, pattern) { return pattern.test(read(file)); }

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(root, file))) pass(`exists: ${file}`);
  else fail(`exists: ${file}`, 'missing');
}

const server = read('server.js');
const sql = read('db/supabase.sql');
const html = ['public/index.html', 'public/login.html', 'public/app.html'].map(read).join('\n');
const publicSource = ['public/index.html', 'public/login.html', 'public/app.html', 'public/app.js', 'public/styles.css'].map(read).join('\n');

if (/tailwindcss|cdn\.tailwindcss/i.test(html)) fail('no Tailwind CDN', 'Tailwind CDN found'); else pass('no Tailwind CDN');
if (/localStorage|sessionStorage/.test(publicSource)) fail('no browser storage persistence', 'browser storage persistence found'); else pass('no browser storage persistence');
const blockedMarkers = ['TO' + 'DO', 'ST' + 'UB', 'MO' + 'CK', 'SIM' + 'ULATION', 'PLACE' + 'HOLDER'];
const runtimeUpper = (server + publicSource).toUpperCase();
const foundMarkers = blockedMarkers.filter((marker) => runtimeUpper.includes(marker));
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

const serverChecks = [
  ['Stripe webhook route', /\/api\/stripe\/webhook/],
  ['Stripe signature verification', /timingSafeEqual/],
  ['Stripe Checkout route', /\/api\/billing\/checkout/],
  ['Stripe Billing Portal route', /\/api\/billing\/portal/],
  ['Supabase user verification', /\/auth\/v1\/user/],
  ['Supabase service role REST', /SUPABASE_SERVICE_ROLE_KEY/],
  ['DeepSeek JSON output', /response_format[\s\S]*json_object/],
  ['System spec schema keys', /system_overview[\s\S]*validation_logic/],
  ['Schema generator keys', /structured_schema[\s\S]*validation_flags[\s\S]*meta_tag/],
  ['Entitlement enforcement', /Payment required/],
  ['Saved specs routes', /\/api\/specs/],
  ['Static traversal guard', /allowedRoot/]
];
for (const [name, pattern] of serverChecks) {
  if (pattern.test(server)) pass(name); else fail(name, 'missing source pattern');
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

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
}
if (failed.length) {
  process.exitCode = 1;
} else {
  console.log(`AUDIT_PASS ${checks.length} checks`);
}
