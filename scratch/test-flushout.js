/**
 * Simulation Test: Binary Pairing Daily Cap Safety Net & Flush Out
 */
const assert = require('assert');

// Mock data store
function createMockData() {
  return {
    users: [
      { id: 1, username: 'TestRoot', role: 'admin', status: 'active', total_binary_earnings: 0 },
    ],
    wallets: [
      { user_id: 1, binary_ref_balance: 0, tradein_ref_balance: 0, tradein_cycle_balance: 0 },
    ],
    binary_tree: [
      { user_id: 1, parent_id: null, sponsor_id: null, position: null, leftover_left: 0, leftover_right: 0, pairs_today: 0, last_pair_date: null }
    ],
    earnings_history: [],
    settings: { binary_cap: 6000 }
  };
}

const MAX_PAIRS_PER_DAY = 10;
const PAIR_BONUS = 50;

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function getBinaryCap(data) {
  return (data.settings && data.settings.binary_cap) || 6000;
}

function logEarning(data, { userId, category, amount, sourceUserId = null, description = '' }) {
  const amt = money(amount);
  if (amt <= 0 && category !== 'safety_net') return null;
  data.earnings_history.push({
    id: data.earnings_history.length + 1,
    user_id: userId,
    category,
    amount: amt,
    description,
    created_at: new Date().toISOString()
  });
}

function creditMatchingBonus(data, userId, amount) {
  const creditWanted = money(amount);
  if (creditWanted <= 0) return 0;
  const user = data.users.find((x) => x.id === userId);
  const wallet = data.wallets.find((x) => x.user_id === userId);
  if (!user || !wallet || user.status !== 'active') return 0;

  const cap = getBinaryCap(data);
  const earned = money(user.total_binary_earnings || 0);
  const room = money(cap - earned);
  if (room <= 0) {
    user.status = 'expired';
    return 0;
  }

  const credit = Math.min(creditWanted, room);
  user.total_binary_earnings = money(earned + credit);
  wallet.binary_ref_balance = money(wallet.binary_ref_balance + credit);
  if (user.total_binary_earnings >= cap) user.status = 'expired';

  logEarning(data, {
    userId,
    category: 'matching',
    amount: credit,
    description: 'Binary Matching / Pairing Bonus',
  });
  return credit;
}

function resetPairsIfNeeded(node, customDate = null) {
  const today = customDate || new Date().toISOString().slice(0, 10);
  const last = node.last_pair_date ? String(node.last_pair_date).slice(0, 10) : null;
  if (last !== today) {
    const excessPairs = Math.min(node.leftover_left || 0, node.leftover_right || 0);
    if (excessPairs > 0) {
      node.leftover_left = Math.max(0, (node.leftover_left || 0) - excessPairs);
      node.leftover_right = Math.max(0, (node.leftover_right || 0) - excessPairs);
    }
    node.pairs_today = 0;
    node.last_pair_date = today;
  }
}

function processPairing(data, parentId, incomingPosition, newUserId = null, customDate = null) {
  let currentId = parentId;
  let side = incomingPosition;
  const today = customDate || new Date().toISOString().slice(0, 10);

  while (currentId) {
    const node = data.binary_tree.find((x) => x.user_id === currentId);
    if (!node) break;
    resetPairsIfNeeded(node, today);
    if (side === 'L') node.leftover_left += 1;
    else node.leftover_right += 1;

    while (node.leftover_left > 0 && node.leftover_right > 0) {
      if (node.pairs_today >= MAX_PAIRS_PER_DAY) {
        node.leftover_left -= 1;
        node.leftover_right -= 1;
        node.last_pair_date = today;
        logEarning(data, {
          userId: node.user_id,
          category: 'safety_net',
          amount: 0,
          sourceUserId: newUserId,
          description: `Daily Safety Net Flush Out (Max ${MAX_PAIRS_PER_DAY} pairs/day)`,
        });
        continue;
      }

      const credited = creditMatchingBonus(data, node.user_id, PAIR_BONUS);
      if (credited <= 0) break;
      node.leftover_left -= 1;
      node.leftover_right -= 1;
      node.pairs_today += 1;
      node.last_pair_date = today;
    }

    if (!node.parent_id) break;
    side = node.position;
    currentId = node.parent_id;
  }
}

console.log('--- TEST 1: 15 Left & 15 Right on Day 1 ---');
const data1 = createMockData();
const day1 = '2026-09-09';

// Encode 15 on Left
for (let i = 1; i <= 15; i++) {
  processPairing(data1, 1, 'L', 100 + i, day1);
}
// Encode 15 on Right
for (let i = 1; i <= 15; i++) {
  processPairing(data1, 1, 'R', 200 + i, day1);
}

