# AgentGuard web demo — NOTES

Static demo page (no build step): `index.html` + `app.js` + `styles.css`.
Relative paths throughout, so it works from `python3 -m http.server` and
from GitHub Pages (publish the `web/` folder or the repo root accordingly).
`app.js` is an ES module (`<script type="module">`) — serve over HTTP, not
`file://`.

## How to run locally

```bash
cd ~/workspace/near-hackathon/agentguard/web
python3 -m http.server 8000
# open http://localhost:8000/
```

No install step. Internet access is required for the near-api-js CDN and for
the NEAR testnet RPC calls.

## Account names (updated 12 Nov 2026 ~21:31 WIB)

`agentguard.testnet` already exists on testnet and belongs to someone else
(it holds ~9.8 NEAR and has unrelated contract code — no `get_policy`),
so the project moved to the `-adt` suffix. Final names, used everywhere:

- Contract: `guard.agentguard-adt.testnet`
- Owner: `agentguard-adt.testnet`
- Agent: `agent.agentguard-adt.testnet`
- Demo merchant (allowlisted): `shop.agentguard-adt.testnet`

All four accounts exist and are funded (checked via FastNear RPC 12 Nov 2026
~21:35 WIB): guard 6 NEAR, owner ~1.48 NEAR, agent 2 NEAR, shop 0.5 NEAR.
Re-confirm against `contract/DEPLOY.md` once it exists.

## near-api-js version / CDN

- **Used: near-api-js 7.5.3, ESM bundle via jsDelivr**
  `https://cdn.jsdelivr.net/npm/near-api-js@7.5.3/+esm`
  — the same major version the CLI demo lane uses (`demo/package.json`).
- **Verified:**
  - HEAD: HTTP 200, `Content-Type: application/javascript` (12 Nov 2026).
  - Bundle head fetched: "Bundled by jsDelivr using Rollup … Original file:
    /npm/near-api-js@7.5.3/lib/index.js".
  - The v7 APIs the page uses (`JsonRpcProvider`, `Account`,
    `KeyPair.fromRandom`, `getTransactionLastResult`, `parseNearAmount`,
    `formatNearAmount`) were verified live in Node against the CLI lane's
    identical 7.5.3 install (`demo/node_modules/near-api-js`, v7.5.3).
- **Why not the old UMD build:** the original brief specified
  `WalletConnection`, but near-api-js v7 removed `WalletConnection` /
  `connect()` / `keyStores` entirely (confirmed: none of them appear in
  v7.5.3's `lib/index.d.ts`) and ships ESM-only (no UMD global build).
  Current docs.near.org points wallet login at `@hot-labs/near-connect`.
  This page instead implements the same wallet-login redirect protocol
  `WalletConnection` used, with v7 primitives: `KeyPair.fromRandom()` +
  a localStorage-stored function-call key + `new Account(accountId,
  provider, secretKey)`. One dependency, no extra wallet SDK.
  - The redirect flow itself (MyNearWallet `/login/` with `contract_id`,
    `public_key`, `methodNames`, `success_url`/`failure_url`) follows the
    standard legacy wallet protocol, but it has **not** been tested end to
    end in a real browser — there is no browser on this VM. Test it once
    with MyNearWallet testnet before the judging demo.
- **Resilience:** near-api-js is loaded with a dynamic `import()` (15s
  timeout). If the CDN fails, view calls fall back to plain `fetch()`
  JSON-RPC and the recorded scenarios still work; only wallet signing is
  disabled, with a clear message.

## What is live vs placeholder (status: 12 Nov 2026 ~21:40 WIB)

- **Contract NOT deployed yet.** `guard.agentguard-adt.testnet` exists
  (6 NEAR) but has no contract code (`code_hash` all-ones, checked via
  FastNear RPC ~21:35 WIB). `contract/DEPLOY.md` does not exist yet.
- **Live right now:** page load, layout, view-call plumbing (v7
  `provider.callFunction` with primary + fallback RPC, fetch fallback),
  auto-refresh, wallet connect UI, scenario buttons in no-wallet mode
  (recorded-outcome cards).
- **Placeholder until deployment:**
  - Panels show the spec's demo policy values (max 1 NEAR/tx, daily 5 NEAR,
    allowlist `shop.agentguard-adt.testnet` + `agentguard-adt.testnet`),
    clearly marked with a "CONTRACT NOT DEPLOYED YET" banner and "demo
    values" notes.
  - Decision log shows "No decisions logged yet".
  - All three `RECORDED_RUNS` entries in `app.js` are `status: 'pending'`
    with no tx hash. **To fill in:** after the contract is deployed and the
    three scenarios have run on testnet, copy the tx hashes + reasons from
    `contract/DEPLOY.md` into `RECORDED_RUNS` in `app.js` and set
    `status: 'recorded'`. No other code change is needed.
  - **Live view-call verification is pending** the deployment: once the
    contract code is deployed at `guard.agentguard-adt.testnet`, reload the
    page — the banner flips to LIVE automatically and the panels populate
    from `get_policy` / `get_status` / `get_log`. No code change needed.

