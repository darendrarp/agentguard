# Docs + CLI lane — progress notes

Owner: docs/CLI subagent. Last updated: 12 Nov 2026 ~21:45 WIB.

## Done

- `demo/cli-demo.mjs` — complete (scenarios a–f, summary table, exit codes).
  Uses near-api-js **7.5.3** (verified latest via `npm view`, 12 Nov 2026;
  published 2026-11-11).
- `demo/package.json` (`near-api-js ^7.5.3`, `npm install` run, 68 packages)
  and `demo/README.md`.
- `README.md` (root), `DEMO_SCRIPT.md` (video script + X post draft, 257/280
  chars with realistic placeholder URLs), `LICENSE` (MIT 2026 AgentGuard),
  `.gitignore` (node_modules/, target/, *.wasm, key files, .env).
- `STATUS.md` created (did not exist; coordinator owns it from here).
- `demo/SCREENSHOTS.md` — capture guide (no headless browser on this VM).

## near-api-js v7 API — important, differs from old docs

v7 (7.x) removed the old `connect()` / `keyStores` / `utils` / `providers`
surface that docs.near.org's quick-reference still shows. Verified against
the installed 7.5.3 type definitions:

- `new JsonRpcProvider({ url })` for RPC.
- `new Account(accountId, provider, secretKeyString)` — the `"ed25519:..."`
  string is accepted directly as the signer.
- Views: `provider.callFunction({ contractId, method, args })` → decoded JSON.
- Change: `account.callFunctionRaw({ contractId, methodName, args, gas, deposit })`
  → `RpcTransactionResponse` (`transaction.hash` + `status`); decode the
  return value with top-level `getTransactionLastResult(response)`.
- `parseNearAmount` / `formatNearAmount` are top-level named exports.

The first version of `cli-demo.mjs` used the v5-style API and failed at import
(`connect` is not exported); rewritten for v7 and re-tested.

## Tested so far (live testnet RPC, no contract yet)

- `node --check` clean.
- No `NEAR_KEY_FILE` → clean usage error, exit 2.
- With a throwaway dummy key (generated in /tmp, never a real key): the v7
  view path works end-to-end — RPC correctly reported
  "Account guard.agentguard.testnet does not exist at block height 277375308"
  and the script exited 2 with the "not deployed yet" message.

## On-chain recon (12 Nov ~21:35 WIB, RPC https://rpc.testnet.near.org)

- `agentguard.testnet` EXISTS (~9.797 NEAR, storage 188889) and has contract
  code — but `get_policy` returns `MethodNotFound`, so it is NOT the
  AgentGuard vault. **Coordinator correction 12 Nov ~21:31 WIB: that account
  belongs to someone else — all names moved to the `-adt` suffix:**
  contract `guard.agentguard-adt.testnet`, owner `agentguard-adt.testnet`,
  agent `agent.agentguard-adt.testnet`, shop `shop.agentguard-adt.testnet`.
  All repo files (CLI, README, DEMO_SCRIPT, STATUS) were updated to the new
  names the same night.
- Old names `guard.agentguard.testnet`, `agent.agentguard.testnet`,
  `shop.agentguard.testnet` did NOT exist at check time. New `-adt` names:
  re-check on-chain once the contract lane creates them (see watcher note
  below).
- `~/workspace/near-hackathon/keys/` is empty — no `agent.json` / `owner.json`
  yet (contract lane creates accounts/keys).

## Contract source verified (12 Nov ~21:50 WIB, read-only peek at contract/src/lib.rs)

The contract lane's source already exists and confirms the interface the CLI
was built against — no CLI changes needed except the (b2) step below:

- `spend(receiver, amount: U128) -> SpendResult {allowed, reason, amount}` —
  never panics on a policy denial. Check order: (1) `not_agent`, (2) `paused`,
  (3) `over_max_per_tx`, (4) `receiver_not_allowlisted`, (5) `over_daily_limit`,
  (6) `insufficient_balance` (balance must cover amount + a reserve). Success
  reason is `"allowed"`.
