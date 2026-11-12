/* ==========================================================================
   AgentGuard — web demo (NEAR testnet)
   Static page, no build step. ES module; near-api-js v7 is loaded with a
   dynamic import from the jsDelivr ESM bundle (same major version as the
   CLI demo lane). If the CDN fails, view calls fall back to plain fetch()
   JSON-RPC and the recorded scenarios still work — only wallet signing
   needs near-api-js.

   Wallet sign-in: near-api-js v7 removed WalletConnection / connect() /
   keyStores, so this page implements the same wallet-login redirect
   protocol WalletConnection used, with v7 primitives: a fresh
   KeyPair.fromRandom() function-call key is stored in localStorage, the
   user approves it in MyNearWallet, and signing uses
   `new Account(accountId, provider, secretKey)`. The key is scoped by the
   wallet to spend/pause/unpause on this contract only.

   NO keys, NO seed phrases, NO secrets are hard-coded anywhere in this
   file. Signing happens with the wallet-approved function-call key.
   ========================================================================== */

/* ---------------- CONFIG — change these after deployment ---------------- */
const CONFIG = {
  // Contract account. Confirmed against the coordinator update 12 Nov 2026
  // (agentguard.testnet belongs to someone else); re-confirm against
  // contract/DEPLOY.md once it exists.
  CONTRACT_ID: 'guard.agentguard-adt.testnet',
  NETWORK_ID: 'testnet',

  // RPC endpoints, tried in order. Primary is the official testnet RPC;
  // FastNear is the fallback (docs.near.org's default testnet endpoint).
  RPC_URLS: [
    'https://rpc.testnet.near.org',
    'https://test.rpc.fastnear.com',
  ],

  // MyNearWallet (testnet). wallet.testnet.near.org redirects to it.
  WALLET_URL: 'https://wallet.testnet.near.org',
  EXPLORER_URL: 'https://explorer.testnet.near.org',

  // near-api-js v7 ESM bundle (same version as the CLI demo: 7.5.3).
  // Verified: HTTP 200 + jsDelivr Rollup bundle of
  // /npm/near-api-js@7.5.3/lib/index.js (12 Nov 2026).
  NAJ_CDN_URL: 'https://cdn.jsdelivr.net/npm/near-api-js@7.5.3/+esm',
  NAJ_LOAD_TIMEOUT_MS: 15000,

  // Demo merchant (allowlisted) and a non-allowlisted stranger account.
  SHOP_ACCOUNT: 'shop.agentguard-adt.testnet',
  STRANGER_ACCOUNT: 'stranger.testnet',

  // Gas for spend/pause calls (30 TGas) and attached deposit (0 — the vault
  // pays out of its own balance; spend() needs no deposit).
  GAS: 30n * 10n ** 12n,
  DEPOSIT: 0n,

  // Pause method names — CONFIRMED from contract/src/lib.rs
  // (owner-only `pause()` / `unpause()`, no args).
  PAUSE_METHOD: 'pause',
  UNPAUSE_METHOD: 'unpause',

  // How many log entries to fetch per refresh.
  LOG_LIMIT: 20,

  // get_log() returns MOST RECENT FIRST (confirmed from contract/src/lib.rs:
  // `.rev().take(limit)`), so the UI displays entries as returned.
  LOG_NEWEST_FIRST: true,

  REFRESH_MS: 10000,
};

/* Demo values shown while the contract is not deployed yet (clearly marked
   as placeholders in the UI). From the hackathon spec: max 1 NEAR/tx,
   daily limit 5 NEAR, allowlist = shop + agentguard-adt.testnet. */
const DEMO_POLICY = {
  max_per_tx: '1000000000000000000000000', // 1 NEAR
  daily_limit: '5000000000000000000000000', // 5 NEAR
  allowlist: ['shop.agentguard-adt.testnet', 'agentguard-adt.testnet'],
  paused: false,
};
const DEMO_STATUS = {
  owner: 'agentguard-adt.testnet',
  agent: 'agent.agentguard-adt.testnet',
  balance: '0',
  paused: false,
  spent_today: '0',
  remaining_today: '5000000000000000000000000', // 5 NEAR
  day: 0,
};

