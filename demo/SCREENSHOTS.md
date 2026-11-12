# Web demo screenshots — how to capture them

No screenshots are bundled in this repo yet, because **this VM has no
headless browser** (no chromium, no playwright — checked 12 Nov 2026) and
the task brief says not to install one. Capture them on a machine with a
browser, using the steps below, and save them under `demo/screenshots/`
(or `web/screenshots/` if the web lane prefers — keep one location and note
it in the README).

## Setup

1. Make sure the contract is deployed on testnet and the vault is funded
   (see `contract/DEPLOY.md`).
2. Run the web demo locally (see `web/README.md` for the exact command and
   URL — typically `http://localhost:5173` for Vite or
   `http://localhost:3000` for Next.js), or open the deployed demo URL.
3. Use a desktop browser window at ~1280×800. Open DevTools → device
   toolbar off; normal desktop viewport.
4. Before the first screenshot, confirm the day's 5 NEAR daily limit is
   fresh — a full capture run spends ~1 NEAR of vault funds.

## Shots to capture (5)

| # | File | What to show |
|---|---|---|
| 1 | `01-dashboard.png` | Vault dashboard: balance, policy (1 NEAR/tx, 5 NEAR/day), allowlist |
| 2 | `02-blocked-stranger.png` | After "Pay 5 NEAR to stranger": BLOCKED + reason, decision-log entry |
| 3 | `03-allowed-shop.png` | After "Pay 0.5 NEAR to shop": ALLOWED + tx hash (explorer link visible) |
| 4 | `04-paused.png` | Vault paused (owner) + a blocked pay attempt with reason "paused" |
| 5 | `05-decision-log.png` | Full decision log: allowed + blocked attempts with reasons |

## Tips

- Capture the explorer page for the allowed payment as well (optional 6th
  shot): click the tx hash in shot 3 and screenshot
  `explorer.testnet.near.org/transactions/<hash>`.
- **No keys on screen.** Never screenshot a terminal showing key files,
  env vars, or seed phrases.
- PNG, and keep each file under ~1 MB if possible (resize/compress before
  committing).
- If the web demo is not ready yet, the terminal recording
  (`demo/terminal-demo.cast`) covers the same five beats — screenshots can
  wait until the web lane lands.
