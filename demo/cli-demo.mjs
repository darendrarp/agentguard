#!/usr/bin/env node
/**
 * AgentGuard — scripted CLI demo (NEAR testnet).
 *
 * Runs the full demo end-to-end against the deployed guard contract:
 *   (a) show policy + status
 *   (b) agent tries 5 NEAR to a stranger        -> BLOCKED (over_max_per_tx;
 *       the stranger is also not allowlisted, but the per-tx cap is checked first)
 *   (b2) agent tries 0.5 NEAR to a stranger     -> BLOCKED (receiver_not_allowlisted)
 *   (c) agent tries 2 NEAR to the shop          -> BLOCKED (over 1 NEAR max_per_tx)
 *   (d) agent pays 0.5 NEAR to the shop         -> ALLOWED (tx hash + explorer link)
 *   (e) owner pauses -> agent pay blocked ("paused"); owner unpauses -> pay allowed again
 *   (f) decision log + summary table
 *
 * Keys are NEVER in this repo. The agent key is read ONLY from the file named
 * by the NEAR_KEY_FILE env var (NEAR CLI JSON format: {account_id, public_key,
 * private_key}), expected at ~/workspace/near-hackathon/keys/agent.json
 * (mode 600, outside the repo). The owner key for step (e) comes from
 * NEAR_OWNER_KEY_FILE (~/workspace/near-hackathon/keys/owner.json); if it is
 * not set, step (e) is skipped with a clear note instead of failing.
 *
 * Usage:
 *   NEAR_KEY_FILE=~/workspace/near-hackathon/keys/agent.json \
 *   NEAR_OWNER_KEY_FILE=~/workspace/near-hackathon/keys/owner.json \
 *   node cli-demo.mjs
 *
 * Optional env overrides:
 *   NEAR_CONTRACT   (default guard.agentguard-adt.testnet)
 *   NEAR_RPC        (default https://rpc.testnet.near.org)
 *   NEAR_SHOP       (default shop.agentguard-adt.testnet)
 *   NEAR_STRANGER   (default stranger.testnet)
 *
 * Requires: node >= 18, near-api-js ^7 (see package.json).
 * Testnet only. Demo spends 1 NEAR of vault funds per full run (0.5 + 0.5);
 * re-runs share the 5 NEAR/day daily limit, so after 5 runs in one day the
 * ALLOWED steps will correctly block with a daily-limit reason — that is the
 * policy working, not a bug.
 */

import fs from "node:fs";
import path from "node:path";
import {
  Account,
  JsonRpcProvider,
  parseNearAmount,
  formatNearAmount,
  getTransactionLastResult,
} from "near-api-js";

const CONTRACT = process.env.NEAR_CONTRACT || "guard.agentguard-adt.testnet";
const RPC_URL = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const EXPLORER = "https://explorer.testnet.near.org";
const SHOP = process.env.NEAR_SHOP || "shop.agentguard-adt.testnet";
const STRANGER = process.env.NEAR_STRANGER || "stranger.testnet";
// (network: testnet — see RPC_URL below)
const GAS = 30n * 10n ** 12n; // 30 TGas — plenty for a guarded transfer

const provider = new JsonRpcProvider({ url: RPC_URL });

const results = []; // { step, action, expected, got, ok, tx }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(...a) {
  console.log(...a);
}
function banner(title) {
  log("\n" + "=".repeat(72));
  log(title);
  log("=".repeat(72));
}
function yoctoToNear(y) {
  try {
    return formatNearAmount(y, 4);
  } catch {
    return String(y);
  }
}
function txLink(hash) {
  return `${EXPLORER}/transactions/${hash}`;
}

/** Read a NEAR CLI JSON key file ({account_id, public_key, private_key}). */
function loadKeyFile(envVar) {
  const file = process.env[envVar];
  if (!file) return null;
  const full = file.startsWith("~/")
    ? path.join(process.env.HOME, file.slice(2))
    : path.resolve(file);
  if (!fs.existsSync(full)) {
    throw new Error(`${envVar} points at a file that does not exist: ${full}`);
  }
  const key = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!key.account_id || !key.private_key) {
    throw new Error(`${envVar} file ${full} is not a NEAR CLI key file (need account_id + private_key)`);
  }
  return key;
}

