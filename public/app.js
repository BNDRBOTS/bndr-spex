import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const env = window.HD_ENV || {};
const supabase = createClient(env.SUPABASE_URL || 'https://missing.supabase.co', env.SUPABASE_ANON_KEY || 'missing');

let session = null;
let mode = 'system';
let currentOutput = null;
let selectedSpecId = null;

const $ = (id) => document.getElementById(id);
const els = {
  accountLabel: $('account-label'),
  planStatus: $('plan-status'),
  creditStatus: $('credit-status'),
  buySingle: $('buy-single'),
  buyMonthly: $('buy-monthly'),
  portal: $('portal'),
  signout: $('signout'),
  refresh: $('refresh'),
  specList: $('spec-list'),
  form: $('generate-form'),
  modeEyebrow: $('mode-eyebrow'),
  modeTitle: $('mode-title'),
  systemFields: $('system-fields'),
  schemaFields: $('schema-fields'),
  output: $('output'),
  outputTitle: $('output-title'),
  copyOutput: $('copy-output'),
  downloadOutput: $('download-output'),
  detailTitle: $('detail-title'),
  detailOutput: $('detail-output'),
  deleteSpec: $('delete-spec'),
  renameWrap: $('rename-wrap'),
  renameInput: $('rename-input'),
  toast: $('toast')
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 3200);
}

async function requireSession() {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase public configuration missing. Set SUPABASE_URL and SUPABASE_ANON_KEY on Railway.');
  }
  const result = await supabase.auth.getSession();
  session = result.data.session;
  if (!session) window.location.href = '/login.html';
}

async function api(path, options = {}) {
  if (!session) await requireSession();
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function setMode(nextMode) {
  mode = nextMode;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
  const isSystem = mode === 'system';
  els.systemFields.classList.toggle('hidden', !isSystem);
  els.schemaFields.classList.toggle('hidden', isSystem);
  els.modeEyebrow.textContent = isSystem ? 'Implementation-grade spec generator' : 'Prompt-safe schema generator';
  els.modeTitle.textContent = isSystem ? 'Generate full system specification.' : 'Generate HOLY DIVINE JSON-L schema.';
}

function payload() {
  const goal = $('goal_description').value.trim();
  if (mode === 'system') {
    return {
      goal_description: goal,
      runtime_model: $('runtime_model').value.trim(),
      system_scope: $('system_scope').value.trim(),
      target_platforms: $('target_platforms').value.trim(),
      constraints: $('constraints').value.trim(),
      dependencies: $('dependencies').value.trim(),
      design_requirements: $('design_requirements').value.trim(),
      data_requirements: $('data_requirements').value.trim()
    };
  }
  return {
    goal_description: goal,
    runtime_model: $('schema_runtime_model').value.trim(),
    constraints: $('schema_constraints').value.trim(),
    dependencies: $('schema_dependencies').value.trim()
  };
}

function renderAccount(data) {
  const profile = data.profile || {};
  els.accountLabel.textContent = data.user && data.user.email ? data.user.email : '';
  const active = Boolean(data.subscription_active);
  const credits = Number(profile.single_spec_credits || 0);
  els.planStatus.textContent = active ? 'Subscription active' : credits > 0 ? 'Generation credit available' : 'Payment required';
  els.creditStatus.textContent = active ? `Stripe status: ${profile.subscription_status || 'active'}` : `${credits} one-off credit${credits === 1 ? '' : 's'} available`;
}

async function loadAccount() {
  const data = await api('/api/me', { method: 'GET' });
  renderAccount(data);
}

function renderSpecs(specs) {
  els.specList.innerHTML = '';
  if (!specs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No saved specs yet.';
    els.specList.appendChild(empty);
    return;
  }
  specs.forEach((spec) => {
    const button = document.createElement('button');
    button.className = 'saved-item';
    button.dataset.id = spec.id;
    const title = document.createElement('strong');
    title.textContent = spec.title || 'Untitled spec';
    const meta = document.createElement('span');
    meta.textContent = `${spec.type} · ${formatDate(spec.created_at)}`;
    button.append(title, meta);
    button.addEventListener('click', () => loadSpec(spec.id));
    els.specList.appendChild(button);
  });
}

async function loadSpecs() {
  const data = await api('/api/specs', { method: 'GET' });
  renderSpecs(data.specs || []);
}

async function loadSpec(id) {
  const data = await api(`/api/specs/${id}`, { method: 'GET' });
  const spec = data.spec;
  selectedSpecId = spec.id;
  els.detailTitle.textContent = spec.title || 'Untitled spec';
  els.renameInput.value = spec.title || '';
  els.renameWrap.classList.remove('hidden');
  els.deleteSpec.classList.remove('hidden');
  els.detailOutput.textContent = pretty(spec.output || spec.content || spec);
}

async function generate(event) {
  event.preventDefault();
  const endpoint = mode === 'system' ? '/api/generate/system' : '/api/generate/schema';
  els.outputTitle.textContent = 'Generating...';
  els.output.textContent = '';
  currentOutput = null;
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(payload()) });
    currentOutput = data.spec.output;
    els.outputTitle.textContent = data.spec.title || 'Generated output';
    els.output.textContent = pretty(currentOutput);
    toast('Generated and saved.');
    await loadAccount();
    await loadSpecs();
  } catch (error) {
    if (error.status === 402) {
      els.outputTitle.textContent = 'Payment required';
      els.output.textContent = 'Buy one generation credit or start the monthly subscription to generate.';
    } else {
      els.outputTitle.textContent = 'Generation failed';
      els.output.textContent = error.message;
    }
  }
}

