// In-memory storage with file persistence (same pattern as TradingAnalysis):
// no Postgres for now, per instruction. Survives a simple process restart
// (idle spin-down/crash) via a local JSON snapshot; does NOT survive a fresh
// deploy (new container has no disk history) — that needs a real DB later.

const fs = require('fs');
const path = require('path');

const PLANS = {
  starter: { label: 'Starter', price: 49, tailorLimit: 5 },
  pro: { label: 'Pro', price: 69, tailorLimit: 20 },
  premium: { label: 'Premium', price: 89, tailorLimit: Infinity },
};

function createStore() {
  const subscribers = new Map(); // email -> { email, status, plan, expires_at, created_at, password_hash, tailorCount, tailorPeriodStart }
  const sessions = new Map(); // token -> email

  const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '.demo-data.json');
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.writeFileSync(DATA_FILE, JSON.stringify({
          subscribers: [...subscribers.entries()],
          sessions: [...sessions.entries()],
        }));
      } catch (e) { console.error('[storage] persist failed (non-fatal):', e.message); }
    }, 200);
  }
  function load() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      (data.subscribers || []).forEach(([k, v]) => subscribers.set(k, v));
      (data.sessions || []).forEach(([k, v]) => sessions.set(k, v));
      console.log(`[storage] restored ${subscribers.size} account(s), ${sessions.size} session(s) from ${DATA_FILE}`);
    } catch (e) { console.error('[storage] load failed (non-fatal):', e.message); }
  }

  function isActive(sub) {
    return !!(sub && sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) > new Date());
  }

  return {
    async init() { load(); },

    async setPassword(email, passwordHash) {
      const existing = subscribers.get(email);
      if (existing) existing.password_hash = passwordHash;
      else subscribers.set(email, { email, status: 'pending', plan: null, expires_at: null, created_at: new Date().toISOString(), password_hash: passwordHash, tailorCount: 0, tailorPeriodStart: new Date().toISOString() });
      scheduleSave();
    },
    async createSession(token, email) { sessions.set(token, email); scheduleSave(); },
    async getSessionEmail(token) { return sessions.get(token) || null; },
    async deleteSession(token) { sessions.delete(token); scheduleSave(); },

    async getSubscriber(email) { return subscribers.get(email) || null; },
    async upsertPending(email) {
      if (!subscribers.has(email)) {
        subscribers.set(email, { email, status: 'pending', plan: null, expires_at: null, created_at: new Date().toISOString(), tailorCount: 0, tailorPeriodStart: new Date().toISOString() });
        scheduleSave();
      }
    },
    async activate(email, days, plan) {
      const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const existing = subscribers.get(email);
      subscribers.set(email, {
        ...existing,
        email, status: 'active', plan: plan || existing?.plan || 'starter', expires_at: expires,
        created_at: existing?.created_at || new Date().toISOString(),
        tailorCount: 0, tailorPeriodStart: new Date().toISOString(), // fresh quota on (re)activation
      });
      scheduleSave();
    },
    async deactivate(email) {
      const s = subscribers.get(email);
      if (s) { s.status = 'inactive'; scheduleSave(); }
    },
    async listSubscribers() {
      return [...subscribers.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    },

    // Monthly tailoring quota per plan. Resets automatically 30 days after
    // the last reset, independent of admin/PayPal activation timing.
    async checkAndConsumeTailorQuota(email) {
      const sub = subscribers.get(email);
      if (!isActive(sub)) return { allowed: false, reason: 'no_active_plan' };
      const plan = PLANS[sub.plan] || PLANS.starter;
      const periodStart = new Date(sub.tailorPeriodStart || sub.created_at);
      if (Date.now() - periodStart.getTime() > 30 * 24 * 60 * 60 * 1000) {
        sub.tailorCount = 0;
        sub.tailorPeriodStart = new Date().toISOString();
      }
      if (sub.tailorCount >= plan.tailorLimit) return { allowed: false, reason: 'quota_exceeded', limit: plan.tailorLimit };
      sub.tailorCount += 1;
      scheduleSave();
      return { allowed: true, used: sub.tailorCount, limit: plan.tailorLimit };
    },

    isActive,
  };
}

module.exports = { createStore, PLANS };