- `pause()` / `unpause()` exist (owner-only, no args) — the CLI's first-choice
  names were right; the `set_paused` fallback is now redundant but harmless.
- `get_policy` / `get_status` / `get_log(limit: u32)` match the brief exactly.
  Decision timestamps are block timestamps (u64 nanoseconds) — the CLI
  converts with `BigInt(ts) / 1_000_000`.
- **Check-order consequence:** 5 NEAR to a stranger blocks on
  `over_max_per_tx` (checked before the allowlist), so the allowlist reason
  never shows in scenario (b). Added step **(b2)** — 0.5 NEAR to the stranger
  → BLOCKED `receiver_not_allowlisted` — to the CLI, demo/README.md, root
  README, and DEMO_SCRIPT.md. Blocked spends move no funds, so a full run
  still spends only 1 NEAR of vault funds.
- Also in the source (not used by the demo): `set_policy`, `set_agent`,
  `deposit`, `init(owner, agent, max_per_tx, daily_limit, allowlist)`.

## Keys ready (12 Nov ~21:31 WIB, coordinator update)

- `~/workspace/near-hackathon/keys/` now has `agent.json`, `owner.json`,
  `guard.json`, `shop.json` (all mode 600). Verified `agent.json` /
  `owner.json` parse: account_ids `agent.agentguard-adt.testnet` /
  `agentguard-adt.testnet`. Details + creation tx hashes in
  `~/workspace/near-hackathon/ADDRESSES.md`.
- CLI re-tested with the REAL agent + owner keys: clean run to step (a),
  then exit 2 "Contract code for contract ID guard.agentguard-adt.testnet
  does not exist at block height 277375675" — account exists (6 NEAR),
  code not deployed yet. Exactly as expected.
- **STATUS.md is coordinator-owned now** (coordinator update 12 Nov ~21:31
  WIB) — do NOT edit it. Lane notes live here in `demo/NOTES.md`.

## Open questions / risks

1. **Pause method names are not in the frozen interface.** The brief only
   specifies `spend` + the three views. `cli-demo.mjs` tries
   `pause()`/`unpause()` first, then `set_paused({paused})`, and prints which
   one worked. If the contract uses other names, update `trySetPaused()` and
   README/DEPLOY.md.
2. **Daily-limit sharing across re-runs.** Each full CLI run spends 1 NEAR of
   vault funds (0.5 + 0.5); after ~5 runs/day the ALLOWED steps will
   correctly block. Plan recording takes accordingly (fresh day or fresh vault).
3. **RPC latency from this VM** is high (5–45s per call observed); the demo
   has small sleeps between steps. If a run looks slow, it is the RPC, not the
   script.

## Pending (blocked on other lanes / human)

1. ~~Contract deployed + `contract/DEPLOY.md`~~ — DONE 12 Nov ~21:50 WIB.
2. ~~Record `demo/terminal-demo.cast`~~ — DONE 12 Nov ~21:51 WIB (full PASS).
3. ~~Fill README `[PENDING]` placeholders~~ — DONE except the web demo URL.
4. **Web demo URL** (web lane) — needed to fill the last README `[PENDING]`
   (2 spots) and the DEMO_SCRIPT.md X-post draft. Local run works
   (`python3 -m http.server`); no public deploy yet.
5. **Web screenshots** — human/parent captures per `demo/SCREENSHOTS.md`
   (no headless browser on this VM, per the brief).
6. **STATUS.md refresh** — coordinator-owned; its lane section still says
   "not deployed yet" / "live test pending" (stale since ~21:45 WIB).
   Coordinator to update (this lane does not edit STATUS.md).

## Live end-to-end test — PASSED (12 Nov 2026 ~21:51 WIB)

Contract deployed ~21:50 WIB (DEPLOY.md appeared; watcher caught it after
~17 min). Full CLI run against the live contract, recorded to
`demo/terminal-demo.cast` (asciinema 2.4.0, `--idle-time-limit 2`, 88s wall
time, 10,251 bytes, all 38 lines valid JSON — output verified by parsing
the cast file). **All 6 spend scenarios PASS, 0 failures:**