const node1 = data1.binary_tree[0];
const wallet1 = data1.wallets[0];
console.log(`Day 1 Results:`);
console.log(`- Pairs Today: ${node1.pairs_today} (Expected: 10)`);
console.log(`- Leftover Left: ${node1.leftover_left} (Expected: 0)`);
console.log(`- Leftover Right: ${node1.leftover_right} (Expected: 0)`);
console.log(`- Wallet Balance: ₱${wallet1.binary_ref_balance} (Expected: ₱500)`);

assert.strictEqual(node1.pairs_today, 10, 'Pairs today must be 10');
assert.strictEqual(node1.leftover_left, 0, 'Leftover left must be 0 after flush out');
assert.strictEqual(node1.leftover_right, 0, 'Leftover right must be 0 after flush out');
assert.strictEqual(wallet1.binary_ref_balance, 500, 'Wallet must have earned ₱500 (10 pairs x ₱50)');

const safetyNetLogs = data1.earnings_history.filter(e => e.category === 'safety_net');
console.log(`- Safety Net Logs: ${safetyNetLogs.length} (Expected: 5)`);
assert.strictEqual(safetyNetLogs.length, 5, 'Must have logged 5 flushed pairs in earnings_history');

console.log('\n--- TEST 2: Day 2 - Encode 1 on Left ---');
const day2 = '2026-09-10';
// Encode 1 on Left on Day 2
processPairing(data1, 1, 'L', 301, day2);

console.log(`Day 2 Results after encoding 1 on Left:`);
console.log(`- Pairs Today: ${node1.pairs_today} (Expected: 0)`);
console.log(`- Leftover Left: ${node1.leftover_left} (Expected: 1)`);
console.log(`- Leftover Right: ${node1.leftover_right} (Expected: 0)`);
console.log(`- Wallet Balance: ₱${wallet1.binary_ref_balance} (Expected: ₱500, unchanged)`);

assert.strictEqual(node1.pairs_today, 0, 'Pairs today on day 2 must be 0');
assert.strictEqual(node1.leftover_left, 1, 'Leftover left must be 1');
assert.strictEqual(node1.leftover_right, 0, 'Leftover right must be 0');
assert.strictEqual(wallet1.binary_ref_balance, 500, 'Wallet balance must remain ₱500');

console.log('\n--- TEST 3: Day 2 - Later encode 1 on Right ---');
processPairing(data1, 1, 'R', 302, day2);

console.log(`Day 2 Results after encoding 1 on Right:`);
console.log(`- Pairs Today: ${node1.pairs_today} (Expected: 1)`);
console.log(`- Leftover Left: ${node1.leftover_left} (Expected: 0)`);
console.log(`- Leftover Right: ${node1.leftover_right} (Expected: 0)`);
console.log(`- Wallet Balance: ₱${wallet1.binary_ref_balance} (Expected: ₱550)`);

assert.strictEqual(node1.pairs_today, 1, 'Pairs today must now be 1');
assert.strictEqual(node1.leftover_left, 0, 'Leftover left must be 0');
assert.strictEqual(node1.leftover_right, 0, 'Leftover right must be 0');
assert.strictEqual(wallet1.binary_ref_balance, 550, 'Wallet balance must be ₱550');

console.log('\n--- TEST 4: Strong Leg Carry-over Preservation ---');
const data2 = createMockData();
// 20 on Left
for (let i = 1; i <= 20; i++) {
  processPairing(data2, 1, 'L', 400 + i, day1);
}
const node2 = data2.binary_tree[0];
assert.strictEqual(node2.leftover_left, 20, 'Left must have 20 waiting points');
assert.strictEqual(node2.leftover_right, 0, 'Right must have 0 waiting points');
assert.strictEqual(node2.pairs_today, 0, 'Pairs today must be 0');

// Day 2: 15 on Right
for (let i = 1; i <= 15; i++) {
  processPairing(data2, 1, 'R', 500 + i, day2);
}
console.log(`Strong Leg Test Results:`);
console.log(`- Pairs Today: ${node2.pairs_today} (Expected: 10)`);
console.log(`- Leftover Left: ${node2.leftover_left} (Expected: 5)`);
console.log(`- Leftover Right: ${node2.leftover_right} (Expected: 0)`);
console.log(`- Wallet Balance: ₱${data2.wallets[0].binary_ref_balance} (Expected: ₱500)`);

assert.strictEqual(node2.pairs_today, 10, 'Pairs today must be 10');
assert.strictEqual(node2.leftover_left, 5, 'Leftover left must have 5 waiting points (20 - 10 paid - 5 flushed = 5)');
assert.strictEqual(node2.leftover_right, 0, 'Leftover right must be 0');
assert.strictEqual(data2.wallets[0].binary_ref_balance, 500, 'Wallet balance must be ₱500');

console.log('\n==========================================');
console.log(' ALL 4 SIMULATION TESTS PASSED PERFECTLY!');
console.log('==========================================\n');