/* Recorded outcomes from real testnet runs, shown when no wallet is
   connected. PLACEHOLDERS until the contract is deployed and the runs are
   recorded — fill in txHash / reason / amount from contract/DEPLOY.md.
   status: 'pending' | 'recorded'. */
const RECORDED_RUNS = {
  stranger: {
    scenario: 'Agent pays 5 NEAR to a stranger',
    expected: 'BLOCKED',
    status: 'recorded',
    txHash: 'HGUmgKHi6V5AezqCxULjuL9G4BEsLxCxXWYKh2fbv3np',
    reason: 'over_max_per_tx',
    detail: 'Over max_per_tx (5 NEAR > 1 NEAR) and receiver not allowlisted — contract returns over_max_per_tx (cap is checked before the allowlist).',
  },
  shop: {
    scenario: 'Agent pays 0.5 NEAR to the allowlisted shop',
    expected: 'ALLOWED',
    status: 'recorded',
    txHash: '2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w',
    reason: 'allowed',
    detail: 'Within max_per_tx and receiver allowlisted — funds move.',
  },
  paused: {
    scenario: 'Owner pauses the vault, agent tries to pay 0.5 NEAR to shop',
    expected: 'BLOCKED',
    status: 'recorded',
    txHash: 'HwddasDpQYCtwKYhDmmh8Br38uw9tNteiJeTWHe5F11N',
    reason: 'paused',
    detail: 'Vault paused — every spend is blocked while paused.',
  },
};

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const YOCTO = 10n ** 24n;

function yoctoToNear(yoctoStr) {
  try {
    const y = BigInt(yoctoStr || '0');
    const whole = y / YOCTO;
    const frac = y % YOCTO;
    if (frac === 0n) return whole.toString();
    const fracStr = frac.toString().padStart(24, '0').replace(/0+$/, '').slice(0, 4);
    return `${whole}.${fracStr}`;
  } catch {
    return '—';
  }
}

function nearToYocto(nearStr) {
  // Exact decimal string -> yocto string, no floating point.
  const [w, f = ''] = String(nearStr).split('.');
  const frac = (f + '0'.repeat(24)).slice(0, 24);
  return (BigInt(w || '0') * YOCTO + BigInt(frac || '0')).toString();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtTime(ts) {
  if (ts === null || ts === undefined || ts === '') return '—';
  let ms = Number(ts);
  if (!Number.isFinite(ms)) return '—';
  if (ms > 1e15) ms = ms / 1e6; // nanoseconds (block_timestamp) -> ms
  else if (ms > 1e12) ms = ms; // already ms
  else ms = ms * 1000; // seconds -> ms
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function explorerTxUrl(hash) {
  return `${CONFIG.EXPLORER_URL}/transactions/${hash}`;
}

/* True when an error means "contract/account not deployed yet" — covers both
   the raw RPC wording ("account X does not exist while viewing") and the
   near-api-js v7 wording ("Contract code for contract ID X does not exist"). */
function isNotDeployedError(e) {
  return /does not exist/i.test(String((e && e.message) || e));
}

/* ---------------- near-api-js v7 (dynamic import, resilient) ---------------- */
let naj = null; // module namespace once loaded
let najFailed = false;
let providers = null; // JsonRpcProvider per RPC_URL, once naj loads

async function loadNaj() {
  if (naj || najFailed) return naj;
  try {
    const timeout = new Promise((_, reject) => setTimeout(
      () => reject(new Error('CDN load timeout')),
      CONFIG.NAJ_LOAD_TIMEOUT_MS,
    ));
    naj = await Promise.race([import(CONFIG.NAJ_CDN_URL), timeout]);
    providers = CONFIG.RPC_URLS.map((url) => new naj.JsonRpcProvider({ url }));
  } catch (e) {
    najFailed = true;
    console.warn('near-api-js CDN failed to load, using fetch fallback for views:', e);
  }
  return naj;
}

/* ---------------- view calls ---------------- */
// Primary path: near-api-js v7 provider.callFunction (same as the CLI demo).
async function viewViaNaj(method, args) {
  let lastErr;
  for (const provider of providers) {
    try {
      return await provider.callFunction({ contractId: CONFIG.CONTRACT_ID, method, args });
    } catch (e) {
      lastErr = e;
      if (isNotDeployedError(e)) throw e; // no point retrying other RPCs
    }
  }
  throw lastErr;
}

// Fallback path: plain fetch() JSON-RPC (used only if the CDN failed).
async function viewViaFetch(method, args) {
  const argsBase64 = btoa(unescape(encodeURIComponent(JSON.stringify(args || {}))));
  let lastErr;
  for (const rpcUrl of CONFIG.RPC_URLS) {
    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'agentguard',
          method: 'query',
          params: {
            request_type: 'call_function',
            account_id: CONFIG.CONTRACT_ID,
            method_name: method,
            args_base64: argsBase64,
            finality: 'final',
          },
        }),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error.data || json.error.message || 'RPC error');
      const bytes = new Uint8Array(json.result.result);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      lastErr = e;
      if (isNotDeployedError(e)) throw e;
    }
  }
  throw lastErr;
}

