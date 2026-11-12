# AgentGuard — CLI demo

Scripted end-to-end demo of the AgentGuard vault on NEAR testnet.
No browser needed: it talks to the deployed contract with `near-api-js`
and prints every step, every decision, and every transaction hash.

## What it shows

| Step | Agent action | Expected |
|------|--------------|----------|
| (a) | Read policy + status | max 1 NEAR/tx, 5 NEAR/day, allowlist `[shop.agentguard-adt.testnet, agentguard-adt.testnet]` |
| (b) | Pay 5 NEAR to `stranger.testnet` | **BLOCKED** — `over_max_per_tx` (the stranger is also not allowlisted, but the per-tx cap is checked first) |
| (b2) | Pay 0.5 NEAR to `stranger.testnet` | **BLOCKED** — `receiver_not_allowlisted` |
| (c) | Pay 2 NEAR to `shop.agentguard-adt.testnet` | **BLOCKED** — over `max_per_tx` |
| (d) | Pay 0.5 NEAR to the shop | **ALLOWED** — tx hash + explorer link printed |
| (e) | Owner pauses → agent pays → owner unpauses → agent pays | **BLOCKED ("paused")**, then **ALLOWED** |
| (f) | Read decision log (`get_log`) | Every attempt above, on-chain |

A summary table is printed at the end. Exit code 0 = every step behaved
as expected; 1 = a step did not.

## Prerequisites

- Node.js ≥ 18
- The contract deployed on testnet at `guard.agentguard-adt.testnet`
  (see `../contract/DEPLOY.md` for the deploy tx hash)
- The agent key file, **outside the repo**, at
  `~/workspace/near-hackathon/keys/agent.json` (mode 600, NEAR CLI JSON
  format: `{account_id, public_key, private_key}`), for account
  `agent.agentguard-adt.testnet`. The agent account needs a little testnet
  NEAR for gas (~0.01 NEAR covers a full run).
- For step (e), the owner key at
  `~/workspace/near-hackathon/keys/owner.json` for `agentguard-adt.testnet`.
  Without it, step (e) is skipped with a note — the rest still runs.

## Run

```bash
cd demo
npm install   # once; installs near-api-js 7.x
NEAR_KEY_FILE=~/workspace/near-hackathon/keys/agent.json \
NEAR_OWNER_KEY_FILE=~/workspace/near-hackathon/keys/owner.json \
node cli-demo.mjs
```

Or `npm run demo` (same thing; env vars still required).

## Notes

- **Keys never enter the repo.** The script reads them only from the paths
  in `NEAR_KEY_FILE` / `NEAR_OWNER_KEY_FILE`. `.gitignore` also blocks key
  files, `.env` files, and `*.wasm`.
- **Testnet only.** RPC is `https://rpc.testnet.near.org`; explorer links
  point at `https://explorer.testnet.near.org`.
- **One full run spends 1 NEAR of vault funds** (0.5 + 0.5). Re-runs share
  the 5 NEAR/day daily limit, so after ~5 runs in one day the ALLOWED steps
  will correctly block with a daily-limit reason. That is the policy
  working, not a bug — wait for the next UTC day or use a fresh vault.
- **Pause method names:** the frozen contract interface in the task brief
  specifies `spend` + the three views, but not the pause method names. The
  script tries `pause()`/`unpause()` first, then `set_paused({paused})`,
  and prints which one the deployed contract actually has. If the contract
  uses other names, set them in `contract/DEPLOY.md` and update
  `trySetPaused()` in `cli-demo.mjs`.
- Env overrides: `NEAR_CONTRACT` (default `guard.agentguard-adt.testnet`),
  `NEAR_RPC`, `NEAR_SHOP`, `NEAR_STRANGER`.

## Recording

`terminal-demo.cast` is an asciinema recording of a full passing run
(recorded 12 Nov 2026 ~21:51 WIB against the live testnet deployment — all
six spend scenarios PASS). Play it with:

```bash
asciinema play demo/terminal-demo.cast
```

To re-record (e.g. after a contract redeploy):

```bash
asciinema rec demo/terminal-demo.cast -c "node cli-demo.mjs"
```

Note: each full run spends 1 NEAR of vault funds and counts against the
5 NEAR/day daily limit — check `get_status` first if the limit is nearly used.

See `NOTES.md` in this folder for the current status.