async function startCheckout(plan) {
  const data = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
  window.location.href = data.url;
}

async function openPortal() {
  const data = await api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}) });
  window.location.href = data.url;
}

async function renameSelected() {
  if (!selectedSpecId) return;
  const title = els.renameInput.value.trim();
  if (!title) return toast('Title is required.');
  await api(`/api/specs/${selectedSpecId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
  toast('Renamed.');
  await loadSpecs();
  await loadSpec(selectedSpecId);
}

async function deleteSelected() {
  if (!selectedSpecId) return;
  await api(`/api/specs/${selectedSpecId}`, { method: 'DELETE' });
  selectedSpecId = null;
  els.detailTitle.textContent = 'Select a saved spec';
  els.detailOutput.textContent = '';
  els.renameWrap.classList.add('hidden');
  els.deleteSpec.classList.add('hidden');
  toast('Deleted.');
  await loadSpecs();
}

function downloadCurrent() {
  if (!currentOutput) return toast('No generated output to download.');
  const blob = new Blob([pretty(currentOutput)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${mode}-spec-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function copyCurrent() {
  if (!currentOutput) return toast('No generated output to copy.');
  await navigator.clipboard.writeText(pretty(currentOutput));
  toast('Copied.');
}

function applyPriceLabels() {
  els.buySingle.textContent = `Buy one spec · ${env.PRICE_SINGLE_DISPLAY || '$7'}`;
  els.buyMonthly.textContent = `Subscribe · ${env.PRICE_MONTHLY_DISPLAY || '$9/mo'}`;
}

async function init() {
  applyPriceLabels();
  await requireSession();
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
  els.form.addEventListener('submit', generate);
  els.buySingle.addEventListener('click', () => startCheckout('single'));
  els.buyMonthly.addEventListener('click', () => startCheckout('monthly'));
  els.portal.addEventListener('click', openPortal);
  els.refresh.addEventListener('click', async () => { await loadAccount(); await loadSpecs(); toast('Refreshed.'); });
  els.deleteSpec.addEventListener('click', deleteSelected);
  els.renameInput.addEventListener('change', renameSelected);
  els.copyOutput.addEventListener('click', copyCurrent);
  els.downloadOutput.addEventListener('click', downloadCurrent);
  els.signout.addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = '/login.html'; });
  setMode('system');
  await loadAccount();
  await loadSpecs();
}

init().catch((error) => {
  els.outputTitle.textContent = 'App failed to initialize';
  els.output.textContent = error.message;
});
