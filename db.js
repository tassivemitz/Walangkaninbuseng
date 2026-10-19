const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'store.json');

const CODE_ACTIVATION_POOL_CREDIT = 20;
const TRADEIN_POOL_RATE = 0.05;

const PROFIT_SHARE_TIERS = [
  { shares: 1, income: 8000, directs: 18, group: 88000 },
  { shares: 2, income: 28000, directs: 38, group: 188000 },
  { shares: 3, income: 48000, directs: 58, group: 288000 },
  { shares: 4, income: 88000, directs: 78, group: 388000 },
  { shares: 5, income: 128000, directs: 98, group: 588000 },
  { shares: 6, income: 168000, directs: 118, group: 788000 },
  { shares: 7, income: 208000, directs: 138, group: 988000 },
  { shares: 8, income: 258000, directs: 158, group: 1188000 },
  { shares: 9, income: 308000, directs: 178, group: 1388000 },
  { shares: 10, income: 368000, directs: 208, group: 1588000 },
];

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function emptyStore() {
  return {
    nextId: {
      users: 1,
      tradein_packages: 1,
      withdrawals: 1,
      code_vault: 1,
      earnings_history: 1,
      load_wallet_requests: 1,
      profit_sharing_disbursements: 1,
    },
    users: [],
    wallets: [],
    binary_tree: [],
    tradein_packages: [],
    withdrawals: [],
    code_vault: [],
    earnings_history: [],
    load_wallet_requests: [],
    profit_sharing_disbursements: [],
    profit_sharing_pool: { total_amount: 0.00 },
    settings: { weekly_payout_enabled: 0, binary_cap: 3000, max_tradein_slots: 5 },
  };
}

let store = emptyStore();
let queue = Promise.resolve();

function getActiveTradeInAmount(userId, data = store) {
  return money(
    (data.tradein_packages || [])
      .filter((p) => Number(p.user_id) === Number(userId) && p.cycle_status === 'active')
      .reduce((sum, p) => sum + Number(p.capital || 0), 0)
  );
}

function getVerifiedTotalIncome(userId, data = store) {
  const wallet = (data.wallets || []).find((w) => Number(w.user_id) === Number(userId));
  const walletTotal = wallet
    ? Number(wallet.binary_ref_balance || 0)
      + Number(wallet.tradein_ref_balance || 0)
      + Number(wallet.tradein_cycle_balance || 0)
      + Number(wallet.profit_sharing_balance || 0)
    : 0;
  const withdrawn = (data.withdrawals || [])
    .filter((w) => Number(w.user_id) === Number(userId) && w.status === 'approved')
    .reduce((sum, w) => sum + Number(w.amount || 0), 0);
  return money(walletTotal + withdrawn);
}

function getReferralParentId(user, data = store) {
  if (user && user.parent_id) return Number(user.parent_id);
  const tree = (data.binary_tree || []).find((t) => Number(t.user_id) === Number(user && user.id));
  return tree && tree.sponsor_id ? Number(tree.sponsor_id) : null;
}

function getDirectDownlines(userId, data = store) {
  const uid = Number(userId);
  return (data.users || []).filter((u) => Number(getReferralParentId(u, data)) === uid);
}

function countDirectActiveAccounts(userId, data = store) {
  return getDirectDownlines(userId, data).filter((u) => u.status === 'active').length;
}

function getGroupSaleTradeInAmount(userId, data = store) {
  const uid = Number(userId);
  let total = 0;
  const visited = new Set();
  const walk = (id) => {
    const nid = Number(id);
    if (visited.has(nid)) return;
    visited.add(nid);
    const children = getDirectDownlines(nid, data);
    for (const child of children) {
      total += getActiveTradeInAmount(child.id, data);
      walk(child.id);
    }
  };
  walk(uid);
  return money(total);
}

function getProfitShareQualification(userId, data = store) {
  const user = (data.users || []).find((u) => Number(u.id) === Number(userId));
  const income = getVerifiedTotalIncome(userId, data);
  const directs = countDirectActiveAccounts(userId, data);
  const group = getGroupSaleTradeInAmount(userId, data);
  let shares = 0;
  for (const tier of PROFIT_SHARE_TIERS) {
    if (income >= tier.income && directs >= tier.directs && group >= tier.group) {
      shares = tier.shares;
    }
  }
  return {
    user_id: Number(userId),
    username: user ? (user.username || user.mobile_number) : '',
    status: user ? user.status : null,
    verified_income: income,
    direct_active_accounts: directs,
    group_sale_trade_in: group,
    active_trade_in: getActiveTradeInAmount(userId, data),
    shares,
    qualified: shares > 0,
  };
}

function listQualifiedMembers(data = store) {
  return (data.users || [])
    .filter((u) => u.role !== 'admin' && u.status !== 'banned')
    .map((u) => getProfitShareQualification(u.id, data))
    .filter((q) => q.qualified)
    .sort((a, b) => b.shares - a.shares || a.user_id - b.user_id);
}

