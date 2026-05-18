import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const env = window.HD_ENV || {};
const supabase = createClient(env.SUPABASE_URL || 'https://missing.supabase.co', env.SUPABASE_ANON_KEY || 'missing');

let session = null;
let currentOutput = null;
let currentOutputType = 'system';
let currentMode = 'system';
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
  modeSystem: $('mode-system'),
  modeSchema: $('mode-schema'),
  modeDescription: $('mode-description'),
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
  billingModal: $('billing-modal'),
  billingTitle: $('billing-modal-title'),
  billingMessage: $('billing-modal-message'),
  billingPrimary: $('billing-modal-primary'),
  billingSecondary: $('billing-modal-secondary'),
  billingClose: $('billing-modal-close'),
  toast: $('toast')
};

const billingModalActions = { primary: null, secondary: null };

const outputModes = {
  system: {
    route: '/api/generate/system',
    outputLabel: 'SPEX',
    buttonLabel: 'Generate SPEX',
    busyLabel: 'Generating SPEX...',
    description: 'Full build-ready technical specification with architecture, modules, APIs, data flow, validation logic, deployment, and a final reusable schema.',
    placeholder: 'Describe the product, app, workflow, or system you want turned into a complete build-ready SPEX.'
  },
  schema: {
    route: '/api/generate/schema',
    outputLabel: 'Structured schema',
    buttonLabel: 'Generate Schema',
    busyLabel: 'Generating Schema...',
    description: 'Reusable structured schema output with clear fields, validation flags, and a model-ready meta tag.',
    placeholder: 'Describe the product, app, workflow, or system you want turned into a reusable structured schema.'
  }
};

const progressStepsByMode = {
  system: [
    { at: 0, pct: 6, label: 'Checking account access' },
    { at: 3, pct: 14, label: 'Preparing description' },
    { at: 8, pct: 24, label: 'Starting reasoning pass' },
    { at: 18, pct: 38, label: 'Deriving architecture and modules' },
    { at: 35, pct: 54, label: 'Deriving data, API, UI, billing, and deploy logic' },
    { at: 60, pct: 72, label: 'Validating SPEX structure' },
    { at: 90, pct: 86, label: 'Waiting for final model response' },
    { at: 115, pct: 94, label: 'Finalizing saved SPEX' }
  ],
  schema: [
    { at: 0, pct: 6, label: 'Checking account access' },
    { at: 3, pct: 14, label: 'Preparing description' },
    { at: 8, pct: 24, label: 'Starting schema derivation' },
    { at: 18, pct: 38, label: 'Deriving fields and validation notes' },
    { at: 35, pct: 54, label: 'Structuring reusable output format' },
    { at: 60, pct: 72, label: 'Validating schema keys' },
    { at: 90, pct: 86, label: 'Waiting for final model response' },
    { at: 115, pct: 94, label: 'Finalizing saved schema' }
  ]
};

