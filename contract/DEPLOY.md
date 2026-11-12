# AgentGuard — Deploy Record (NEAR TESTNET)

> Testnet only. No mainnet accounts are used anywhere in this project.

## Accounts

| Role | Account | Balance at deploy |
|---|---|---|
| Owner / deployer | `agentguard-adt.testnet` | ~1.48 NEAR |
| **Contract (vault)** | **`guard.agentguard-adt.testnet`** | 6 NEAR (pre-funded by coordinator; no separate funding step needed) |
| Agent | `agent.agentguard-adt.testnet` | 2 NEAR |
| Demo merchant (allowlisted) | `shop.agentguard-adt.testnet` | 0.5 NEAR |

Keys: `~/workspace/near-hackathon/keys/` (`owner.json`, `guard.json`, `agent.json`,
`shop.json`, mode 600) and `~/.near-credentials/testnet/`. Never copied into this repo.
Full address/key record: `~/workspace/near-hackathon/ADDRESSES.md`.

Explorer: https://explorer.testnet.near.org/accounts/guard.agentguard-adt.testnet
(also https://testnet.nearblocks.io/address/guard.agentguard-adt.testnet)

## Build

- Toolchain: rustc/cargo 1.99.1, `wasm32-unknown-unknown` target.
- **cargo-near was NOT used**: install attempts failed to compile (`futures-util`
  error against rustc 1.99.1). The contract was built with plain cargo instead.
  This is safe for near-sdk 5.30.1: `cfg(near)` is only read by the SDK's
  compile-error gate, and host functions are selected by `target_arch =
  "wasm32"` — verified in the registry sources, and confirmed by the built
  wasm importing `predecessor_account_id`, `account_balance`,
  `block_timestamp`, `promise_batch_action_transfer`, `storage_write`,
  `log_utf8`, and exporting all 10 methods.
- near-sdk 5.30.1. Notes for future builds:
  - `cargo test` needs the `unit-testing` feature via `[dev-dependencies]`
    (already in `Cargo.toml`); plain `cargo test` otherwise fails at the
    near-sdk cfg gate.
  - The state struct needs `#[near(contract_state)]` (auto-derives Borsh;
    do not re-derive `BorshSerialize`/`BorshDeserialize` on it) — bare
    `#[near_bindgen]` no longer implements `ContractState` in 5.30.
  - `testing_env` is a macro at the crate root: `near_sdk::testing_env!(...)`.
  - `Promise::transfer(...)` is `#[must_use]` — call `.detach()`.

```bash
cd ~/workspace/near-hackathon/agentguard/contract
cargo test                                        # 20 passed, 0 failed
cargo build --target wasm32-unknown-unknown --release
# -> target/wasm32-unknown-unknown/release/agentguard.wasm (228,871 bytes)
```

## Deploy + init

Deployed 2026-11-12 ~21:50 WIB with near-cli 4.0.13 (deploy + `init` in one tx):

```bash
near deploy guard.agentguard-adt.testnet \
  target/wasm32-unknown-unknown/release/agentguard.wasm \
  --initFunction init \
  --initArgs '{"owner":"agentguard-adt.testnet","agent":"agent.agentguard-adt.testnet","max_per_tx":"1000000000000000000000000","daily_limit":"5000000000000000000000000","allowlist":["shop.agentguard-adt.testnet","agentguard-adt.testnet"]}' \
  --networkId testnet
```

- **Deploy + init tx:** `22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447`
  - https://explorer.testnet.near.org/transactions/22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447
  - https://testnet.nearblocks.io/txns/22fUrgFWJZeyZKV8RSmZyVmYcRssrdrh5ZeiyGSRL447

Init args: owner `agentguard-adt.testnet`, agent `agent.agentguard-adt.testnet`,
max_per_tx 1 NEAR (`1000000000000000000000000` yocto), daily_limit 5 NEAR
(`5000000000000000000000000` yocto), allowlist
`[shop.agentguard-adt.testnet, agentguard-adt.testnet]`.

No funding tx: the contract account already held 6 NEAR before deploy.

## Verification (all on-chain, testnet)

Views (post-init):

```bash
near view guard.agentguard-adt.testnet get_policy '{}' --networkId testnet
# { max_per_tx: '1000000000000000000000000', daily_limit: '5000000000000000000000000',
#   allowlist: ['shop.agentguard-adt.testnet', 'agentguard-adt.testnet'], paused: false }

near view guard.agentguard-adt.testnet get_status '{}' --networkId testnet
# { owner: 'agentguard-adt.testnet', agent: 'agent.agentguard-adt.testnet',
#   balance: '5998161594487597100000000', paused: false,
#   spent_today: '0', remaining_today: '5000000000000000000000000', day: 20769 }
```

Allowed spend — agent sends 0.5 NEAR to shop (within policy):

```bash
near call guard.agentguard-adt.testnet spend \
  '{"receiver":"shop.agentguard-adt.testnet","amount":"500000000000000000000000"}' \
  --accountId agent.agentguard-adt.testnet --networkId testnet
# -> { allowed: true, reason: 'allowed', amount: '500000000000000000000000' }
#    + NEP-297 log: EVENT_JSON:{"standard":"agentguard","version":"1.0.0",
#      "event":"spend_decision","data":{...,"allowed":true,"reason":"allowed",...}}
```

- **Allowed-spend tx:** `2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w`
  - https://explorer.testnet.near.org/transactions/2UnkGnwbDTZGV9QwMoVdnhsSfe8NFrZeKbjkzNuDo66w
- Shop balance went 0.5 → **1.0 NEAR** (transfer landed).

Blocked spend — agent tries 2 NEAR to shop (over the 1 NEAR per-tx cap).
The call **returns** the denial instead of panicking, so the tx succeeds and
the decision is logged:

```bash
near call guard.agentguard-adt.testnet spend \
  '{"receiver":"shop.agentguard-adt.testnet","amount":"2000000000000000000000000"}' \
  --accountId agent.agentguard-adt.testnet --networkId testnet
# -> { allowed: false, reason: 'over_max_per_tx', amount: '2000000000000000000000000' }
#    + NEP-297 log with "allowed":false,"reason":"over_max_per_tx"
```

- **Blocked-spend tx:** `7ksjrCvyjRo2shzEgXD1FuwuzHpo3HciSdB6MQtrU4rt`
  - https://explorer.testnet.near.org/transactions/7ksjrCvyjRo2shzEgXD1FuwuzHpo3HciSdB6MQtrU4rt

Decision log (`get_log '{"limit":5}'`) shows both decisions, most recent first;
`get_status` after both spends: balance `5498161594487597100000000` (~5.498 NEAR),
`spent_today` 0.5 NEAR, `remaining_today` 4.5 NEAR.

## Tests

`cargo test`: **20 passed, 0 failed** (allow path; every deny reason;
daily reset across days; pause/unpause; all five owner-only guards;
allowlist enforcement incl. via `set_policy`; log boundedness at 100 +
most-recent-first ordering; check-order precedence). Tests live in
`src/lib.rs` (`#[cfg(test)]`).

## API (frozen — web demo / CLI demo built against this)

- `init(owner, agent, max_per_tx: U128, daily_limit: U128, allowlist: Vec<AccountId>)`
- `spend(receiver, amount: U128) -> SpendResult { allowed, reason, amount }`
  (agent-only; denials return, never panic)
- Owner-only: `set_policy(max_per_tx, daily_limit, allowlist)`,
  `set_agent(new_agent)`, `pause()`, `unpause()`, `deposit()` (payable)
- Views: `get_policy()`, `get_status()`, `get_log(limit: u32)`

Policy check order in `spend`: not_agent → paused → over_max_per_tx →
receiver_not_allowlisted → over_daily_limit → insufficient_balance
(balance must cover amount + 0.1 NEAR reserve). Day =
`block_timestamp / 86_400_000_000_000`; `spent_today` resets on rollover.
Log capped at last 100 entries; every decision emits a NEP-297
`spend_decision` event (`standard: "agentguard"`, version `1.0.0`).
