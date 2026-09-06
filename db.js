const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'store.json');

function emptyStore() {
  return {
    nextId: {
      users: 1,
      tradein_packages: 1,
      withdrawals: 1,
      code_vault: 1,
      earnings_history: 1,
    },
    users: [],
    wallets: [],
    binary_tree: [],
    tradein_packages: [],
    withdrawals: [],
    code_vault: [],
    earnings_history: [],
    settings: { weekly_payout_enabled: 0, binary_cap: 6000 },
  };
}

let store = emptyStore();
let queue = Promise.resolve();

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
  if (!store.settings.binary_cap) store.settings.binary_cap = 6000;
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
};
