import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const env = window.HD_ENV || {};
const supabase = createClient(env.SUPABASE_URL || 'https://missing.supabase.co', env.SUPABASE_ANON_KEY || 'missing');

let session = null;
let currentOutput = null;
let selectedSpecId = null;
let progressTimer = null;
let progressStartedAt = 0;

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
  goal: $('goal_description'),
  generateButton: $('generate-button'),
  progressPanel: $('progress-panel'),
  progressFill: $('progress-fill'),
  progressPercent: $('progress-percent'),
  progressStep: $('progress-step'),
  progressElapsed: $('progress-elapsed'),
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

const progressSteps = [
  { at: 0, pct: 6, label: 'Checking account access' },
  { at: 3, pct: 14, label: 'Preparing description' },
  { at: 8, pct: 24, label: 'Sending to DeepSeek reasoning' },
  { at: 18, pct: 38, label: 'Deriving architecture and modules' },
  { at: 35, pct: 54, label: 'Deriving data, API, UI, billing, and deploy logic' },
  { at: 60, pct: 72, label: 'Validating SPEX structure' },
  { at: 90, pct: 86, label: 'Waiting for final model response' },
  { at: 115, pct: 94, label: 'Finalizing saved SPEX' }
];

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('visible'), 4200);
}
function showStatus(title, message) {
  els.outputTitle.textContent = title;
  els.output.textContent = message;
  toast(title);
}
function setProgress(percent, label, elapsed) {
  if (!els.progressPanel) return;
  els.progressPanel.classList.remove('hidden');
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressStep.textContent = label;
  els.progressElapsed.textContent = `${elapsed}s elapsed`;
}
function beginProgress() {
  progressStartedAt = Date.now();
  clearInterval(progressTimer);
  setProgress(6, 'Checking account access', 0);
  progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - progressStartedAt) / 1000);
    const current = [...progressSteps].reverse().find((step) => seconds >= step.at) || progressSteps[0];
    const next = progressSteps.find((step) => step.at > current.at);
    let percent = current.pct;
    if (next) {
      const span = next.at - current.at;
      const offset = seconds - current.at;
      percent = current.pct + ((next.pct - current.pct) * Math.min(1, offset / span));
    }
    setProgress(percent, current.label, seconds);
    els.outputTitle.textContent = `Generating SPEX... ${seconds}s`;
    els.output.textContent = 'Reasoning is still running. The SPEX will appear here when the model returns and the database save completes.';
  }, 1000);
}
function completeProgress() {
  const elapsed = Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000));
  setProgress(100, 'SPEX generated and saved', elapsed);
  clearInterval(progressTimer);
  progressTimer = null;
}
function failProgress(label) {
  const elapsed = Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000));
  setProgress(100, label, elapsed);
  clearInterval(progressTimer);
  progressTimer = null;
}