function modeConfig(mode = currentMode) { return outputModes[mode] || outputModes.system; }

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
function cleanErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  const raw = error && error.data && error.data.error || error && error.message || '';
  const text = String(raw).trim();
  if (!text) return fallback;
  if (/(stripe|supabase|deepseek|provider|api route|api key|secret|token|not configured|request failed|http\s*\d|invalid json|failed to fetch)/i.test(text)) return fallback;
  if (text.length > 220) return fallback;
  return text;
}
function closeBillingModal() {
  if (!els.billingModal) return;
  els.billingModal.classList.add('hidden');
  billingModalActions.primary = null;
  billingModalActions.secondary = null;
}
function showBillingModal(title, message, options = {}) {
  if (!els.billingModal) return toast(title);
  els.billingTitle.textContent = title;
  els.billingMessage.textContent = message;
  els.billingPrimary.textContent = options.primaryLabel || 'Buy one SPEX';
  els.billingSecondary.textContent = options.secondaryLabel || 'Subscribe monthly';
  billingModalActions.primary = options.primaryAction || (() => startCheckout('single', els.buySingle));
  billingModalActions.secondary = options.secondaryAction || (() => startCheckout('monthly', els.buyMonthly));
  els.billingSecondary.classList.toggle('hidden', options.secondaryLabel === null);
  els.billingModal.classList.remove('hidden');
  toast(title);
}
function runBillingAction(action) {
  closeBillingModal();
  if (typeof action === 'function') action();
}
function safeRedirect(url, fallbackTitle = 'Link could not open') {
  const target = new URL(url, window.location.href);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error(fallbackTitle);
  window.location.assign(target.href);
}
async function safeRun(action, fallbackMessage) {
  try { return await action(); }
  catch (error) { toast(cleanErrorMessage(error, fallbackMessage)); return null; }
}
function setProgress(percent, label, elapsed) {
  if (!els.progressPanel) return;
  els.progressPanel.classList.remove('hidden');
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  els.progressPercent.textContent = `${Math.round(percent)}%`;
  els.progressStep.textContent = label;
  els.progressElapsed.textContent = `${elapsed}s elapsed`;
}
function beginProgress(mode = currentMode) {
  const config = modeConfig(mode);
  const steps = progressStepsByMode[mode] || progressStepsByMode.system;
  progressStartedAt = Date.now();
  clearInterval(progressTimer);
  setProgress(steps[0].pct, steps[0].label, 0);
  progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - progressStartedAt) / 1000);
    const current = [...steps].reverse().find((step) => seconds >= step.at) || steps[0];
    const next = steps.find((step) => step.at > current.at);
    let percent = current.pct;
    if (next) {
      const span = next.at - current.at;
      const offset = seconds - current.at;
      percent = current.pct + ((next.pct - current.pct) * Math.min(1, offset / span));
    }
    setProgress(percent, current.label, seconds);
    els.outputTitle.textContent = `Generating ${config.outputLabel}... ${seconds}s`;
    els.output.textContent = `Reasoning is still running. The ${config.outputLabel} will appear here when the model returns and the database save completes.`;
  }, 1000);
}
function completeProgress(mode = currentMode, saved = true) {
  const config = modeConfig(mode);
  const elapsed = Math.max(0, Math.floor((Date.now() - progressStartedAt) / 1000));
  setProgress(100, `${config.outputLabel} generated${saved ? ' and saved' : ''}`, elapsed);
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
function setMode(mode) {
  if (!outputModes[mode]) return;
  currentMode = mode;
  const isSchema = mode === 'schema';
  const config = modeConfig(mode);
  els.modeSystem.classList.toggle('active', !isSchema);
  els.modeSchema.classList.toggle('active', isSchema);
  els.modeSystem.setAttribute('aria-selected', String(!isSchema));
  els.modeSchema.setAttribute('aria-selected', String(isSchema));
  els.modeDescription.textContent = config.description;
  els.goal.placeholder = config.placeholder;
  els.generateButton.textContent = config.buttonLabel;
}
function setBusy(isBusy, mode = currentMode) {
  const config = modeConfig(mode);
  els.generateButton.disabled = isBusy;
  els.modeSystem.disabled = isBusy;
  els.modeSchema.disabled = isBusy;
  els.generateButton.textContent = isBusy ? config.busyLabel : modeConfig(currentMode).buttonLabel;
}
function setButtonBusy(button, isBusy, text) {
  if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
  button.disabled = isBusy;
  button.textContent = isBusy ? text : button.dataset.originalText;
}
function deriveAccess(profile, data = {}) {
  if (data.access && data.access.state) return data.access;
  const status = String(profile.subscription_status || 'none').toLowerCase();
  const credits = Number(profile.single_spec_credits || 0);
  const periodEnd = profile.subscription_current_period_end ? new Date(profile.subscription_current_period_end).getTime() : null;
  const periodActive = !periodEnd || periodEnd > Date.now();
  if (status === 'trialing' && periodActive) return { state: 'trial', canGenerate: true, credits };
  if (status === 'active' && periodActive) return { state: 'paid', canGenerate: true, credits };
  if (['past_due', 'unpaid', 'incomplete', 'incomplete_expired'].includes(status)) return { state: 'past_due', canGenerate: credits > 0, credits };
  if (credits > 0) return { state: 'credit', canGenerate: true, credits };
  return { state: 'expired', canGenerate: false, credits };
}
function creditPhrase(credits) {
  return `${credits} generation credit${credits === 1 ? '' : 's'}`;
}
function renderAccount(data) {
  const profile = data.profile || {};
  const credits = Number(profile.single_spec_credits || 0);
  const access = deriveAccess(profile, data);
  const labels = { paid: 'Paid', trial: 'Trial', credit: 'Credit', past_due: 'Past due', expired: 'Expired' };
  const status = String(profile.subscription_status || 'none').replace(/_/g, ' ');
  const details = {
    paid: `Subscription paid and active. ${creditPhrase(credits)} available.`,
    trial: `Trial access active. ${creditPhrase(credits)} available.`,
    credit: `${creditPhrase(credits)} available.`,
    past_due: credits > 0 ? `Payment past due. ${creditPhrase(credits)} still available.` : 'Payment past due. Update billing to continue.',
    expired: 'No active paid access. Buy one SPEX or subscribe monthly.'
  };
  els.accountLabel.textContent = data.user && data.user.email ? data.user.email : 'Account';
  els.planStatus.dataset.accessState = access.state;
  els.planStatus.textContent = labels[access.state] || 'Expired';
  els.creditStatus.textContent = `${details[access.state] || details.expired} Plan status: ${status}.`;
}
async function loadAccount() {
  const data = await api('/api/me', { method: 'GET' });
  renderAccount(data);
  return data;
}
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
    button.addEventListener('click', () => safeRun(() => loadSpec(spec.id), 'Saved SPEX could not open. Please try again.'));
    els.specList.appendChild(button);
  });
}
async function loadSpecs() {
  const data = await api('/api/specs', { method: 'GET' });
  renderSpecs(data.specs || []);
  return data;
}
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
  const mode = currentMode;
  const config = modeConfig(mode);
  setBusy(true, mode);
  beginProgress(mode);
  currentOutput = null;
  currentOutputType = mode;
  try {
    const data = await api(config.route, { method: 'POST', body: JSON.stringify(body), timeoutMs: 180000 });
    currentOutput = data.spec.output;
    completeProgress(mode, data.saved !== false);
    if (data.saved === false) {
      els.outputTitle.textContent = data.timing_ms ? `Generated ${config.outputLabel} · not saved · ${Math.round(data.timing_ms / 1000)}s` : `Generated ${config.outputLabel} · not saved`;
      toast('Generated. Download or copy it now.');
    } else {
      els.outputTitle.textContent = data.timing_ms ? `Generated ${config.outputLabel} · ${Math.round(data.timing_ms / 1000)}s` : data.spec.title || `Generated ${config.outputLabel}`;
      toast(`${config.outputLabel} generated and saved.`);
    }
    els.output.textContent = pretty(currentOutput);
    await safeRun(loadAccount, 'Account status could not refresh.');
    await safeRun(loadSpecs, 'Saved SPEX could not refresh.');
  } catch (error) {
    if (error.status === 402) {
      failProgress('Payment required');
      showBillingModal('Payment required', cleanErrorMessage(error, 'Buy one SPEX or subscribe monthly to generate.'), {
        primaryLabel: 'Buy one SPEX',
        primaryAction: () => startCheckout('single', els.buySingle),
        secondaryLabel: 'Subscribe monthly',
        secondaryAction: () => startCheckout('monthly', els.buyMonthly)
      });
    }
    else if (error.status === 504) { failProgress('Generation timed out'); showStatus('Generation timed out', cleanErrorMessage(error, 'Generation is taking too long. Try a shorter product description or run it again.')); }
    else { failProgress('Generation failed'); showStatus('Generation failed', cleanErrorMessage(error, 'Generation could not finish. Please try again.')); }
  } finally {
    setBusy(false);
  }
}
async function startCheckout(plan, button) {
  setButtonBusy(button, true, 'Opening checkout...');
  try {
    const data = await api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }), timeoutMs: 30000 });
    if (!data.url) throw new Error('Checkout did not return a recovery link.');
    safeRedirect(data.url, 'Checkout could not open');
  } catch (error) {
    setButtonBusy(button, false);
    showBillingModal('Checkout could not open', cleanErrorMessage(error, 'Checkout could not open. Please try again.'), {
      primaryLabel: 'Try again',
      primaryAction: () => startCheckout(plan, button),
      secondaryLabel: plan === 'single' ? 'Subscribe monthly' : 'Buy one SPEX',
      secondaryAction: () => plan === 'single' ? startCheckout('monthly', els.buyMonthly) : startCheckout('single', els.buySingle)
    });
  }
}
async function openPortal() {
  setButtonBusy(els.portal, true, 'Opening billing...');
  try {
    const data = await api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}), timeoutMs: 30000 });
    if (!data.url) throw new Error('Billing did not return a recovery link.');
    if (data.mode === 'checkout') toast('Opening checkout to recover billing.');
    safeRedirect(data.url, 'Billing could not open');
  } catch (error) {
    setButtonBusy(els.portal, false);
    showBillingModal('Billing could not open', cleanErrorMessage(error, 'Billing could not open. Please try again.'), {
      primaryLabel: 'Open subscription checkout',
      primaryAction: () => startCheckout('monthly', els.buyMonthly),
      secondaryLabel: 'Buy one SPEX',
      secondaryAction: () => startCheckout('single', els.buySingle)
    });
  }
}
async function renameSelected() {
  if (!selectedSpecId) return;
  const title = els.renameInput.value.trim();
  if (!title) return toast('Title is required.');
  await safeRun(async () => {
    await api(`/api/specs/${selectedSpecId}`, { method: 'PATCH', body: JSON.stringify({ title }) });
    toast('Renamed.');
    await safeRun(loadSpecs, 'Saved SPEX could not refresh.');
    await loadSpec(selectedSpecId);
  }, 'Rename could not be saved. Please try again.');
}
async function deleteSelected() {
  if (!selectedSpecId) return;
  await safeRun(async () => {
    await api(`/api/specs/${selectedSpecId}`, { method: 'DELETE' });
    selectedSpecId = null;
    els.detailTitle.textContent = 'Select a saved SPEX';
    els.detailOutput.textContent = '';
    els.renameWrap.classList.add('hidden');
    els.deleteSpec.classList.add('hidden');
    toast('Deleted.');
    await safeRun(loadSpecs, 'Saved SPEX could not refresh.');
  }, 'Delete could not finish. Please try again.');
}
function downloadCurrent() {
  if (!currentOutput) return toast('No generated output to download.');
  try {
    const blob = new Blob([pretty(currentOutput)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `bndr-spex-${currentOutputType || 'output'}-${Date.now()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  } catch (_) {
    toast('Download could not start. Copy the SPEX instead.');
  }
}
async function copyCurrent() {
  if (!currentOutput) return toast('No generated output to copy.');
  try {
    await navigator.clipboard.writeText(pretty(currentOutput));
    toast('Copied.');
  } catch (_) {
    downloadCurrent();
    toast('Clipboard unavailable. Download started.');
  }
}
function applyPriceLabels() {
  els.buySingle.textContent = `Buy one SPEX · ${env.PRICE_SINGLE_DISPLAY || '$7'}`;
  els.buyMonthly.textContent = `Subscribe monthly · ${env.PRICE_MONTHLY_DISPLAY || '$9/mo'}`;
}
function clearCheckoutParams() {
  const clean = `${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, clean);
}
async function recoverCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get('checkout');
  const sessionId = params.get('session_id');
  if (checkout === 'cancelled') {
    toast('Checkout cancelled.');
    clearCheckoutParams();
    return;
  }
  if (checkout !== 'success' || !sessionId) return;
  toast('Confirming billing...');
  try {
    const data = await api('/api/billing/confirm', { method: 'POST', body: JSON.stringify({ session_id: sessionId }), timeoutMs: 30000 });
    if (data.profile) renderAccount({ user: session && session.user, profile: data.profile, access: data.access });
    toast(data.pending ? 'Checkout is still processing. Billing will refresh shortly.' : 'Billing updated.');
    clearCheckoutParams();
  } catch (error) {
    showBillingModal('Billing is still catching up', cleanErrorMessage(error, 'Checkout finished. Billing will refresh shortly.'), {
      primaryLabel: 'Refresh account',
      primaryAction: () => safeRun(loadAccount, 'Account status could not refresh.'),
      secondaryLabel: 'Open billing',
      secondaryAction: openPortal
    });
  }
}
async function init() {
  applyPriceLabels();
  setMode('system');
  await requireSession();
  els.form.addEventListener('submit', generate);
  els.modeSystem.addEventListener('click', () => setMode('system'));
  els.modeSchema.addEventListener('click', () => setMode('schema'));
  els.buySingle.addEventListener('click', () => startCheckout('single', els.buySingle));
  els.buyMonthly.addEventListener('click', () => startCheckout('monthly', els.buyMonthly));
  els.portal.addEventListener('click', openPortal);
  els.billingClose.addEventListener('click', closeBillingModal);
  els.billingPrimary.addEventListener('click', () => runBillingAction(billingModalActions.primary));
  els.billingSecondary.addEventListener('click', () => runBillingAction(billingModalActions.secondary));
  els.billingModal.addEventListener('click', (event) => { if (event.target === els.billingModal) closeBillingModal(); });
  els.refresh.addEventListener('click', async () => {
    await safeRun(loadAccount, 'Account status could not refresh.');
    await safeRun(loadSpecs, 'Saved SPEX could not refresh.');
    toast('Refreshed.');
  });
  els.deleteSpec.addEventListener('click', deleteSelected);
  els.renameInput.addEventListener('change', renameSelected);
  els.copyOutput.addEventListener('click', copyCurrent);
  els.downloadOutput.addEventListener('click', downloadCurrent);
  els.signout.addEventListener('click', async () => {
    await safeRun(() => supabase.auth.signOut(), 'Sign out could not finish cleanly.');
    window.location.href = '/login.html';
  });
  await recoverCheckoutReturn();
  await safeRun(loadAccount, 'Account status could not load.');
  await safeRun(loadSpecs, 'Saved SPEX could not load.');
}
init().catch((error) => { showStatus('App failed to initialize', cleanErrorMessage(error, 'The app could not start. Refresh and sign in again.')); });