function ingestProfitSharing(data, amount) {
  if (!data.profit_sharing_pool) data.profit_sharing_pool = { total_amount: 0.00 };
  const credit = money(amount);
  if (credit <= 0) return money(data.profit_sharing_pool.total_amount || 0);
  data.profit_sharing_pool.total_amount = money(Number(data.profit_sharing_pool.total_amount || 0) + credit);
  return data.profit_sharing_pool.total_amount;
}

function ingestCodeActivationPool(data) {
  return ingestProfitSharing(data, CODE_ACTIVATION_POOL_CREDIT);
}

function ingestTradeinEntryPool(data, capital) {
  return ingestProfitSharing(data, money(Number(capital || 0) * TRADEIN_POOL_RATE));
}

function findUserByExactUsername(data, rawTarget) {
  const target = String(rawTarget || '').trim();
  if (!target) return null;
  const needle = target.toLowerCase();
  const users = data.users || [];

  const byUsername = users.find((u) => {
    const username = String(u.username || '').trim().toLowerCase();
    return Boolean(username) && username === needle;
  });
  if (byUsername) return byUsername;

  const byMobile = users.find((u) => {
    const mobile = String(u.mobile_number || '').trim().toLowerCase();
    return Boolean(mobile) && mobile === needle;
  });
  if (byMobile) return byMobile;

  const idRaw = target.startsWith('#') ? target.slice(1).trim() : target;
  if (/^\d+$/.test(idRaw)) {
    return users.find((u) => String(u.id) === idRaw) || null;
  }
  return null;
}

function syncUserDownlineFields(user, data = store) {
  if (!user) return user;
  const tree = (data.binary_tree || []).find((t) => Number(t.user_id) === Number(user.id));
  if (user.parent_id == null && tree && tree.sponsor_id) {
    user.parent_id = tree.sponsor_id;
  }
  user.active_trade_in = getActiveTradeInAmount(user.id, data);
  user.verified_income = getVerifiedTotalIncome(user.id, data);
  return user;
}

function ensureStoreShape(data = store) {
  const blank = emptyStore();
  if (!data.nextId) data.nextId = {};
  Object.assign(data.nextId, Object.assign({}, blank.nextId, data.nextId));
  if (!Array.isArray(data.profit_sharing_disbursements)) data.profit_sharing_disbursements = [];
  if (!data.profit_sharing_pool || typeof data.profit_sharing_pool !== 'object') {
    data.profit_sharing_pool = { total_amount: 0.00 };
  }
  if (data.profit_sharing_pool.total_amount == null) data.profit_sharing_pool.total_amount = 0.00;
  (data.wallets || []).forEach((w) => {
    if (w.profit_sharing_balance == null) w.profit_sharing_balance = 0;
  });
  (data.users || []).forEach((u) => syncUserDownlineFields(u, data));
  return data;
}

function load() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  if (!fs.existsSync(FILE)) {
    persist();
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  store = Object.assign(emptyStore(), parsed);
  store.nextId = Object.assign(emptyStore().nextId, parsed.nextId || {});
  store.settings = Object.assign(emptyStore().settings, parsed.settings || {});
  if (!Array.isArray(store.earnings_history)) store.earnings_history = [];
  if (!Array.isArray(store.load_wallet_requests)) store.load_wallet_requests = [];
  if (!store.settings.binary_cap) store.settings.binary_cap = 3000;
  if (!store.settings.max_tradein_slots) store.settings.max_tradein_slots = 5;
  ensureStoreShape(store);
}

function persist() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, FILE);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tx(fn) {
  const run = queue.then(async () => {
    const snapshot = clone(store);
    try {
      ensureStoreShape(store);
      const result = await fn(store);
      persist();
      return result;
    } catch (err) {
      store = snapshot;
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}

function insert(table, row) {
  const id = store.nextId[table];
  store.nextId[table] = id + 1;
  const rec = { id, ...row };
  store[table].push(rec);
  return rec;
}

function find(table, pred) {
  return store[table].find(pred) || null;
}

function filter(table, pred) {
  return store[table].filter(pred);
}

load();

module.exports = {
  FILE,
  load,
  tx,
  insert,
  find,
  filter,
  getStore: () => store,
  clone,
  money,
  PROFIT_SHARE_TIERS,
  CODE_ACTIVATION_POOL_CREDIT,
  TRADEIN_POOL_RATE,
  getActiveTradeInAmount,
  getVerifiedTotalIncome,
  countDirectActiveAccounts,
  getGroupSaleTradeInAmount,
  getProfitShareQualification,
  listQualifiedMembers,
  ingestProfitSharing,
  ingestCodeActivationPool,
  ingestTradeinEntryPool,
  findUserByExactUsername,
  syncUserDownlineFields,
  ensureStoreShape,
};