async function viewMethod(method, args) {
  if (naj && providers) return viewViaNaj(method, args);
  return viewViaFetch(method, args);
}

/* ---------------- state ---------------- */
let liveMode = false; // true once a view call has succeeded against the contract
let lastStatus = null;
let lastPolicy = null;

/* ---------------- live panels ---------------- */
function setBanner(kind, text) {
  const banner = $('status-banner');
  banner.className = `banner banner-${kind}`;
  $('status-banner-text').textContent = text;
}

function renderPolicy(policy, status, demo) {
  $('policy-max-tx').textContent = `${yoctoToNear(policy.max_per_tx)} Ⓝ`;
  $('policy-daily').textContent = `${yoctoToNear(policy.daily_limit)} Ⓝ`;
  $('policy-spent').textContent = `${yoctoToNear(status.spent_today)} Ⓝ`;
  $('policy-remaining').textContent = `${yoctoToNear(status.remaining_today)} Ⓝ`;
  const paused = policy.paused || status.paused;
  const badge = $('policy-paused');
  badge.textContent = paused ? '⏸ PAUSED' : '▶ ACTIVE';
  badge.className = `badge ${paused ? 'badge-blocked' : 'badge-allowed'}`;
  const spent = BigInt(status.spent_today || '0');
  const limit = BigInt(policy.daily_limit || '0');
  const pct = limit > 0n ? Number((spent * 100n) / limit) : 0;
  $('daily-progress').style.width = `${Math.min(100, pct)}%`;
  $('daily-progress-label').textContent = `${Math.min(100, pct)}%`;

  const list = $('allowlist');
  list.innerHTML = '';
  (policy.allowlist || []).forEach((a) => {
    const li = document.createElement('li');
    li.innerHTML = `<code>${esc(a)}</code>`;
    list.appendChild(li);
  });
  if (!policy.allowlist || policy.allowlist.length === 0) {
    list.innerHTML = '<li class="muted">Allowlist is empty.</li>';
  }
  if (demo) list.insertAdjacentHTML('beforeend', '<li class="muted small">Demo values — contract not deployed yet.</li>');
}

function renderStatus(status, demo) {
  $('vault-balance').textContent = yoctoToNear(status.balance);
  $('vault-contract').innerHTML = `<code>${esc(CONFIG.CONTRACT_ID)}</code>${demo ? ' <span class="pill">not deployed yet</span>' : ''}`;
  $('vault-owner').innerHTML = `<code>${esc(status.owner || '—')}</code>`;
  $('vault-agent').innerHTML = `<code>${esc(status.agent || '—')}</code>`;
  $('vault-day').textContent = status.day !== undefined ? String(status.day) : '—';
}

