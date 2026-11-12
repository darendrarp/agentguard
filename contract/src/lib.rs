//! AgentGuard — policy-guarded agent vault.
//!
//! An AI agent holds a wallet; this contract holds NEAR and enforces a
//! spending policy on-chain. The agent may only spend within the owner's
//! policy: per-transaction cap, daily cap, receiver allowlist, plus a
//! minimum balance reserve. Every spend decision (allowed or denied) is
//! recorded in an on-chain log and emitted as a NEP-297 JSON event.
//!
//! Policy denials return a [`SpendResult`] with `allowed: false` — they
//! never panic, so the decision log entry is not rolled back.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, near_bindgen, AccountId, NearToken, PanicOnDefault, Promise};

/// Nanoseconds in one day.
const NS_PER_DAY: u64 = 86_400_000_000_000;
/// Minimum balance the contract must keep after a spend (0.1 NEAR, in yocto).
const RESERVE_YOCTO: u128 = 100_000_000_000_000_000_000_000;
/// Maximum number of decisions kept in the on-chain log.
const MAX_LOG_ENTRIES: usize = 100;

/// One recorded spend decision.
#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Decision {
    pub day: u64,
    pub receiver: AccountId,
    pub amount: U128,
    pub allowed: bool,
    pub reason: String,
    pub timestamp: u64,
}

/// Result of a `spend` call. Returned (not panicked) for every policy
/// decision so the decision log entry survives.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct SpendResult {
    pub allowed: bool,
    pub reason: String,
    pub amount: U128,
}

/// Current policy (view).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Policy {
    pub max_per_tx: U128,
    pub daily_limit: U128,
    pub allowlist: Vec<AccountId>,
    pub paused: bool,
}

/// Current vault status (view).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Status {
    pub owner: AccountId,
    pub agent: AccountId,
    pub balance: U128,
    pub paused: bool,
    pub spent_today: U128,
    pub remaining_today: U128,
    pub day: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Guard {
    owner: AccountId,
    agent: AccountId,
    max_per_tx: u128,
    daily_limit: u128,
    allowlist: Vec<AccountId>,
    paused: bool,
    /// Day (UTC, since epoch) that `spent_today` belongs to.
    current_day: u64,
    /// YoctoNEAR spent on `current_day`.
    spent_today: u128,
    /// Decision log, oldest first; capped at MAX_LOG_ENTRIES.
    log: Vec<Decision>,
}

fn current_day() -> u64 {
    env::block_timestamp() / NS_PER_DAY
}

#[near_bindgen]
impl Guard {
    #[init]
    pub fn init(
        owner: AccountId,
        agent: AccountId,
        max_per_tx: U128,
        daily_limit: U128,
        allowlist: Vec<AccountId>,
    ) -> Self {
        Self {
            owner,
            agent,
            max_per_tx: max_per_tx.0,
            daily_limit: daily_limit.0,
            allowlist,
            paused: false,
            current_day: current_day(),
            spent_today: 0,
            log: Vec::new(),
        }
    }

    /// Attempt a policy-guarded spend. Only the agent may call this.
    /// Returns a [`SpendResult`] for every outcome; never panics on a
    /// policy denial.
    pub fn spend(&mut self, receiver: AccountId, amount: U128) -> SpendResult {
        let day = current_day();
        self.rollover_if_needed(day);
        let amount_yocto = amount.0;

        // (1) caller must be the agent
        if env::predecessor_account_id() != self.agent {
            return self.decide(day, receiver, amount, false, "not_agent");
        }
        // (2) not paused
        if self.paused {
            return self.decide(day, receiver, amount, false, "paused");
        }
        // (3) per-transaction cap
        if amount_yocto > self.max_per_tx {
            return self.decide(day, receiver, amount, false, "over_max_per_tx");
        }
        // (4) receiver allowlist
        if !self.allowlist.contains(&receiver) {
            return self.decide(day, receiver, amount, false, "receiver_not_allowlisted");
        }
        // (5) daily cap
        if self.spent_today.saturating_add(amount_yocto) > self.daily_limit {
            return self.decide(day, receiver, amount, false, "over_daily_limit");
        }
        // (6) balance must cover amount + reserve
        let balance = env::account_balance().as_yoctonear();
        if balance < amount_yocto.saturating_add(RESERVE_YOCTO) {
            return self.decide(day, receiver, amount, false, "insufficient_balance");
        }

        // Allowed: update state, transfer, log.
        self.spent_today = self.spent_today.saturating_add(amount_yocto);
        Promise::new(receiver.clone())
            .transfer(NearToken::from_yoctonear(amount_yocto))
            .detach();
        self.decide(day, receiver, amount, true, "allowed")
    }

