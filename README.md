# AgentGuard — spending policies for AI agents on NEAR

An AI agent with a wallet can drain it — one prompt injection, one bad
tool call, and the funds are gone. AgentGuard puts the agent's money in a
**policy-guarded vault**: the agent can only spend through an on-chain
contract that enforces a per-transaction cap, a daily cap, a receiver
allowlist, and an owner kill-switch. Every attempt — allowed or blocked —
is written to an on-chain decision log.

> **One-line version:** the agent holds a key that can only call
> `spend()`, and `spend()` only pays out when the owner's policy says so.

Built for the **NEAR Hackathon: Build Beyond Boundaries** (12–14 Nov 2026).
Testnet only. MIT licensed.

## Quick facts (for humans and AI screeners)

| Field | Value |
|---|---|
| Project | AgentGuard |
| Problem | AI agents with wallets have no spending limits; a compromised or misled agent can drain funds |
| Solution | On-chain policy-guarded vault: per-tx cap, daily cap, allowlist, pause kill-switch, decision log |
| Network | NEAR testnet only (no mainnet) |
| Contract | `guard.agentguard-adt.testnet` — [explorer](https://explorer.testnet.near.org/accounts/guard.agentguard-adt.testnet) |
| Owner | `agentguard-adt.testnet` |
| Agent | `agent.agentguard-adt.testnet` (function-call key restricted to `spend`) |
| Demo merchant | `shop.agentguard-adt.testnet` |
| Demo policy | max 1 NEAR/tx, 5 NEAR/day, allowlist `[shop.agentguard-adt.testnet, agentguard-adt.testnet]` |
| Deploy tx | [`22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447`](https://explorer.testnet.near.org/transactions/22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447) (deploy + `init` in one tx, 12 Nov 2026 ~21:50 WIB) |
| Web demo | [darendrarp.github.io/agentguard/web/](https://darendrarp.github.io/agentguard/web/) (GitHub Pages; local run: see `web/README.md`) |
| CLI demo | `demo/cli-demo.mjs` (Node, `near-api-js` 7.x) |
| Contract | Rust (`near-sdk`), `contract/` |
| Tracks | **Security** (primary), **Agents** (secondary) |
| Built | 12–14 Nov 2026, during the hackathon window |
| AI-written code | Yes — used throughout (allowed by the hackathon rules) |
| License | MIT |

## The problem

AI agents are starting to hold real wallets and pay for things: API calls,
data, services, on-chain purchases. Today an agent either holds a full-access
key — so a prompt injection or a bug can empty the wallet in one call — or it
can't pay at all and a human has to approve every cent. There is no middle
ground: **no programmable, enforceable spending policy between the agent and
the money.**

## The product

AgentGuard is that middle ground. The owner funds a vault contract and sets a
policy. The agent gets a key that can do exactly one thing: ask the vault to
spend. The vault decides, on-chain, for every request:

- **Allowlist** — only approved receivers get paid. A stranger's address is
  rejected even if the amount is small.
- **Per-transaction cap** — no single payment above `max_per_tx` (demo: 1 NEAR).
- **Daily cap** — total spending per day cannot exceed `daily_limit` (demo: 5 NEAR).
- **Kill-switch** — the owner can pause the vault; while paused, every spend
  is blocked with reason `"paused"`. Unpause restores it.
- **Decision log** — every attempt is recorded on-chain (`get_log`):
  day, receiver, amount, allowed/blocked, reason, timestamp. Auditable by
  anyone, without trusting the agent's own logs.

`spend()` never panics on a policy violation — it returns a decision
`{allowed, reason, amount}`, so the agent (and its operator) can see *why* a
payment was refused and adjust, instead of getting an opaque revert.

## How NEAR fits

Three NEAR-native properties make this work; none of them is a generic
"blockchain" claim:

1. **Function-call access keys.** NEAR keys can be scoped to one contract and
   one method. The agent's key can call `spend` on `guard.agentguard-adt.testnet`
   and literally nothing else — it cannot transfer the vault's balance, change
   the policy, or call any other contract. The blast radius of a leaked agent
   key is bounded by the policy itself.
2. **On-chain policy enforcement.** The policy lives in contract state and is
   checked by the contract on every call. It cannot be bypassed by a
   compromised agent, a different client, or a direct RPC call — there is no
   off-chain component in the decision path.
3. **Cheap, auditable decision log.** Every decision is stored on-chain, so
   the owner can audit what the agent tried to do, including blocked attempts
   that would otherwise leave no trace.

## Reproduce it (for judges)

No setup beyond Node 18+ and the key files (see below). Everything below runs
against the live testnet deployment.

### Option A — web demo (fastest)

1. Open the web demo: https://darendrarp.github.io/agentguard/web/.
2. **Do:** click "Pay 5 NEAR to stranger" → **see:** BLOCKED, reason
   `over_max_per_tx` (the stranger is also not allowlisted, but the per-tx
   cap is checked first), entry in the decision log.
3. **Do:** click "Pay 0.5 NEAR to stranger" → **see:** BLOCKED, reason
   `receiver_not_allowlisted`.
4. **Do:** click "Pay 2 NEAR to shop" → **see:** BLOCKED, over `max_per_tx`.
5. **Do:** click "Pay 0.5 NEAR to shop" → **see:** ALLOWED, with a
   transaction hash linking to the testnet explorer.
6. **Do:** click "Pause" (owner), then "Pay 0.5 NEAR to shop" → **see:**
   BLOCKED, reason "paused". Click "Unpause", pay again → **see:** ALLOWED.

### Option B — CLI demo (fully scripted, same scenarios)

```bash
cd demo
npm install
NEAR_KEY_FILE=~/workspace/near-hackathon/keys/agent.json \
NEAR_OWNER_KEY_FILE=~/workspace/near-hackathon/keys/owner.json \
node cli-demo.mjs
```

Key files live outside the repo (mode 600) and are passed by env var only —
never committed. Without the owner key, the pause step is skipped with a note
and the rest still runs. A recorded terminal run is in
`demo/terminal-demo.cast` (`asciinema play demo/terminal-demo.cast`).
Full details: `demo/README.md`.

### Option C — raw RPC (no code at all)

```bash
# Policy (view call, no key needed)
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d \
 '{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"call_function","finality":"final","account_id":"guard.agentguard-adt.testnet","method_name":"get_policy","args_base64":"e30="}}'
```

Decode the `result` array as UTF-8 JSON. Same for `get_status` and
`get_log` (args `{"limit":10}` → base64 `eyJsaW1pdCI6MTB9`).

## Contract interface

Deployed at `guard.agentguard-adt.testnet`
([explorer](https://explorer.testnet.near.org/accounts/guard.agentguard-adt.testnet)).

**Views**

| Method | Returns |
|---|---|
| `get_policy()` | `{max_per_tx, daily_limit, allowlist, paused}` |
| `get_status()` | `{owner, agent, balance, paused, spent_today, remaining_today, day}` |
| `get_log(limit)` | `[{day, receiver, amount, allowed, reason, timestamp}]` |

**Change**

| Method | Notes |
|---|---|
| `spend(receiver, amount)` | Only the agent account may call it. Amounts are yoctoNEAR strings. Returns `{allowed, reason, amount}` instead of panicking. Reasons: `allowed`, `not_agent`, `paused`, `over_max_per_tx`, `receiver_not_allowlisted`, `over_daily_limit`, `insufficient_balance` — checked in that order. |
| `pause()` / `unpause()` | Owner only. Confirmed in `contract/DEPLOY.md`. The CLI also tries `set_paused({paused})` as a fallback. |

Demo policy: `max_per_tx` = 1 NEAR, `daily_limit` = 5 NEAR,
allowlist = `[shop.agentguard-adt.testnet, agentguard-adt.testnet]`.

### Live verification (testnet, 12 Nov 2026)

All from `contract/DEPLOY.md` — every link below is a real on-chain record:

- **Deploy + init:** [`22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447`](https://explorer.testnet.near.org/transactions/22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447)
- **Allowed spend** (agent pays 0.5 NEAR to shop; shop balance 0.5 → 1.0 NEAR):
  [`2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w`](https://explorer.testnet.near.org/transactions/2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w)
- **Blocked spend** (agent tries 2 NEAR to shop; returns `over_max_per_tx`,
  tx succeeds, decision logged):
  [`7ksjrCvyjRo2shzEgXD1FuwuzHpo3HciSdB6MQtrU4rt`](https://explorer.testnet.near.org/transactions/7ksjrCvyjRo2shzEgXD1FuwuzHpo3HciSdB6MQtrU4rt)
- **Contract tests:** `cargo test` — 20 passed, 0 failed (allow path, every
  deny reason, daily reset, pause/unpause, owner-only guards, log bounds).
- **CLI demo:** scripted run recorded in `demo/terminal-demo.cast`
  (`asciinema play demo/terminal-demo.cast`).

## Architecture

```
                ┌─────────────────────────────────┐
                │  Vault contract (Rust, near-sdk) │
                │  guard.agentguard-adt.testnet        │
                │                                  │
  agent ──spend─▶  policy check ──▶ pay / refuse   │
  (function-call │  allowlist / caps / pause       │
   key: spend    │  decision log (on-chain)        │
   only)         └─────────────────────────────────┘
                ▲                     │
  owner ──pause/│                     │ NEAR transfers
  unpause, set  │                     ▼
  policy        │              shop.agentguard-adt.testnet
                │
   ┌────────────┴───────────┐    ┌──────────────────┐
   │  Web demo (web/)       │    │  CLI demo (demo/)│
   │  pay / pause buttons + │    │  scripted        │
   │  live decision log     │    │  scenarios (a)-(f)│
   └────────────────────────┘    └──────────────────┘
```

| Directory | Contents |
|---|---|
| `contract/` | Rust contract (`near-sdk`), tests, `DEPLOY.md` (addresses + tx hashes) |
| `web/` | Web demo (see `web/README.md`) |
| `demo/` | `cli-demo.mjs` scripted demo, `package.json`, `terminal-demo.cast` recording |
| `DEMO_SCRIPT.md` | 60–90s demo video script + draft X post |
| `STATUS.md` | Build status across workstreams |

## Tracks

- **Security (primary).** AgentGuard is a security control: least-privilege
  keys (function-call access keys scoped to one method), on-chain policy
  enforcement with no off-chain bypass, a kill-switch, and an auditable
  decision log. The threat model is explicit: a compromised, prompt-injected,
  or buggy agent must not be able to move funds outside the owner's policy.
- **Agents (secondary).** It makes agents economically useful: an agent that
  can pay for tools and services within a budget, without a human approving
  every transaction and without holding the keys to the whole wallet.

## Run locally

```bash
# Contract (requires Rust + the wasm32-unknown-unknown target; no cargo-near needed)
cd contract && cargo test
cargo build --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/agentguard.wasm
# Deploy + verify steps: see contract/DEPLOY.md

# Web demo (static page, no build step — just serve it)
cd web && python3 -m http.server 8000   # open http://localhost:8000/

# CLI demo (requires the testnet deployment + key files, see demo/README.md)
cd demo && npm install
NEAR_KEY_FILE=~/workspace/near-hackathon/keys/agent.json \
NEAR_OWNER_KEY_FILE=~/workspace/near-hackathon/keys/owner.json \
node cli-demo.mjs
```

## Security notes and limitations

- **Testnet only.** Nothing here is mainnet-ready or audited; do not put real
  funds in it.
- The agent account (`agent.agentguard-adt.testnet`) holds only gas money; the
  vault itself enforces that `spend()` only accepts calls from the agent
  account. In production the agent's key would additionally be a NEAR
  function-call access key scoped to `spend` on the vault, so a leaked agent
  key cannot do anything else even on its own account.
- Daily limits reset per contract day; re-running the CLI demo shares the
  5 NEAR/day budget (each full run spends 1 NEAR), so after ~5 runs in a day
  the "allowed" steps correctly block on the daily limit.
- The vault holds only NEAR (no fungible-token policy yet); policy changes are
  owner-only and take effect immediately.

## Hackathon notes

- All code in this repo was written during the hackathon window,
  **12–14 November 2026**.
- **AI-written code was used** (allowed by the hackathon rules): the contract,
  web demo, CLI demo, and docs were written with AI coding assistance and
  reviewed by the team.
- Submission deadline: **14 Nov 2026, 23:59 UTC**.

## License

MIT — see `LICENSE`.