async function requireSession() {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error('Sign-in is not connected.');
  const result = await supabase.auth.getSession();
  session = result.data.session;
  if (!session) window.location.href = '/login.html';
}
async function api(route, options = {}) {
  if (!session) await requireSession();
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 45000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, ...(options.headers || {}) };
    const response = await fetch(route, { ...options, headers, signal: controller.signal });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text || `Request failed: ${response.status}` }; }
    if (!response.ok) {
      const error = new Error(data.error || `Request failed: ${response.status}`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeout = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pretty(value) { return JSON.stringify(value, null, 2); }
function formatDate(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
function payload() { return { goal_description: els.goal.value.trim() }; }
function setBusy(isBusy) {
  els.generateButton.disabled = isBusy;
  els.generateButton.textContent = isBusy ? 'Generating SPEX...' : 'Generate SPEX';
}
function setButtonBusy(button, isBusy, text) {
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = isBusy;
  button.textContent = isBusy ? text : button.dataset.originalText;
}
function renderAccount(data) {
  const profile = data.profile || {};
  els.accountLabel.textContent = data.user && data.user.email ? data.user.email : 'Account';
  const active = Boolean(data.subscription_active);
  const credits = Number(profile.single_spec_credits || 0);
  els.planStatus.textContent = active ? 'Subscription active' : credits > 0 ? 'Generation credit available' : 'Payment required';
  els.creditStatus.textContent = active ? `Plan status: ${profile.subscription_status || 'active'}` : `${credits} generation credit${credits === 1 ? '' : 's'} available`;
}
async function loadAccount() { renderAccount(await api('/api/me', { method: 'GET' })); }
function renderSpecs(specs) {
  els.specList.innerHTML = '';
  if (!specs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted empty-state';
    empty.textContent = 'No saved SPEX yet.';
    els.specList.appendChild(empty);
    return;
  }
  specs.forEach((spec) => {
    const button = document.createElement('button');
    button.className = 'saved-item';
    button.type = 'button';
    button.dataset.id = spec.id;
    const title = document.createElement('strong');
    title.textContent = spec.title || 'Untitled SPEX';
    const meta = document.createElement('span');
    meta.textContent = `${spec.type || 'SPEX'} · ${formatDate(spec.created_at)}`;
    button.append(title, meta);
    button.addEventListener('click', () => loadSpec(spec.id));
    els.specList.appendChild(button);
  });
}
async function loadSpecs() { renderSpecs((await api('/api/specs', { method: 'GET' })).specs || []); }
async function loadSpec(id) {
  const spec = (await api(`/api/specs/${id}`, { method: 'GET' })).spec;
  selectedSpecId = spec.id;
  els.detailTitle.textContent = spec.title || 'Untitled SPEX';
  els.renameInput.value = spec.title || '';
  els.renameWrap.classList.remove('hidden');
  els.deleteSpec.classList.remove('hidden');
  els.detailOutput.textContent = pretty(spec.output || spec.content || spec);
}
async function generate(event) {
  event.preventDefault();
  const body = payload();
  if (!body.goal_description || body.goal_description.length < 8) return toast('Product description must be at least 8 characters.');
  setBusy(true);
  beginProgress();
  currentOutput = null;
  try {
    const data = await api('/api/generate/system', { method: 'POST', body: JSON.stringify(body), timeoutMs: 180000 });
    currentOutput = data.spec.output;
    completeProgress();
    els.outputTitle.textContent = data.timing_ms ? `Generated SPEX · ${Math.round(data.timing_ms / 1000)}s` : data.spec.title || 'Generated SPEX';
    els.output.textContent = pretty(currentOutput);
    toast('Generated and saved.');
    await loadAccount();
    await loadSpecs();
  } catch (error) {
    if (error.status === 402) { failProgress('Payment required'); showStatus('Payment required', 'Buy one SPEX or subscribe monthly to generate.'); }
    else if (error.status === 504) { failProgress('Generation timed out'); showStatus('Generation timed out', `${error.message} Try a shorter product description or run it again.`); }
    else { failProgress('Generation failed'); showStatus('Generation failed', error.message); }
  } finally {
    setBusy(false);
  }
}
async function startCheckout(plan, button) {
  setButtonBusy(button, true, 'Opening checkout...');
  try {
    const data = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }), timeoutMs: 30000 });
    if (!data.url) throw new Error('Stripe checkout did not return a URL.');
    window.location.href = data.url;
  } catch (error) {
    showStatus('Checkout failed', error.message);
    setButtonBusy(button, false);
  }
}
async function openPortal() {
  setButtonBusy(els.portal, true, 'Opening billing...');
  try {
    const data = await api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}), timeoutMs: 30000 });
    if (!data.url) throw new Error('Stripe billing portal did not return a URL.');
    window.location.href = data.url;
  } catch (error) {
    showStatus('Billing failed', error.message);
    setButtonBusy(els.portal, false);
  }
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
  els.detailTitle.textContent = 'Select a saved SPEX';
  els.detailOutput.textContent = '';
  els.renameWrap.classList.add('hidden');
  els.deleteSpec.classList.add('hidden');
  toast('Deleted.');
  await loadSpecs();
}
function downloadCurrent() {
  if (!currentOutput) return toast('No generated SPEX to download.');
  const blob = new Blob([pretty(currentOutput)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `bndr-spex-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function copyCurrent() {
  if (!currentOutput) return toast('No generated SPEX to copy.');
  await navigator.clipboard.writeText(pretty(currentOutput));
  toast('Copied.');
}
function applyPriceLabels() {
  els.buySingle.textContent = `Buy one SPEX · ${env.PRICE_SINGLE_DISPLAY || '$7'}`;
  els.buyMonthly.textContent = `Subscribe monthly · ${env.PRICE_MONTHLY_DISPLAY || '$9/mo'}`;
}
async function init() {
  applyPriceLabels();
  await requireSession();
  els.form.addEventListener('submit', generate);
  els.buySingle.addEventListener('click', () => startCheckout('single', els.buySingle));
  els.buyMonthly.addEventListener('click', () => startCheckout('monthly', els.buyMonthly));
  els.portal.addEventListener('click', openPortal);
  els.refresh.addEventListener('click', async () => { await loadAccount(); await loadSpecs(); toast('Refreshed.'); });
  els.deleteSpec.addEventListener('click', deleteSelected);
  els.renameInput.addEventListener('change', renameSelected);
  els.copyOutput.addEventListener('click', copyCurrent);
  els.downloadOutput.addEventListener('click', downloadCurrent);
  els.signout.addEventListener('click', async () => { await supabase.auth.signOut(); window.location.href = '/login.html'; });
  await loadAccount();
  await loadSpecs();
}
init().catch((error) => { showStatus('App failed to initialize', error.message); });