    /// Record a decision in the bounded log and emit a NEP-297 event.
    /// Returns the SpendResult for the caller.
    fn decide(
        &mut self,
        day: u64,
        receiver: AccountId,
        amount: U128,
        allowed: bool,
        reason: &str,
    ) -> SpendResult {
        let decision = Decision {
            day,
            receiver: receiver.clone(),
            amount,
            allowed,
            reason: reason.to_string(),
            timestamp: env::block_timestamp(),
        };
        self.log.push(decision);
        if self.log.len() > MAX_LOG_ENTRIES {
            let excess = self.log.len() - MAX_LOG_ENTRIES;
            self.log.drain(..excess);
        }
        // NEP-297 JSON event.
        env::log_str(&format!(
            "EVENT_JSON:{{\"standard\":\"agentguard\",\"version\":\"1.0.0\",\"event\":\"spend_decision\",\"data\":{{\"day\":{},\"receiver\":\"{}\",\"amount\":\"{}\",\"allowed\":{},\"reason\":\"{}\",\"timestamp\":{}}}}}",
            day,
            receiver,
            amount.0,
            allowed,
            reason,
            env::block_timestamp(),
        ));
        SpendResult {
            allowed,
            reason: reason.to_string(),
            amount,
        }
    }

    fn rollover_if_needed(&mut self, day: u64) {
        if day != self.current_day {
            self.current_day = day;
            self.spent_today = 0;
        }
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner,
            "not_owner"
        );
    }

    // ---- Owner-only ----

    pub fn set_policy(
        &mut self,
        max_per_tx: U128,
        daily_limit: U128,
        allowlist: Vec<AccountId>,
    ) {
        self.assert_owner();
        self.max_per_tx = max_per_tx.0;
        self.daily_limit = daily_limit.0;
        self.allowlist = allowlist;
    }

    pub fn set_agent(&mut self, new_agent: AccountId) {
        self.assert_owner();
        self.agent = new_agent;
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
    }

    /// Accept attached NEAR (owner-only). No-op otherwise; the deposit
    /// simply stays in the contract balance.
    #[payable]
    pub fn deposit(&mut self) {
        self.assert_owner();
    }

    // ---- Views ----

    pub fn get_policy(&self) -> Policy {
        Policy {
            max_per_tx: U128(self.max_per_tx),
            daily_limit: U128(self.daily_limit),
            allowlist: self.allowlist.clone(),
            paused: self.paused,
        }
    }

    pub fn get_status(&self) -> Status {
        let day = current_day();
        // Effective spent today: 0 if the day has rolled over since the
        // last state write.
        let spent_today = if day == self.current_day {
            self.spent_today
        } else {
            0
        };
        let remaining_today = self.daily_limit.saturating_sub(spent_today);
        Status {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            balance: U128(env::account_balance().as_yoctonear()),
            paused: self.paused,
            spent_today: U128(spent_today),
            remaining_today: U128(remaining_today),
            day,
        }
    }

    /// Most recent decisions first, up to `limit`.
    pub fn get_log(&self, limit: u32) -> Vec<Decision> {
        self.log
            .iter()
            .rev()
            .take(limit as usize)
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const DAY_NS: u64 = NS_PER_DAY;

    fn owner() -> AccountId {
        "owner.testnet".parse().unwrap()
    }
    fn agent() -> AccountId {
        "agent.testnet".parse().unwrap()
    }
    fn shop() -> AccountId {
        "shop.testnet".parse().unwrap()
    }
    fn stranger() -> AccountId {
        "stranger.testnet".parse().unwrap()
    }

    fn set_ctx(predecessor: AccountId, balance: u128, timestamp: u64) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(predecessor)
            .account_balance(NearToken::from_yoctonear(balance))
            .block_timestamp(timestamp);
        testing_env!(ctx.build());
    }

    fn setup() -> Guard {
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        Guard::init(
            owner(),
            agent(),
            U128(ONE_NEAR),
            U128(5 * ONE_NEAR),
            vec![shop(), owner()],
        )
    }

    fn as_agent(balance: u128, timestamp: u64) {
        set_ctx(agent(), balance, timestamp);
    }

    #[test]
    fn allow_path() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR / 2));
        assert!(r.allowed);
        assert_eq!(r.reason, "allowed");
        assert_eq!(r.amount, U128(ONE_NEAR / 2));
        assert_eq!(g.spent_today, ONE_NEAR / 2);
        let status = g.get_status();
        assert_eq!(status.spent_today, U128(ONE_NEAR / 2));
        assert_eq!(status.remaining_today, U128(5 * ONE_NEAR - ONE_NEAR / 2));
        // Log recorded.
        let log = g.get_log(10);
        assert_eq!(log.len(), 1);
        assert!(log[0].allowed);
        assert_eq!(log[0].receiver, shop());
    }

    #[test]
    fn deny_not_agent() {
        let mut g = setup();
        set_ctx(stranger(), 10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR / 2));
        assert!(!r.allowed);
        assert_eq!(r.reason, "not_agent");
        assert_eq!(g.spent_today, 0);
        // Denial is still logged.
        assert_eq!(g.get_log(10).len(), 1);
    }

    #[test]
    fn deny_paused() {
        let mut g = setup();
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        g.pause();
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR / 2));
        assert!(!r.allowed);
        assert_eq!(r.reason, "paused");
    }

    #[test]
    fn pause_unpause_roundtrip() {
        let mut g = setup();
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        g.pause();
        assert!(g.get_policy().paused);
        g.unpause();
        assert!(!g.get_policy().paused);
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR / 2));
        assert!(r.allowed);
    }

    #[test]
    fn deny_over_max_per_tx() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR + 1));
        assert!(!r.allowed);
        assert_eq!(r.reason, "over_max_per_tx");
        // Exactly at the cap is allowed.
        let r2 = g.spend(shop(), U128(ONE_NEAR));
        assert!(r2.allowed);
    }

    #[test]
    fn deny_receiver_not_allowlisted() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(stranger(), U128(ONE_NEAR / 2));
        assert!(!r.allowed);
        assert_eq!(r.reason, "receiver_not_allowlisted");
    }

    #[test]
    fn allowlist_enforcement_via_set_policy() {
        let mut g = setup();
        // Owner removes shop from the allowlist.
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        g.set_policy(U128(ONE_NEAR), U128(5 * ONE_NEAR), vec![owner()]);
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR / 2));
        assert!(!r.allowed);
        assert_eq!(r.reason, "receiver_not_allowlisted");
        // Owner is still allowlisted.
        let r2 = g.spend(owner(), U128(ONE_NEAR / 2));
        assert!(r2.allowed);
    }

    #[test]
    fn deny_over_daily_limit() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        // Spend the full daily limit in 5 x 1 NEAR.
        for _ in 0..5 {
            let r = g.spend(shop(), U128(ONE_NEAR));
            assert!(r.allowed);
        }
        let r = g.spend(shop(), U128(1));
        assert!(!r.allowed);
        assert_eq!(r.reason, "over_daily_limit");
    }

    #[test]
    fn deny_insufficient_balance() {
        let mut g = setup();
        // Balance 0.5 NEAR: amount 0.45 NEAR + 0.1 reserve > 0.5.
        as_agent(ONE_NEAR / 2, 0);
        let r = g.spend(shop(), U128(ONE_NEAR * 45 / 100));
        assert!(!r.allowed);
        assert_eq!(r.reason, "insufficient_balance");
        // Amount that leaves the reserve is allowed.
        let r2 = g.spend(shop(), U128(ONE_NEAR * 4 / 10));
        assert!(r2.allowed);
    }

    #[test]
    fn daily_reset_across_days() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        let r = g.spend(shop(), U128(ONE_NEAR));
        assert!(r.allowed);
        assert_eq!(g.spent_today, ONE_NEAR);
        // Next day: spent resets, full daily limit available again.
        as_agent(10 * ONE_NEAR, DAY_NS);
        let status = g.get_status();
        assert_eq!(status.day, 1);
        assert_eq!(status.spent_today, U128(0));
        assert_eq!(status.remaining_today, U128(5 * ONE_NEAR));
        let r2 = g.spend(shop(), U128(ONE_NEAR));
        assert!(r2.allowed);
        assert_eq!(g.spent_today, ONE_NEAR);
        assert_eq!(g.current_day, 1);
        // And the daily limit is enforced fresh on the new day.
        for _ in 0..4 {
            assert!(g.spend(shop(), U128(ONE_NEAR)).allowed);
        }
        let r3 = g.spend(shop(), U128(1));
        assert_eq!(r3.reason, "over_daily_limit");
    }

    #[test]
    #[should_panic(expected = "not_owner")]
    fn set_policy_owner_only() {
        let mut g = setup();
        set_ctx(stranger(), 10 * ONE_NEAR, 0);
        g.set_policy(U128(ONE_NEAR), U128(ONE_NEAR), vec![]);
    }

    #[test]
    #[should_panic(expected = "not_owner")]
    fn set_agent_owner_only() {
        let mut g = setup();
        set_ctx(agent(), 10 * ONE_NEAR, 0);
        g.set_agent(stranger());
    }

    #[test]
    #[should_panic(expected = "not_owner")]
    fn pause_owner_only() {
        let mut g = setup();
        set_ctx(agent(), 10 * ONE_NEAR, 0);
        g.pause();
    }

    #[test]
    #[should_panic(expected = "not_owner")]
    fn unpause_owner_only() {
        let mut g = setup();
        set_ctx(agent(), 10 * ONE_NEAR, 0);
        g.unpause();
    }

    #[test]
    #[should_panic(expected = "not_owner")]
    fn deposit_owner_only() {
        let mut g = setup();
        set_ctx(agent(), 10 * ONE_NEAR, 0);
        g.deposit();
    }

    #[test]
    fn set_agent_works() {
        let mut g = setup();
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        g.set_agent(stranger());
        // Old agent is now rejected.
        as_agent(10 * ONE_NEAR, 0);
        assert_eq!(g.spend(shop(), U128(1)).reason, "not_agent");
        // New agent can spend.
        set_ctx(stranger(), 10 * ONE_NEAR, 0);
        assert!(g.spend(shop(), U128(1)).allowed);
    }

    #[test]
    fn log_bounded_and_most_recent_first() {
        let mut g = setup();
        // 105 small spends (0.01 NEAR each = 1.05 NEAR total, within limits),
        // each on a distinct timestamp so ordering is checkable.
        for i in 0..105u64 {
            as_agent(100 * ONE_NEAR, i);
            let r = g.spend(shop(), U128(ONE_NEAR / 100));
            assert!(r.allowed, "spend {} should be allowed", i);
        }
        assert_eq!(g.log.len(), MAX_LOG_ENTRIES);
        // get_log returns most recent first; limit respected.
        let recent = g.get_log(3);
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].timestamp, 104);
        assert_eq!(recent[1].timestamp, 103);
        assert_eq!(recent[2].timestamp, 102);
        let all = g.get_log(1000);
        assert_eq!(all.len(), 100);
        // The oldest 5 decisions (timestamps 0..4) were evicted.
        assert_eq!(all[0].timestamp, 104);
        assert_eq!(all[99].timestamp, 5);
    }

    #[test]
    fn check_order_agent_before_pause() {
        // not_agent takes precedence over paused.
        let mut g = setup();
        set_ctx(owner(), 10 * ONE_NEAR, 0);
        g.pause();
        set_ctx(stranger(), 10 * ONE_NEAR, 0);
        assert_eq!(g.spend(shop(), U128(1)).reason, "not_agent");
    }

    #[test]
    fn check_order_max_before_allowlist() {
        let mut g = setup();
        as_agent(10 * ONE_NEAR, 0);
        // Over cap AND not allowlisted -> over_max_per_tx wins.
        assert_eq!(
            g.spend(stranger(), U128(ONE_NEAR + 1)).reason,
            "over_max_per_tx"
        );
    }

    #[test]
    fn get_policy_view() {
        let g = setup();
        let p = g.get_policy();
        assert_eq!(p.max_per_tx, U128(ONE_NEAR));
        assert_eq!(p.daily_limit, U128(5 * ONE_NEAR));
        assert_eq!(p.allowlist, vec![shop(), owner()]);
        assert!(!p.paused);
    }

}