function renderLog(entries, demo) {
  const body = $('log-body');
  if (demo || !entries || entries.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="muted">${demo
      ? 'No decisions logged yet — the contract is not deployed. The log will fill in live once it is.'
      : 'No decisions logged yet.'}</td></tr>`;
    return;
  }
  // get_log() already returns most recent first; display as returned.
  const rows = entries.map((e) => {
    const allowed = !!e.allowed;
    const hash = e.tx_hash || e.txHash || e.transaction_hash || null;
    return `<tr>
      <td>${esc(fmtTime(e.timestamp))}</td>
      <td><code>${esc(e.receiver || '—')}</code></td>
      <td>${esc(yoctoToNear(e.amount))} Ⓝ</td>
      <td><span class="badge ${allowed ? 'badge-allowed' : 'badge-blocked'}">${allowed ? 'ALLOWED' : 'BLOCKED'}</span></td>
      <td>${esc(e.reason || '—')}</td>
      <td>${hash ? `<a href="${explorerTxUrl(hash)}" target="_blank" rel="noopener">${esc(String(hash).slice(0, 8))}…↗</a>` : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  body.innerHTML = rows;
}

async function refreshLive() {
  try {
    const [policy, status, log] = await Promise.all([
      viewMethod('get_policy', {}),
      viewMethod('get_status', {}),
      viewMethod('get_log', { limit: CONFIG.LOG_LIMIT }),
    ]);
    liveMode = true;
    lastPolicy = policy;
    lastStatus = status;
    setBanner('live', `● LIVE — reading ${CONFIG.CONTRACT_ID} on NEAR testnet${najFailed ? ' (via fetch fallback; near-api-js CDN failed to load).' : '.'}`);
    renderPolicy(policy, status, false);
    renderStatus(status, false);
    renderLog(Array.isArray(log) ? log : [], false);
    $('last-updated').textContent = `Last updated ${new Date().toLocaleTimeString()} · auto-refreshes every ${CONFIG.REFRESH_MS / 1000}s`;
  } catch (e) {
    liveMode = false;
    lastPolicy = DEMO_POLICY;
    lastStatus = DEMO_STATUS;
    if (isNotDeployedError(e)) {
      setBanner('pending', '◐ CONTRACT NOT DEPLOYED YET — no contract code at guard.agentguard-adt.testnet (account exists, funded with 6 NEAR). Panels below show the demo policy values; live data appears automatically once the contract is deployed.');
    } else {
      setBanner('error', `⚠ Could not reach the contract (${e.message || e}). Showing demo policy values — retrying automatically.`);
    }
    renderPolicy(DEMO_POLICY, DEMO_STATUS, true);
    renderStatus(DEMO_STATUS, true);
    renderLog([], true);
    $('last-updated').textContent = `Last attempt ${new Date().toLocaleTimeString()} · auto-refreshes every ${CONFIG.REFRESH_MS / 1000}s`;
  }
}

/* ---------------- recorded outcomes (no-wallet demo) ---------------- */
function recordedHtml(key) {
  const rec = RECORDED_RUNS[key];
  if (rec.status !== 'recorded' || !rec.txHash) {
    return `
      <div class="result-head">
        <span class="badge ${rec.expected === 'ALLOWED' ? 'badge-allowed' : 'badge-blocked'}">${esc(rec.expected)} <span class="muted">(expected)</span></span>
        <span class="pill">recorded result pending</span>
      </div>
      <p><strong>${esc(rec.scenario)}</strong></p>
      <p class="muted">${esc(rec.detail)}</p>
      <p class="muted small">Live result pending deployment — once the contract is deployed and this
      scenario has run on testnet, this card will show the real outcome with a
      transaction hash and explorer link. Connect a wallet as the agent to run it live instead.</p>`;
  }
  return `
    <div class="result-head">
      <span class="badge ${rec.expected === 'ALLOWED' ? 'badge-allowed' : 'badge-blocked'}">${esc(rec.expected)}</span>
      <span class="pill">recorded testnet run</span>
    </div>
    <p><strong>${esc(rec.scenario)}</strong></p>
    <p>Reason: <em>${esc(rec.reason || '—')}</em></p>
    <p>Tx: <a href="${explorerTxUrl(rec.txHash)}" target="_blank" rel="noopener"><code>${esc(rec.txHash)}</code> ↗</a></p>`;
}

function renderRecorded(key) {
  const box = $(`result-${key}`);
  box.classList.remove('hidden');
  box.innerHTML = recordedHtml(key);
}

/* ---------------- wallet (v7 manual login flow) ---------------- */
// The wallet-approved function-call key lives in localStorage, exactly as
// WalletConnection stored it in older near-api-js versions. It is scoped by
// the wallet to spend/pause/unpause on this contract only, so it cannot move
// funds any other way.
const LS_ACCOUNT = 'agentguard:accountId';
const LS_SECRET = 'agentguard:secretKey';

function signedInAccount() {
  try {
    const acct = localStorage.getItem(LS_ACCOUNT);
    const secret = localStorage.getItem(LS_SECRET);
    return acct && secret ? acct : null;
  } catch {
    return null;
  }
}

function updateWalletUI() {
  const acct = signedInAccount();
  const statusEl = $('wallet-status');
  if (acct) {
    let role = '';
    if (lastStatus) {
      if (acct === lastStatus.agent) role = ' (agent — can spend)';
      else if (acct === lastStatus.owner) role = ' (owner — can pause)';
      else role = ' (not agent/owner — live actions need the agent or owner account)';
    }
    statusEl.textContent = `Connected: ${acct}${role}`;
    statusEl.classList.add('connected');
    $('btn-connect').classList.add('hidden');
    $('btn-disconnect').classList.remove('hidden');
  } else {
    statusEl.textContent = najFailed
      ? 'Wallet unavailable (near-api-js CDN failed to load)'
      : 'Not connected';
    statusEl.classList.remove('connected');
    $('btn-connect').classList.remove('hidden');
    $('btn-disconnect').classList.add('hidden');
    if (najFailed) {
      $('btn-connect').disabled = true;
      $('btn-connect').title = 'near-api-js did not load — live signing is unavailable, but recorded scenarios still work.';
    }
  }
}

// Handle the redirect back from the wallet after login: the wallet appends
// ?account_id=... (success) or ?errorCode=... (failure/rejected).
function handleWalletRedirect() {
  const params = new URLSearchParams(window.location.search);
  const accountId = params.get('account_id');
  const errorCode = params.get('errorCode');
  const errorType = params.get('errorType');
  if (accountId && localStorage.getItem(LS_SECRET)) {
    localStorage.setItem(LS_ACCOUNT, accountId);
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }
  if (accountId && !localStorage.getItem(LS_SECRET)) {
    // Wallet returned an account but we have no key for it (e.g. storage was
    // cleared mid-flow) — cannot sign; ask the user to connect again.
    localStorage.removeItem(LS_ACCOUNT);
    window.history.replaceState({}, '', window.location.pathname);
    $('wallet-status').textContent = 'Sign-in incomplete (key missing) — please connect again.';
    return;
  }
  if (errorCode || errorType) {
    window.history.replaceState({}, '', window.location.pathname);
    $('wallet-status').textContent = `Wallet sign-in failed: ${errorType || errorCode || 'rejected'}.`;
  }
}

function connectWallet() {
  if (!naj) {
    $('wallet-status').textContent = 'Wallet unavailable (near-api-js is still loading or failed to load).';
    return;
  }
  // Fresh keypair; the wallet will add its public key as a function-call
  // access key scoped to this contract + methods.
  const keyPair = naj.KeyPair.fromRandom('ed25519');
  localStorage.setItem(LS_SECRET, keyPair.toString());
  localStorage.removeItem(LS_ACCOUNT);
  const here = window.location.origin + window.location.pathname;
  const url = new URL(`${CONFIG.WALLET_URL}/login/`);
  url.searchParams.set('success_url', here);
  url.searchParams.set('failure_url', here);
  url.searchParams.set('contract_id', CONFIG.CONTRACT_ID);
  url.searchParams.set('public_key', keyPair.getPublicKey().toString());
  url.searchParams.set('methodNames', ['spend', CONFIG.PAUSE_METHOD, CONFIG.UNPAUSE_METHOD].join(','));
  url.searchParams.set('title', 'AgentGuard');
  window.location.assign(url.toString());
}

function disconnectWallet() {
  try {
    localStorage.removeItem(LS_ACCOUNT);
    localStorage.removeItem(LS_SECRET);
  } catch { /* ignore */ }
  updateWalletUI();
}

function getSigningAccount() {
  const accountId = signedInAccount();
  if (!accountId || !naj) return null;
  const secretKey = localStorage.getItem(LS_SECRET);
  return new naj.Account(accountId, providers[0], secretKey);
}

/* ---------------- live contract calls ---------------- */
function decodeOutcome(outcome) {
  // Mirror the CLI demo: getTransactionLastResult parses JSON results.
  try {
    return naj.getTransactionLastResult(outcome);
  } catch {
    const sv = outcome && outcome.status && outcome.status.SuccessValue;
    if (sv) {
      const text = new TextDecoder().decode(Uint8Array.from(atob(sv), (c) => c.charCodeAt(0)));
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }
    return {};
  }
}

async function liveSpend(receiver, amountNear) {
  const account = getSigningAccount();
  const outcome = await account.callFunctionRaw({
    contractId: CONFIG.CONTRACT_ID,
    methodName: 'spend',
    args: { receiver, amount: nearToYocto(amountNear) },
    gas: CONFIG.GAS,
    deposit: CONFIG.DEPOSIT,
  });
  return { decision: decodeOutcome(outcome), txHash: outcome.transaction && outcome.transaction.hash };
}

async function liveSetPaused(paused) {
  const account = getSigningAccount();
  const outcome = await account.callFunctionRaw({
    contractId: CONFIG.CONTRACT_ID,
    methodName: paused ? CONFIG.PAUSE_METHOD : CONFIG.UNPAUSE_METHOD,
    args: {},
    gas: CONFIG.GAS,
    deposit: CONFIG.DEPOSIT,
  });
  return { decision: decodeOutcome(outcome), txHash: outcome.transaction && outcome.transaction.hash };
}

function showLiveResult(boxId, { title, allowed, reason, amountNear, receiver, txHash }) {
  const box = $(boxId);
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="result-head">
      <span class="badge ${allowed ? 'badge-allowed' : 'badge-blocked'}">${allowed ? 'ALLOWED ✓' : 'BLOCKED ✕'}</span>
      <span class="pill">live testnet result</span>
    </div>
    <p><strong>${esc(title)}</strong></p>
    <p>${esc(amountNear)} Ⓝ → <code>${esc(receiver)}</code></p>
    <p>Reason: <em>${esc(reason || '—')}</em></p>
    ${txHash ? `<p>Tx: <a href="${explorerTxUrl(txHash)}" target="_blank" rel="noopener"><code>${esc(txHash)}</code> ↗</a></p>` : ''}
    <p class="muted small">The decision log above refreshes automatically.</p>`;
}

function showError(boxId, message, showRecordedKey) {
  const box = $(boxId);
  box.classList.remove('hidden');
  box.innerHTML = `<p class="error-text">⚠ ${esc(message)}</p>`;
  if (showRecordedKey) {
    box.insertAdjacentHTML('beforeend', `<p class="muted small">Recorded outcome for this scenario:</p>${recordedHtml(showRecordedKey)}`);
  }
}

/* ---------------- scenario handlers ---------------- */
const SCENARIOS = {
  stranger: { title: 'Agent pays 5 NEAR to a stranger', receiver: () => CONFIG.STRANGER_ACCOUNT, amount: '5' },
  shop: { title: 'Agent pays 0.5 NEAR to the allowlisted shop', receiver: () => CONFIG.SHOP_ACCOUNT, amount: '0.5' },
  paused: { title: 'Agent tries to pay 0.5 NEAR to shop while paused', receiver: () => CONFIG.SHOP_ACCOUNT, amount: '0.5' },
};

async function runScenario(key) {
  const sc = SCENARIOS[key];
  const boxId = `result-${key}`;

  // No wallet -> recorded outcome (the fully demonstrable path).
  const acct = signedInAccount();
  if (!acct) {
    renderRecorded(key);
    return;
  }

  // Live path needs the deployed contract + the agent account.
  if (!liveMode) {
    showError(boxId, 'The contract is not deployed yet, so a live spend is impossible. Showing the recorded outcome instead.', key);
    return;
  }
  if (lastStatus && lastStatus.agent && acct !== lastStatus.agent) {
    showError(boxId, `You are signed in as ${acct}, but only the agent (${lastStatus.agent}) can call spend(). Sign in as the agent, or view the recorded outcome.`, key);
    return;
  }
  if (key === 'paused' && lastStatus && !lastStatus.paused && !(lastPolicy && lastPolicy.paused)) {
    showError(boxId, 'The vault is not paused right now. Ask the owner to press “Pause vault” first, then run this scenario — or view the recorded outcome.', key);
    return;
  }

  const btn = document.querySelector(`[data-scenario="${key}"]`);
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Waiting for wallet approval…';
  try {
    const receiver = sc.receiver();
    const { decision, txHash } = await liveSpend(receiver, sc.amount);
    showLiveResult(boxId, {
      title: sc.title,
      allowed: !!(decision && decision.allowed),
      reason: (decision && decision.reason) || (decision && decision.raw) || '—',
      amountNear: sc.amount,
      receiver,
      txHash,
    });
    await refreshLive();
  } catch (e) {
    showError(boxId, `Live call failed: ${e.message || e}. If you rejected the transaction in the wallet, nothing was spent.`, null);
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

async function runPause(paused) {
  const boxId = 'result-pause-action';
  const acct = signedInAccount();
  if (!acct) {
    showError(boxId, 'Connect a wallet as the owner account to pause / unpause the vault.', null);
    return;
  }
  if (!liveMode) {
    showError(boxId, 'The contract is not deployed yet, so pause / unpause is unavailable.', null);
    return;
  }
  if (lastStatus && lastStatus.owner && acct !== lastStatus.owner) {
    showError(boxId, `You are signed in as ${acct}, but only the owner (${lastStatus.owner}) can pause / unpause the vault.`, null);
    return;
  }
  const btn = paused ? $('btn-pause') : $('btn-unpause');
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Waiting for wallet approval…';
  try {
    const { txHash } = await liveSetPaused(paused);
    const box = $(boxId);
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="result-head">
        <span class="badge ${paused ? 'badge-blocked' : 'badge-allowed'}">${paused ? 'VAULT PAUSED ⏸' : 'VAULT ACTIVE ▶'}</span>
        <span class="pill">live testnet result</span>
      </div>
      ${txHash ? `<p>Tx: <a href="${explorerTxUrl(txHash)}" target="_blank" rel="noopener"><code>${esc(txHash)}</code> ↗</a></p>` : ''}
      <p class="muted small">${paused ? 'Now run the scenario below — the agent payment must be BLOCKED.' : 'The agent can spend again within policy.'}</p>`;
    await refreshLive();
  } catch (e) {
    showError(boxId, `Pause call failed: ${e.message || e}.`, null);
  } finally {
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

/* ---------------- boot ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  $('how-contract').textContent = CONFIG.CONTRACT_ID;
  $('footer-explorer').href = `${CONFIG.EXPLORER_URL}/accounts/${CONFIG.CONTRACT_ID}`;

  $('btn-refresh').addEventListener('click', refreshLive);
  $('btn-connect').addEventListener('click', connectWallet);
  $('btn-disconnect').addEventListener('click', disconnectWallet);
  $('btn-pause').addEventListener('click', () => runPause(true));
  $('btn-unpause').addEventListener('click', () => runPause(false));
  document.querySelectorAll('.btn-scenario').forEach((btn) => {
    btn.addEventListener('click', () => runScenario(btn.dataset.scenario));
  });

  handleWalletRedirect();
  // Load near-api-js first (bounded wait); views fall back to fetch if it fails.
  await loadNaj();
  updateWalletUI();
  await refreshLive();
  updateWalletUI(); // re-render role labels once live status arrived
  setInterval(refreshLive, CONFIG.REFRESH_MS);
  setInterval(updateWalletUI, CONFIG.REFRESH_MS);
});
