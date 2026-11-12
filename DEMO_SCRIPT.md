# AgentGuard — demo video script (60–90 seconds)

Target length: **~75 seconds**. One continuous screen recording of the web
demo (preferred) or the CLI demo, with voiceover. No face cam needed.
Record on testnet against the live deployment
(`guard.agentguard-adt.testnet`).

## Script

| Time | On screen | Voiceover (say this) |
|---|---|---|
| 0:00–0:08 | Web demo open on the vault dashboard: balance, policy (1 NEAR/tx, 5 NEAR/day, allowlist). | "Your AI agent has a wallet. What stops it from draining it? Nothing — until now." |
| 0:08–0:12 | — | "This is AgentGuard: a vault where the agent can only spend inside a policy you set, enforced on-chain." |
| 0:12–0:32 | Click **"Pay 5 NEAR to stranger"**. Result appears: **BLOCKED** (`over_max_per_tx`). Then **"Pay 0.5 NEAR to stranger"** → **BLOCKED** (`receiver_not_allowlisted`). Decision log gains entries. | "Watch: the agent tries to send five NEAR to a stranger. Blocked — over the one-NEAR cap. Even half a NEAR to a stranger is blocked — the address isn't allowlisted. Every attempt is logged on-chain." |
| 0:32–0:45 | Click **"Pay 2 NEAR to shop"** → BLOCKED (over max per transaction). Then **"Pay 0.5 NEAR to shop"** → **ALLOWED**, tx hash shown; click through to the testnet explorer. | "Two NEAR to the shop? Also blocked — over the one-NEAR cap. But half a NEAR to the shop goes through, and here's the transaction on the explorer." |
| 0:45–1:05 | Click **"Pause"** (owner). Click **"Pay 0.5 NEAR to shop"** → BLOCKED, reason "paused". Click **"Unpause"**, pay again → ALLOWED. | "And the kill-switch: the owner pauses the vault, every payment stops — reason: paused. Unpause, and the agent can pay again." |
| 1:05–1:15 | Decision log view: all five attempts, allowed and blocked, with reasons. End card: "AgentGuard — NEAR Hackathon — repo + demo links". | "Every attempt, allowed or blocked, is on the chain. AgentGuard: give your agent a wallet it can't drain." |

## Recording notes

- **Before recording:** make sure the vault is funded and the day's
  5 NEAR daily limit is fresh (a full run spends 1 NEAR; after ~5 runs in
  one day the "allowed" steps will block on the daily limit — that is the
  policy working, but it ruins the take). If the limit is used up, wait for
  the next UTC day or use a fresh vault.
- **Use the web demo** if it is ready; it reads better on video than a
  terminal. If the web demo is not ready, record the CLI instead:
  `asciinema rec` or plain screen capture of
  `NEAR_KEY_FILE=... node demo/cli-demo.mjs` — the script prints the same
  five beats in order.
- **Keep the explorer click-through** (step 0:30–0:45): it is the proof the
  payment is real, not a mock.
- **No keys on screen.** The CLI never prints keys; if recording the
  terminal, start recording after the env vars are set, or set them in a
  prior command that has scrolled off.
- **End card:** repo URL + demo URL + "Built at NEAR HACKATHON".

## Draft X post (human posts this — do NOT auto-post)

> AgentGuard: your AI agent gets a wallet it can't drain. On-chain policy
> on @NEARProtocol — allowlist, per-tx + daily caps, owner kill-switch.
> Built at NEAR HACKATHON. [repo URL] [demo URL] #NEARHackathon

- **Length check:** the fixed text is 177 characters. With real URLs
  (e.g. a 43-char GitHub URL + a 35-char demo URL) the post is 257
  characters — under the 280 limit. Under X's t.co counting every URL
  counts as 23 characters, so any reasonable pair of URLs fits.
- **Fill in before posting:** `[repo URL]` = https://github.com/darendrarp/agentguard, `[demo URL]` = https://darendrarp.github.io/agentguard/web/ (both live since 12 Nov ~22:05 WIB).
- **Attach:** the demo video (or a link to it) + optionally a screenshot
  of the blocked-spend decision log.