| Step | Call | Result | Tx |
|---|---|---|---|
| (b) | 5 NEAR → stranger.testnet | BLOCKED `over_max_per_tx` | `BjsNoR8yWpaGuqBtgiE1CEzHCntC2dchMt3VEZBVpoHH` |
| (b2) | 0.5 NEAR → stranger.testnet | BLOCKED `receiver_not_allowlisted` | `7SPoQwuTjLz1DgNoMSD7U5AK2XzsLTbyxtbDRn4daPtT` |
| (c) | 2 NEAR → shop | BLOCKED `over_max_per_tx` | `7gzQrRJ2kGVguPwAUzfKiX9bQjzPDBCYzAqNb4DYYiEA` |
| (d) | 0.5 NEAR → shop | ALLOWED | `HtpxjdAw8Ss3yoxnwrRP64gEVq7pbX3ghGAMetVXyyWh` |
| (e) pause | owner `pause()` | paused=true | `D4UKbnsiTKDdkFKawQ8a5tUrWREA7ZfaeKpfqbgMs78Y` |
| (e1) | 0.5 NEAR → shop while paused | BLOCKED `paused` | `4fPUYsJ7wiC76idEFS9be58MQvUNff2d9C64NHo77mtC` |
| (e) unpause | owner `unpause()` | paused=false | `3BNp2fHcJtYeBn3vSqYVJUruD43NqfsqWgwyKj2RECQE` |
| (e2) | 0.5 NEAR → shop | ALLOWED | `GLh25LBBCCMyGUuVLtxBswn35zisbbRTjkQ8WNWrQYdD` |

Policy read back: max 1 NEAR/tx, 5 NEAR/day, allowlist
`[shop.agentguard-adt.testnet, agentguard-adt.testnet]`, paused=false.
Vault before run: 5.4982 NEAR, spent_today 0.5 (contract lane's verification
spend), remaining 4.5. This run spent 1 NEAR → spent_today now 1.5 NEAR,
remaining 3.5 NEAR; shop balance now ~2.0 NEAR. Decision log (step f)
showed all 8 entries (6 from this run + 2 from the contract lane),
most-recent-first, with correct reasons and timestamps.
CLI exit code 0, "Demo result: all steps behaved as expected. ✅"

README `[PENDING]` placeholders finalized from DEPLOY.md the same night:
deploy tx `22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447`, allowed-spend tx
`2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w`, blocked-spend tx
`7ksjrCvyjRo2shzEgXD1FuwuzHpo3HciSdB6MQtrU4rt`, cargo test 20/20, pause
method names confirmed. **Only remaining placeholder: the web demo URL**
(web lane has not deployed it yet — local `python3 -m http.server` only).

## Watcher for DEPLOY.md — FIRED 12 Nov ~22:07 WIB (after ~17 min)

DEPLOY.md appeared (contract deployed ~21:50 WIB). README placeholders
finalized from it, CLI tested end-to-end, `terminal-demo.cast` recorded —
see the "Live end-to-end test" section above. Watcher done; no longer running.

## Flag for the coordinator — web lane `-adt` rename: RESOLVED

The 21:55 WIB flag (web/ still on old names) is resolved: re-checked after
the deploy, `web/app.js` now has 7 mentions of `agentguard-adt` and the
web lane's NOTES show it is tracking the live contract (incl. a fallback
RPC). Remaining web item: no public demo URL yet (local http.server only)
— README keeps the `[PENDING]` for it.

## Tooling checks

- asciinema: installed 2.4.0 in a venv at `~/workspace/near-hackathon/.venv-asciinema/` (moved out of the repo by the coordinator 12 Nov ~22:00 WIB — venvs must not ship in the public repo)
  (PEP 668 blocks system pip; venv used instead) and used to record
  `terminal-demo.cast`. Fallback if re-recording elsewhere without it:
  `script -c "node cli-demo.mjs" demo/terminal-demo.log` (ffmpeg is
  available if a video render is needed).
- No headless browser / chromium / playwright on the VM — deliberately NOT
  installed per the task brief; screenshots go through the human/parent.