/** Build a signing Account from a NEAR CLI key file.
 *  near-api-js v7: `new Account(accountId, provider, secretKey)` — the
 *  secret key string ("ed25519:...") is accepted directly as the signer;
 *  there is no connect()/KeyStore in v7. */
function accountFromKey(key) {
  return new Account(key.account_id, provider, key.private_key);
}

/** Decode the return value of a callFunctionRaw outcome. */
function decodeOutcome(outcome) {
  try {
    return getTransactionLastResult(outcome); // already parsed if JSON, else raw
  } catch {
    const sv = outcome?.status?.SuccessValue;
    if (sv) {
      const text = Buffer.from(sv, "base64").toString("utf8");
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return undefined;
  }
}

/** View call (no tx): provider.callFunction in near-api-js v7. */
async function view(method, args = {}) {
  return provider.callFunction({ contractId: CONTRACT, method, args });
}

/** Change call: returns { result, hash } — result is the contract's
 *  returned decision object, hash is the tx hash for the explorer link. */
async function call(account, methodName, args = {}) {
  const outcome = await account.callFunctionRaw({
    contractId: CONTRACT,
    methodName,
    args,
    gas: GAS,
    deposit: 0n,
  });
  return { outcome, result: decodeOutcome(outcome), hash: outcome.transaction.hash };
}

async function trySpend(account, label, receiver, nearAmount, expect) {
  const amount = parseNearAmount(String(nearAmount));
  log(`\n  Agent calls spend(receiver="${receiver}", amount=${nearAmount} NEAR) ...`);
  const { result, hash } = await call(account, "spend", { receiver, amount });
  const allowed = result?.allowed === true;
  const reason = result?.reason ?? "(no reason returned)";
  const verdict = allowed ? "ALLOWED ✅" : "BLOCKED ⛔";
  log(`  -> ${verdict}  reason: "${reason}"`);
  log(`     tx: ${txLink(hash)}`);
  const ok = expect === undefined ? true : allowed === expect;
  results.push({ step: label, action: `${nearAmount} NEAR -> ${receiver}`, expected: expect === undefined ? "-" : expect ? "ALLOWED" : "BLOCKED", got: allowed ? "ALLOWED" : "BLOCKED", reason, ok, tx: hash });
  return { allowed, reason, hash };
}

/** Pause/unpause: method names are not in the frozen interface, so try the
 *  common names in order (pause/unpause, then set_paused) and report which
 *  one the deployed contract actually has. */
async function trySetPaused(ownerAccount, paused) {
  const attempts = paused
    ? [
        ["pause", {}],
        ["set_paused", { paused: true }],
      ]
    : [
        ["unpause", {}],
        ["set_paused", { paused: false }],
      ];
  let lastErr = null;
  for (const [method, args] of attempts) {
    try {
      const { hash } = await call(ownerAccount, method, args);
      return { method, hash };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      if (!/MethodNotFound|method not found|MethodResolveError/i.test(msg)) throw e;
      // Method does not exist on this contract — try the next name.
    }
  }
  throw new Error(
    `no pause method found on ${CONTRACT} (tried ${attempts.map((a) => a[0]).join(", ")}): ${lastErr?.message ?? lastErr}`,
  );
}

async function main() {
  banner("AgentGuard — CLI demo (NEAR testnet)");
  log(`Contract : ${CONTRACT}`);
  log(`Explorer : ${EXPLORER}/accounts/${CONTRACT}`);
  log(`RPC      : ${RPC_URL}`);

  const agentKey = loadKeyFile("NEAR_KEY_FILE");
  if (!agentKey) {
    log("\nERROR: NEAR_KEY_FILE is not set.");
    log("  Set it to the agent key file (outside the repo), e.g.:");
    log("    NEAR_KEY_FILE=~/workspace/near-hackathon/keys/agent.json node cli-demo.mjs");
    process.exit(2);
  }
  const ownerKey = loadKeyFile("NEAR_OWNER_KEY_FILE"); // optional; step (e) only
  log(`Agent    : ${agentKey.account_id}  (key from $NEAR_KEY_FILE)`);
  log(`Owner    : ${ownerKey ? `${ownerKey.account_id} (key from $NEAR_OWNER_KEY_FILE)` : "(no owner key — pause step will be skipped)"}`);
  log(`Shop     : ${SHOP}`);

  const agent = accountFromKey(agentKey);

  // ---- (a) policy + status -------------------------------------------------
  banner("(a) Policy + status — what the vault allows");
  let policy;
  try {
    policy = await view("get_policy");
  } catch (e) {
    log("\nERROR: cannot read the contract. Is it deployed yet?");
    log(`  ${e.message ?? e}`);
    log(`  Check contract/DEPLOY.md, or run: curl ${RPC_URL} (view_account ${CONTRACT})`);
    process.exit(2);
  }
  const status = await view("get_status");
  log("\n  Policy (get_policy):");
  log(`    max_per_tx   : ${yoctoToNear(policy.max_per_tx)} NEAR`);
  log(`    daily_limit  : ${yoctoToNear(policy.daily_limit)} NEAR`);
  log(`    allowlist    : ${JSON.stringify(policy.allowlist)}`);
  log(`    paused       : ${policy.paused}`);
  log("\n  Status (get_status):");
  log(`    owner        : ${status.owner}`);
  log(`    agent        : ${status.agent}`);
  log(`    vault balance: ${yoctoToNear(status.balance)} NEAR`);
  log(`    paused       : ${status.paused}`);
  log(`    spent_today  : ${yoctoToNear(status.spent_today)} NEAR (day ${status.day})`);
  log(`    remaining    : ${yoctoToNear(status.remaining_today)} NEAR`);

  if (status.paused) {
    log("\n  NOTE: the vault is currently PAUSED — steps (b)-(d) would all block.");
    log("  Unpause it first (owner), or run the demo again after step (e).");
  }

  // ---- (b) 5 NEAR to a stranger --------------------------------------------
  banner("(b) Agent tries 5 NEAR to a stranger — expect BLOCKED");
  log("  A compromised / prompt-injected agent tries to drain the vault to an");
  log(`  address that is not on the allowlist: ${STRANGER}`);
  log("  (The contract checks the per-tx cap before the allowlist, so the");
  log("  reason will be \"over_max_per_tx\" — the stranger fails both checks.)");
  await trySpend(agent, "(b)", STRANGER, 5, false);
  await sleep(500);

  // ---- (b2) 0.5 NEAR to a stranger — the allowlist check on its own -------
  banner("(b2) Agent tries 0.5 NEAR to a stranger — expect BLOCKED (allowlist)");
  log("  Under the per-tx cap this time, so the allowlist is what stops it:");
  log("  reason should be \"receiver_not_allowlisted\".");
  await trySpend(agent, "(b2)", STRANGER, 0.5, false);
  await sleep(500);

  // ---- (c) 2 NEAR to the shop ----------------------------------------------
  banner("(c) Agent tries 2 NEAR to the shop — expect BLOCKED (over max_per_tx)");
  log(`  ${SHOP} IS allowlisted, but 2 NEAR exceeds max_per_tx (1 NEAR).`);
  await trySpend(agent, "(c)", SHOP, 2, false);
  await sleep(500);

  // ---- (d) 0.5 NEAR to the shop --------------------------------------------
  banner("(d) Agent pays 0.5 NEAR to the shop — expect ALLOWED");
  log("  Within policy: allowlisted receiver, under max_per_tx, under daily limit.");
  const d = await trySpend(agent, "(d)", SHOP, 0.5, true);
  if (d.allowed) {
    log(`\n  ✅ Payment landed. Verify on the explorer: ${txLink(d.hash)}`);
  } else {
    log(`\n  ⚠️  Expected ALLOWED but got BLOCKED ("${d.reason}").`);
    log("     Most likely cause: the 5 NEAR/day daily limit was already used by an");
    log("     earlier demo run today (each full run spends 1 NEAR). That is the");
    log("     policy working — wait for the next UTC day or use a fresh vault.");
  }
  await sleep(500);

  // ---- (e) pause kill-switch ------------------------------------------------
  banner("(e) Owner kill-switch: pause -> blocked, unpause -> allowed again");
  if (!ownerKey) {
    log("\n  SKIPPED: NEAR_OWNER_KEY_FILE is not set, so this demo cannot act as the owner.");
    log("  Set NEAR_OWNER_KEY_FILE=~/workspace/near-hackathon/keys/owner.json and re-run");
    log("  to see the pause kill-switch live.");
    results.push({ step: "(e)", action: "owner pause / unpause", expected: "BLOCKED then ALLOWED", got: "SKIPPED (no owner key)", reason: "NEAR_OWNER_KEY_FILE unset", ok: null, tx: "-" });
  } else {
    const owner = accountFromKey(ownerKey);
    try {
      log(`\n  Owner (${ownerKey.account_id}) pauses the vault ...`);
      const p = await trySetPaused(owner, true);
      log(`  -> paused via ${p.method}()  tx: ${txLink(p.hash)}`);
      await sleep(800);
      const st = await view("get_status");
      log(`  get_status.paused = ${st.paused}`);

      log("\n  Agent tries to pay 0.5 NEAR while paused — expect BLOCKED (\"paused\"):");
      const blocked = await trySpend(agent, "(e1)", SHOP, 0.5, false);
      if (!blocked.allowed && !/paus/i.test(blocked.reason)) {
        log(`  ⚠️  Blocked, but the reason was "${blocked.reason}" instead of "paused".`);
      }

      log(`\n  Owner unpauses the vault ...`);
      const u = await trySetPaused(owner, false);
      log(`  -> unpaused via ${u.method}()  tx: ${txLink(u.hash)}`);
      await sleep(800);
      const st2 = await view("get_status");
      log(`  get_status.paused = ${st2.paused}`);

      log("\n  Agent pays 0.5 NEAR again — expect ALLOWED:");
      await trySpend(agent, "(e2)", SHOP, 0.5, true);
    } catch (e) {
      log(`\n  ⚠️  Pause step failed: ${e.message ?? e}`);
      log("     The contract may use different pause method names than pause/unpause");
      log("     or set_paused — see contract/DEPLOY.md for the deployed interface.");
      results.push({ step: "(e)", action: "owner pause / unpause", expected: "BLOCKED then ALLOWED", got: "FAILED", reason: String(e.message ?? e).slice(0, 80), ok: false, tx: "-" });
    }
  }

  // ---- (f) decision log ------------------------------------------------------
  banner("(f) Decision log — every attempt is on-chain (get_log)");
  try {
    const entries = await view("get_log", { limit: 10 });
    if (!entries || entries.length === 0) {
      log("\n  (log is empty)");
    } else {
      for (const e of entries) {
        const when = e.timestamp
          ? new Date(Number(BigInt(e.timestamp) / 1_000_000n)).toISOString()
          : "?";
        log(
          `  ${e.allowed ? "ALLOWED ✅" : "BLOCKED ⛔"}  ${yoctoToNear(e.amount)} NEAR -> ${e.receiver}  ` +
            `| ${e.reason}  | day ${e.day} | ${when}`,
        );
      }
    }
  } catch (e) {
    log(`  (could not read log: ${e.message ?? e})`);
  }

  // ---- summary ---------------------------------------------------------------
  banner("Summary");
  const rows = results.map((r) => ({
    Step: r.step,
    Action: r.action,
    Expected: r.expected,
    Got: r.got,
    "Reason / note": r.reason,
    OK: r.ok === null ? "SKIP" : r.ok ? "PASS" : "FAIL",
  }));
  console.table(rows);
  const fails = results.filter((r) => r.ok === false).length;
  const skips = results.filter((r) => r.ok === null).length;
  log(`\nVault: ${EXPLORER}/accounts/${CONTRACT}`);
  if (fails === 0 && skips === 0) {
    log("Demo result: all steps behaved as expected. ✅");
  } else if (fails === 0) {
    log(`Demo result: no failures, ${skips} step(s) skipped (see above).`);
  } else {
    log(`Demo result: ${fails} step(s) did NOT behave as expected — see FAIL rows above.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nFATAL:", e?.message ?? e);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
