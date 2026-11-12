# AgentGuard — web demo

Static single-page demo for the AgentGuard policy-guarded agent vault
(NEAR testnet). No build step — plain HTML + CSS + ES-module JavaScript.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000/
```

(Serves the current folder. Must be over HTTP, not `file://`, because
`app.js` is an ES module.)

## Deploy (GitHub Pages)

Publish this folder as the Pages root (or the repo root — all paths are
relative). No build step.

## What it shows

- **Live panels** (no wallet needed, auto-refresh every 10s): vault balance,
  policy (max/tx, daily limit, remaining today, paused state), allowlist,
  and the on-chain decision log.
- **Three judge scenarios**: 5 NEAR to a stranger (BLOCKED), 0.5 NEAR to the
  allowlisted shop (ALLOWED), pause + pay attempt (BLOCKED). Without a
  wallet they show the recorded testnet outcomes; with a testnet wallet
  connected as the agent/owner they execute live.
- **Wallet**: connect a testnet wallet (MyNearWallet) to sign live spends
  as the agent or pause/unpause as the owner.

## Details

See [NOTES.md](NOTES.md) for the near-api-js version/CDN, what is live vs
placeholder, contract-source confirmations, and what is still blocking.