## Confirmed from the contract source (`contract/src/lib.rs`)

Read 12 Nov 2026 ~21:35 WIB — these were assumptions before, now confirmed:

1. **Pause methods are `pause()` / `unpause()`**, owner-only, no args.
2. **`get_log(limit)` returns most recent first** (`.rev().take(limit)`),
   capped at 100 entries on-chain. The UI displays entries as returned
   (`LOG_NEWEST_FIRST: true`).
3. **Spend check order:** agent → paused → max_per_tx → allowlist →
   daily limit → balance (0.1 NEAR reserve). Scenario 1 (5 NEAR to a
   stranger) returns `over_max_per_tx` — the cap is checked before the
   allowlist. Full reason list: `not_agent`, `paused`, `over_max_per_tx`,
   `receiver_not_allowlisted`, `over_daily_limit`, `insufficient_balance`,
   `allowed`.
4. **Timestamps are nanoseconds** (`env::block_timestamp()`); the UI
   auto-detects ns/ms/s by magnitude.
5. **Denials never panic** — `spend()` always returns
   `{allowed, reason, amount}` and logs the decision, so a blocked spend
   still costs gas but moves no funds.
6. **Log entries have no tx-hash field** — the Tx column renders an
   explorer link only if an entry carries `tx_hash` / `txHash` /
   `transaction_hash`; otherwise it shows "—".
7. **Live spends require signing in as the agent account** and pause /
   unpause require the **owner** account — the UI checks the connected
   account against `get_status()` and explains this if it mismatches.
   A judge with any other account sees the recorded outcomes instead.

## RPC notes

- Primary RPC `https://rpc.testnet.near.org` was **unreachable from this VM**
  (connection timeout, 12 Nov 2026) — it should work from a judge's browser.
  The page automatically falls back to `https://test.rpc.fastnear.com`
  (verified working from this VM) if the primary fails, for view calls.
- `get_log` is called with `{ limit: 20 }` (CONFIG.LOG_LIMIT).

## Security

- No private keys, seed phrases, or hard-coded secrets anywhere in this
  folder or in the page. The only key material ever present is the
  wallet-approved **function-call key** the page generates at connect time
  and stores in the browser's own localStorage — scoped by the wallet to
  `spend` / `pause` / `unpause` on this contract only, exactly as
  `WalletConnection` stored it in older near-api-js versions. It cannot
  move funds any other way. Disconnect clears it.
- Signing a spend still needs the wallet's approval per transaction
  (function-call key with a limited allowance, per the standard flow).

## Blocking / still needed

1. **Contract deployment** at `guard.agentguard-adt.testnet` +
   `contract/DEPLOY.md` with the three recorded scenario tx hashes — then
   fill in `RECORDED_RUNS`.
2. Live end-to-end check after deployment: reload page, verify LIVE banner,
   run scenario 2 with the agent wallet, confirm the log updates.
3. Live browser test of the MyNearWallet connect flow (no browser on VM).
4. Public demo URL (GitHub Pages) + screenshots for the README.
