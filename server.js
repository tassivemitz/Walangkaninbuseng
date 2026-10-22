require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

const ENTRY_FEE = 399;
const BINARY_CAP = 3000;
const DIRECT_BONUS = 50;
const INDIRECT_BONUS = 5;
const PAIR_BONUS = 50;
const MAX_PAIRS_PER_DAY = 10;
const TRADEIN_MIN = 1000;
const TRADEIN_ROI = 1.2;
const TRADEIN_DAYS = 12;
const TRADEIN_PAYOUT_EVERY = 3;
const TRADEIN_PAYOUTS = TRADEIN_DAYS / TRADEIN_PAYOUT_EVERY;
const TRADEIN_REF_RATES = [0.1, 0.05, 0.03, 0.02];
const MAX_TRADEIN_SLOTS = 5;
const TRADEIN_CYCLE_DURATION_MS = TRADEIN_PAYOUT_EVERY * 24 * 60 * 60 * 1000;
const MIN_WITHDRAWAL = 100;

function feeRateForAmount(amount) {
  if (amount <= 1000) return 0.12;
  if (amount <= 5000) return 0.1;
  return 0.08;
}
const WALLET_COLUMNS = {
  binary_ref: 'binary_ref_balance',
  tradein_ref: 'tradein_ref_balance',
  tradein_cycle: 'tradein_cycle_balance',
  profit_sharing: 'profit_sharing_balance',
};

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(raw) {
  const str = String(raw || '').trim().replace(/\s+/g, ' ');
  if (str.length >= 3 && /^[a-zA-Z0-9_\-.@ ]+$/.test(str)) return str;
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 12 && digits.startsWith('63')) return `0${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith('09')) return digits;
  return null;
}

function normalizeMobile(raw) {
  return normalizeUsername(raw);
}

function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const store = db.getStore();
    const exists = store && store.users && store.users.some((u) => u.id === req.user.id && u.status !== 'banned');
    if (!exists) {
      return res.status(401).json({ error: 'Session expired or user not found. Sign in again.' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Sign in again.' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  return next();
}

function emptyWallet(userId) {
  return {
    user_id: userId,
    binary_ref_balance: 0,
    tradein_ref_balance: 0,
    tradein_cycle_balance: 0,
    profit_sharing_balance: 0,
  };
}

function emptyTree(userId, parentId, sponsorId, position) {
  return {
    user_id: userId,
    parent_id: parentId,
    sponsor_id: sponsorId,
    position,
    leftover_left: 0,
    leftover_right: 0,
    pairs_today: 0,
    last_pair_date: null,
  };
}

function mobileOf(userId, data) {
  const u = data.users.find((x) => x.id === userId);
  return u ? (u.username || u.mobile_number) : '';
}

function adminUserRow(userId, data = db.getStore()) {
  const u = publicUser(userId, data);
  if (!u) return null;
  const sponsor = u.sponsor_id ? data.users.find((x) => x.id === u.sponsor_id) : null;
  const parent = u.parent_id ? data.users.find((x) => x.id === u.parent_id) : null;
  const sponsorName = sponsor ? (sponsor.username || sponsor.mobile_number) : '';
  const parentName = parent ? (parent.username || parent.mobile_number) : '';
  const qual = db.getProfitShareQualification(userId, data);
  return {
    ...u,
    sponsor_username: sponsorName,
    parent_username: parentName,
    sponsor_mobile: sponsorName,
    parent_mobile: parentName,
    parent_id: u.parent_id || (parent ? parent.id : null),
    directs: data.binary_tree.filter((t) => t.sponsor_id === userId).length,
    packages: data.tradein_packages.filter((p) => p.user_id === userId).length,
    active_trade_in: qual.active_trade_in,
    group_sale_trade_in: qual.group_sale_trade_in,
    verified_income: qual.verified_income,
    profit_shares: qual.shares,
  };
}

function publicUser(userId, data = db.getStore()) {
  const u = data.users.find((x) => x.id === userId);
  if (!u) return null;
  const w = data.wallets.find((x) => x.user_id === userId) || emptyWallet(userId);
  const t = data.binary_tree.find((x) => x.user_id === userId) || {};
  const identifier = u.username || u.mobile_number;
  const sponsorUser = t.sponsor_id ? data.users.find((x) => x.id === t.sponsor_id) : null;
  const sponsorName = sponsorUser ? (sponsorUser.username || sponsorUser.mobile_number) : 'Admin';
  const qual = db.getProfitShareQualification(userId, data);
  return {
    id: u.id,
    username: identifier,
    mobile_number: identifier,
    role: u.role,
    status: u.status,
    total_binary_earnings: u.total_binary_earnings,
    created_at: u.created_at,
    binary_ref_balance: w.binary_ref_balance,
    tradein_ref_balance: w.tradein_ref_balance,
    tradein_cycle_balance: w.tradein_cycle_balance,
    profit_sharing_balance: w.profit_sharing_balance || 0,
    parent_id: u.parent_id || t.parent_id || null,
    sponsor_id: t.sponsor_id || null,
    sponsor_name: sponsorName,
    position: t.position || null,
    pairs_today: (t.last_pair_date && String(t.last_pair_date).slice(0, 10) === new Date().toISOString().slice(0, 10)) ? (t.pairs_today || 0) : 0,
    last_pair_date: t.last_pair_date || null,
    payout_account: u.payout_account || null,
    load_wallet_claimed: Boolean(u.load_wallet_claimed),
    load_wallet_claimed_at: u.load_wallet_claimed_at || null,
    load_wallet_claim_info: u.load_wallet_claim_info || null,
    verified_income: qual.verified_income,
    group_sale_trade_in: qual.group_sale_trade_in,
    direct_active_accounts: qual.direct_active_accounts,
    active_trade_in: qual.active_trade_in,
    profit_shares: qual.shares,
  };
}

function countLeg(parentId, position, data) {
  let n = 0;
  const walk = (id, pos) => {
    const child = data.binary_tree.find((x) => x.parent_id === id && x.position === pos);
    if (!child) return;
    n += 1;
    walk(child.user_id, 'L');
    walk(child.user_id, 'R');
  };
  walk(parentId, position);
  return n;
}

function isDownline(rootUserId, targetUserId, data) {
  if (Number(rootUserId) === Number(targetUserId)) return true;
  const visited = new Set();
  const queue = [Number(rootUserId)];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (curr === Number(targetUserId)) return true;
    if (visited.has(curr)) continue;
    visited.add(curr);
    const kids = data.binary_tree.filter((x) => x.parent_id === curr);
    for (const kid of kids) {
      queue.push(kid.user_id);
    }
  }
  return false;
}

function getAncestorsPath(rootUserId, targetUserId, data) {
  const path = [];
  let curr = Number(targetUserId);
  const visited = new Set();
  while (curr && !visited.has(curr)) {
    visited.add(curr);
    const u = data.users.find((x) => x.id === curr);
    const node = data.binary_tree.find((x) => x.user_id === curr);
    if (u) {
      const name = u.username || u.mobile_number;
      path.unshift({
        id: u.id,
        username: name,
        mobile: name,
        mobile_number: name,
        status: u.status,
        position: node ? node.position : null,
      });
    }
    if (curr === Number(rootUserId)) break;
    curr = node && node.parent_id ? Number(node.parent_id) : null;
  }
  return path;
}

function buildSubtree(userId, data, depth = 1, maxDepth = 3) {
  if (!userId) return null;
  const u = data.users.find((x) => x.id === userId);
  if (!u) return null;
  const node = data.binary_tree.find((x) => x.user_id === userId);
  const sponsor = node && node.sponsor_id ? data.users.find((x) => x.id === node.sponsor_id) : null;
  const parent = node && node.parent_id ? data.users.find((x) => x.id === node.parent_id) : null;

  const leftChild = data.binary_tree.find((t) => t.parent_id === userId && t.position === 'L');
  const rightChild = data.binary_tree.find((t) => t.parent_id === userId && t.position === 'R');
  const name = u.username || u.mobile_number;
  const sponsorName = sponsor ? (sponsor.username || sponsor.mobile_number) : null;
  const parentName = parent ? (parent.username || parent.mobile_number) : null;

  return {
    id: u.id,
    username: name,
    mobile: name,
    mobile_number: name,
    status: u.status,
    position: node ? node.position : null,
    sponsor_username: sponsorName,
    parent_username: parentName,
    sponsor_mobile: sponsorName,
    parent_mobile: parentName,
    left_count: countLeg(userId, 'L', data),
    right_count: countLeg(userId, 'R', data),
    left: depth < maxDepth && leftChild ? buildSubtree(leftChild.user_id, data, depth + 1, maxDepth) : null,
    right: depth < maxDepth && rightChild ? buildSubtree(rightChild.user_id, data, depth + 1, maxDepth) : null,
    has_left: Boolean(leftChild),
    has_right: Boolean(rightChild),
    left_mobile: leftChild ? mobileOf(leftChild.user_id, data) : null,
    right_mobile: rightChild ? mobileOf(rightChild.user_id, data) : null,
  };
}

function getFlatDownlines(rootUserId, data) {
  const list = [];
  const visited = new Set();
  const queue = [Number(rootUserId)];
  while (queue.length > 0) {
    const curr = queue.shift();
    if (visited.has(curr)) continue;
    visited.add(curr);
    const kids = data.binary_tree.filter((x) => x.parent_id === curr);
    for (const kid of kids) {
      const u = data.users.find((x) => x.id === kid.user_id);
      if (u) {
        const name = u.username || u.mobile_number;
        list.push({ id: u.id, username: name, mobile: name, mobile_number: name, position: kid.position });
      }
      queue.push(kid.user_id);
    }
  }
  return list;
}

function findPlacement(sponsorId, preferred, data) {
  let nodeId = sponsorId;
  let position = preferred === 'R' || preferred === 'L' ? preferred : null;
  if (!position) {
    position = countLeg(sponsorId, 'L', data) <= countLeg(sponsorId, 'R', data) ? 'L' : 'R';
  }
  while (true) {
    const kid = data.binary_tree.find((x) => x.parent_id === nodeId && x.position === position);
    if (!kid) return { parentId: nodeId, position };
    nodeId = kid.user_id;
  }
}

function assignPlacement(startNodeId, preferredPos, data) {
  const targetPos = preferredPos === 'R' ? 'R' : preferredPos === 'L' ? 'L' : null;
  if (targetPos) {
    const existing = data.binary_tree.find((t) => t.parent_id === startNodeId && t.position === targetPos);
    if (!existing) {
      return { parentId: startNodeId, position: targetPos };
    }
  }
  return findPlacement(startNodeId, targetPos, data);
}

function getBinaryCap(data) {
  return 3000;
}

function getOfficialMops(data) {
  if (data && data.settings && Array.isArray(data.settings.official_mop) && data.settings.official_mop.length > 0) {
    return data.settings.official_mop;
  }
  return [
    {
      id: 'mop_default_gcash',
      method: 'GCash',
      account_name: 'Infinite Trading Official Treasury',
      account_number: '0917 000 0000',
      qr_image: '',
      instructions: 'Send payment to the official account, then attach the screenshot below.',
      is_active: true,
      is_primary: true,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
  ];
}

function logEarning(data, { userId, category, amount, sourceUserId = null, description = '', refId = null }) {
  if (!Array.isArray(data.earnings_history)) data.earnings_history = [];
  const amt = money(amount);
  if (amt <= 0 && category !== 'safety_net') return null;
  const sourceUser = sourceUserId ? data.users.find((u) => u.id === sourceUserId) : null;
  return db.insert('earnings_history', {
    user_id: userId,
    category, // 'referral', 'indirect', 'matching', 'safety_net', 'tradein_referral', 'tradein_earnings'
    amount: amt,
    source_user_id: sourceUserId,
    source_mobile: sourceUser ? sourceUser.mobile_number : null,
    description: description || '',
    reference_id: refId,
    created_at: nowIso(),
  });
}

function creditDirectBonus(data, sponsorId, amount, sourceUserId = null) {
  const credit = money(amount);
  if (credit <= 0) return 0;
  const user = data.users.find((x) => x.id === sponsorId);
  const wallet = data.wallets.find((x) => x.user_id === sponsorId);
  if (!user || !wallet || user.status === 'banned') return 0;

  wallet.binary_ref_balance = money(wallet.binary_ref_balance + credit);
  logEarning(data, {
    userId: sponsorId,
    category: 'referral',
    amount: credit,
    sourceUserId,
    description: 'Direct Referral Bonus (Level 1)',
  });
  return credit;
}

function creditIndirectBonus(data, uplineId, amount, sourceUserId = null, level = 2) {
  const credit = money(amount);
  if (credit <= 0) return 0;
  const user = data.users.find((x) => x.id === uplineId);
  const wallet = data.wallets.find((x) => x.user_id === uplineId);
  if (!user || !wallet || user.status === 'banned') return 0;

  wallet.binary_ref_balance = money(wallet.binary_ref_balance + credit);
  logEarning(data, {
    userId: uplineId,
    category: 'indirect',
    amount: credit,
    sourceUserId,
    description: `Indirect Referral Bonus (Level ${level})`,
  });
  return credit;
}

function creditMatchingBonus(data, userId, amount, sourceLeftId = null, sourceRightId = null) {
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
    sourceUserId: sourceLeftId || sourceRightId,
    description: 'Binary Matching / Pairing Bonus',
  });
  return credit;
}

function creditBinary(data, userId, amount) {
  return creditMatchingBonus(data, userId, amount);
}

function resetPairsIfNeeded(node) {
  const today = new Date().toISOString().slice(0, 10);
  const last = node.last_pair_date ? String(node.last_pair_date).slice(0, 10) : null;
  if (last !== today) {
    // Safety Net Flush Out: Flush any residual overlapping pairs from previous day(s)
    const excessPairs = Math.min(node.leftover_left || 0, node.leftover_right || 0);
    if (excessPairs > 0) {
      node.leftover_left = Math.max(0, (node.leftover_left || 0) - excessPairs);
      node.leftover_right = Math.max(0, (node.leftover_right || 0) - excessPairs);
    }
    node.pairs_today = 0;
    node.last_pair_date = today;
  }
}

function processPairing(data, parentId, incomingPosition, newUserId = null) {
  let currentId = parentId;
  let side = incomingPosition;

  while (currentId) {
    const node = data.binary_tree.find((x) => x.user_id === currentId);
    if (!node) break;
    resetPairsIfNeeded(node);
    if (side === 'L') node.leftover_left += 1;
    else node.leftover_right += 1;

    while (node.leftover_left > 0 && node.leftover_right > 0) {
      // Daily Pairing Safety Net Cap (Default: 10 pairs/day)
      if (node.pairs_today >= MAX_PAIRS_PER_DAY) {
        // Daily cap reached: Flush out matching pairs with zero bonus
        node.leftover_left -= 1;
        node.leftover_right -= 1;
        node.last_pair_date = new Date().toISOString().slice(0, 10);
        logEarning(data, {
          userId: node.user_id,
          category: 'safety_net',
          amount: 0,
          sourceUserId: newUserId,
          description: `Daily Safety Net Flush Out (Max ${MAX_PAIRS_PER_DAY} pairs/day)`,
        });
        continue;
      }

      const credited = creditMatchingBonus(data, node.user_id, PAIR_BONUS, newUserId, null);
      if (credited <= 0) break;
      node.leftover_left -= 1;
      node.leftover_right -= 1;
      node.pairs_today += 1;
      node.last_pair_date = new Date().toISOString().slice(0, 10);
    }

    if (!node.parent_id) break;
    side = node.position;
    currentId = node.parent_id;
  }
}

function paySponsorBinary(data, sponsorId, newUserId = null) {
  if (!sponsorId) return;
  creditDirectBonus(data, sponsorId, DIRECT_BONUS, newUserId);
  let current = sponsorId;
  for (let level = 2; level <= 4; level += 1) {
    const row = data.binary_tree.find((x) => x.user_id === current);
    if (!row || !row.sponsor_id) break;
    current = row.sponsor_id;
    creditIndirectBonus(data, current, INDIRECT_BONUS, newUserId, level);
  }
}

function payTradeinReferrals(data, buyerId, capital, packageId = null) {
  let current = buyerId;
  for (let i = 0; i < TRADEIN_REF_RATES.length; i += 1) {
    const row = data.binary_tree.find((x) => x.user_id === current);
    if (!row || !row.sponsor_id) break;
    current = row.sponsor_id;
    const user = data.users.find((x) => x.id === current);
    const wallet = data.wallets.find((x) => x.user_id === current);
    if (!user || !wallet || user.status !== 'active') continue;
    const rate = TRADEIN_REF_RATES[i];
    const amount = money(capital * rate);
    wallet.tradein_ref_balance = money(wallet.tradein_ref_balance + amount);
    logEarning(data, {
      userId: current,
      category: 'tradein_referral',
      amount,
      sourceUserId: buyerId,
      description: `Trade-In Referral Level ${i + 1} (${Math.round(rate * 100)}%)`,
      refId: packageId,
    });
  }
}

function isRolloverTradein(pkg) {
  return Boolean(pkg && (pkg.is_rollover || pkg.rolled_from_package_id));
}

function tradeinOccupiesSlot(pkg) {
  if (!pkg) return false;
  if (pkg.cycle_status !== 'active' && pkg.cycle_status !== 'pending') return false;
  // Source package that already submitted a rollover no longer uses a slot.
  if (pkg.rolled_over_package_id) return false;
  return true;
}

function getPackageCycleInfo(pkg) {
  const isCompleted = pkg.cycle_status === 'completed';
  const totalPayouts = TRADEIN_PAYOUTS; // 4 cycles
  const completed = Number(pkg.payouts_completed || 0);
  const installment = money(Number(pkg.total_return || (pkg.capital * TRADEIN_ROI)) / totalPayouts);
  const capitalRolledOver = Boolean(pkg.capital_rolled_over);

  if (pkg.cycle_status !== 'active' && !isCompleted) {
    return {
      current_cycle: 1,
      total_cycles: totalPayouts,
      payouts_completed: 0,
      is_completed: false,
      is_paused: false,
      can_claim: false,
      claimable_payouts: 0,
      claimable_amount: 0,
      installment_amount: installment,
      elapsed_days: 0,
      total_days: TRADEIN_DAYS,
      progress_percent: 0,
      next_payout_date: null,
      next_payout_in_hours: null,
      cycle_start_date: null,
      rollover_required: false,
      can_rollover: false,
      rollover_pending: false,
      rollover_capital: money(pkg.capital),
      capital_rolled_over: capitalRolledOver,
      is_rollover: isRolloverTradein(pkg),
      status_label: pkg.cycle_status === 'pending'
        ? (isRolloverTradein(pkg) ? 'Rollover Pending Approval' : 'Pending Approval')
        : 'Inactive',
    };
  }

  if (isCompleted || completed >= totalPayouts) {
    return {
      current_cycle: totalPayouts,
      total_cycles: totalPayouts,
      payouts_completed: totalPayouts,
      is_completed: true,
      is_paused: false,
      can_claim: false,
      claimable_payouts: 0,
      claimable_amount: 0,
      installment_amount: installment,
      elapsed_days: TRADEIN_DAYS,
      total_days: TRADEIN_DAYS,
      progress_percent: 100,
      next_payout_date: null,
      next_payout_in_hours: null,
      cycle_start_date: pkg.cycle_start_date || pkg.start_date,
      status_label: 'Completed',
    };
  }

  // Active package: Cycle start date is pkg.cycle_start_date (or fallback to start_date or created_at)
  const currentCycleStartIso = pkg.cycle_start_date || pkg.start_date || pkg.created_at;
  const currentCycleStartMs = new Date(currentCycleStartIso).getTime();
  const now = Date.now();
  const elapsedInCycleMs = Math.max(0, now - currentCycleStartMs);

  const isCycleMatured = elapsedInCycleMs >= TRADEIN_CYCLE_DURATION_MS;

  if (isCycleMatured) {
    const readyCycle = completed + 1;
    const isFinalCycle = readyCycle >= totalPayouts;
    const rolloverPending = isFinalCycle && Boolean(pkg.rolled_over_package_id) && !capitalRolledOver;
    const rolloverRequired = isFinalCycle && !capitalRolledOver;
    return {
      current_cycle: readyCycle,
      total_cycles: totalPayouts,
      payouts_completed: completed,
      is_completed: false,
      is_paused: !isFinalCycle || rolloverRequired,
      can_claim: !rolloverRequired,
      claimable_payouts: rolloverRequired ? 0 : 1,
      claimable_amount: rolloverRequired ? 0 : installment,
      installment_amount: installment,
      elapsed_days: Math.round(((completed * TRADEIN_PAYOUT_EVERY) + TRADEIN_PAYOUT_EVERY) * 10) / 10,
      total_days: TRADEIN_DAYS,
      progress_percent: Math.round((completed / totalPayouts) * 100),
      next_payout_date: null,
      next_payout_in_hours: 0,
      cycle_start_date: currentCycleStartIso,
      rollover_required: rolloverRequired,
      can_rollover: isFinalCycle && !pkg.rolled_over_package_id && !capitalRolledOver,
      rollover_pending: rolloverPending,
      rollover_capital: money(pkg.capital),
      capital_rolled_over: capitalRolledOver,
      is_rollover: isRolloverTradein(pkg),
      status_label: rolloverPending
        ? 'Cycle 4 Ready — rollover pending admin approval'
        : rolloverRequired
          ? 'Cycle 4 Ready — roll over full capital to claim'
          : isFinalCycle
            ? 'Cycle 4 Ready to Claim'
            : `Cycle ${readyCycle} Ready to Claim! (Cycle ${readyCycle + 1} Paused)`,
    };
  }

  // Still within the 3 days of current cycle
  const remainingMs = TRADEIN_CYCLE_DURATION_MS - elapsedInCycleMs;
  const remainingHours = Math.max(0, Math.round((remainingMs / (1000 * 60 * 60)) * 10) / 10);
  const nextPayoutDate = new Date(currentCycleStartMs + TRADEIN_CYCLE_DURATION_MS).toISOString();
  const cycleProgressFrac = Math.min(1, elapsedInCycleMs / TRADEIN_CYCLE_DURATION_MS);
  const overallProgress = Math.min(99, Math.round(((completed + cycleProgressFrac) / totalPayouts) * 100));

  return {
    current_cycle: completed + 1,
    total_cycles: totalPayouts,
    payouts_completed: completed,
    is_completed: false,
    is_paused: false,
    can_claim: false,
    claimable_payouts: 0,
    claimable_amount: 0,
    installment_amount: installment,
    elapsed_days: Math.round(((completed * TRADEIN_PAYOUT_EVERY) + (elapsedInCycleMs / (24 * 60 * 60 * 1000))) * 10) / 10,
    total_days: TRADEIN_DAYS,
    progress_percent: overallProgress,
    next_payout_date: nextPayoutDate,
    next_payout_in_hours: remainingHours,
    cycle_start_date: currentCycleStartIso,
    rollover_required: false,
    can_rollover: completed === totalPayouts - 1 && !pkg.rolled_over_package_id && !capitalRolledOver,
    rollover_pending: completed === totalPayouts - 1 && Boolean(pkg.rolled_over_package_id) && !capitalRolledOver,
    rollover_capital: money(pkg.capital),
    capital_rolled_over: capitalRolledOver,
    is_rollover: isRolloverTradein(pkg),
    status_label: `Cycle ${completed + 1} Running (${remainingHours}h remaining)`,
  };
}

function processTradeinYieldsIn(data) {
  const packages = data.tradein_packages.filter((p) => p.cycle_status === 'active');
  let updated = 0;
  for (const pkg of packages) {
    if (Number(pkg.payouts_completed) >= TRADEIN_PAYOUTS && pkg.cycle_status !== 'completed') {
      pkg.cycle_status = 'completed';
      pkg.completed_at = nowIso();
      updated += 1;
    }
  }
  return { processed: packages.length, updated };
}

function processTradeinYields() {
  return db.tx((data) => processTradeinYieldsIn(data));
}

async function seedAdmin() {
  const rawAdmin = process.env.ADMIN_MOBILE || '09171234567';
  const mobile = normalizeMobile(rawAdmin) || rawAdmin;
  const password = process.env.ADMIN_PASSWORD || 'SuperAcenigga24';
  if (!mobile || !password) return;

  await db.tx(async (data) => {
    let admin = data.users.find((u) => u.role === 'admin');
    const hash = await bcrypt.hash(password, 10);
    if (!admin) {
      admin = db.insert('users', {
        username: 'Toshi',
        mobile_number: mobile,
        password: hash,
        role: 'admin',
        status: 'active',
        parent_id: null,
        total_binary_earnings: 0,
        created_at: nowIso(),
      });
      data.wallets.push(emptyWallet(admin.id));
      data.binary_tree.push(emptyTree(admin.id, null, null, null));
    } else {
      admin.username = 'Toshi';
      admin.mobile_number = mobile;
      admin.password = hash;
    }

    // Ensure demo user exists for client preview & pair programming testing
    let demoUser = data.users.find((u) => u.username === 'user');
    const userHash = await bcrypt.hash('user123', 10);
    if (!demoUser) {
      demoUser = db.insert('users', {
        username: 'user',
        mobile_number: '09170000001',
        password: userHash,
        role: 'user',
        status: 'active',
        parent_id: admin.id,
        total_binary_earnings: 250,
        created_at: nowIso(),
      });
      data.wallets.push({
        user_id: demoUser.id,
        binary_ref_balance: 150,
        tradein_ref_balance: 100,
        tradein_cycle_balance: 600,
        profit_sharing_balance: 0,
      });
      data.binary_tree.push({
        user_id: demoUser.id,
        parent_id: admin.id,
        sponsor_id: admin.id,
        position: 'L',
        leftover_left: 2,
        leftover_right: 1,
        pairs_today: 1,
        last_pair_date: nowIso().slice(0, 10),
      });
    } else {
      demoUser.password = userHash;
      demoUser.status = 'active';
      demoUser.role = 'user';
    }

    if (data.code_vault.length === 0) {
      const starter = [];
      for (let i = 0; i < 5; i += 1) {
        const code = generateRandomCode(8);
        db.insert('code_vault', {
          code,
          status: 'available',
          assigned_to: null,
          created_at: nowIso(),
          used_at: null,
        });
        starter.push(code);
      }
      console.log('Starter 8-char activation codes minted:', starter.join(', '));
    }
    console.log(`Admin account ready: Toshi (${mobile}) | Demo user ready: user / user123`);
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: 'file', file: 'data/store.json' });
});

app.get('/api/config', (_req, res) => {
  const data = db.getStore();
  res.json({
    entryFee: ENTRY_FEE,
    binaryCap: getBinaryCap(data),
    directBonus: DIRECT_BONUS,
    indirectBonus: INDIRECT_BONUS,
    pairBonus: PAIR_BONUS,
    maxPairsPerDay: MAX_PAIRS_PER_DAY,
    tradeinMin: TRADEIN_MIN,
    tradeinRoi: TRADEIN_ROI,
    tradeinDays: TRADEIN_DAYS,
    tradeinPayoutEvery: TRADEIN_PAYOUT_EVERY,
    tradeinRefRates: TRADEIN_REF_RATES,
    minWithdrawal: MIN_WITHDRAWAL,
    withdrawalFeeTiers: [
      { max: 1000, rate: 0.12 },
      { max: 5000, rate: 0.1 },
      { max: null, rate: 0.08 },
    ],
  });
});

function generateRandomCode(length = 8) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

app.post('/api/auth/register', async (req, res) => {
  const rawUser = req.body.username || req.body.mobile_number;
  const username = normalizeUsername(rawUser);
  const password = String(req.body.password || '');
  const sponsorRaw = req.body.sponsor_username || req.body.sponsor_mobile;
  const sponsorUsername = sponsorRaw ? normalizeUsername(sponsorRaw) : null;

  if (!username) return res.status(400).json({ error: 'Please enter a valid username (min 3 alphanumeric characters).' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const userId = await db.tx((data) => {
      if (data.users.some((u) => (u.username && u.username.toLowerCase() === username.toLowerCase()) || (u.mobile_number && u.mobile_number.toLowerCase() === username.toLowerCase()))) {
        const err = new Error('Username is already taken.');
        err.status = 409;
        throw err;
      }

      let sponsorId = null;
      if (sponsorUsername) {
        const sponsor = data.users.find((u) => (u.username && u.username.toLowerCase() === sponsorUsername.toLowerCase()) || (u.mobile_number && u.mobile_number.toLowerCase() === sponsorUsername.toLowerCase()));
        if (sponsor && sponsor.status !== 'banned') {
          sponsorId = sponsor.id;
        }
      }
      if (!sponsorId) {
        const admin = data.users.filter((u) => u.role === 'admin').sort((a, b) => a.id - b.id)[0];
        sponsorId = admin ? admin.id : 1;
      }

      // New accounts start as INACTIVE — no binary placement or commissions yet
      const user = db.insert('users', {
        username,
        mobile_number: username,
        password: hash,
        role: 'user',
        status: 'inactive',
        parent_id: sponsorId,
        total_binary_earnings: 0,
        created_at: nowIso(),
      });
      data.wallets.push(emptyWallet(user.id));
      // Store sponsor link; tree placement will happen upon activation
      data.binary_tree.push(emptyTree(user.id, null, sponsorId, null));

      return user.id;
    });

    const user = publicUser(userId);
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const rawId = req.body.username || req.body.mobile_number;
  const username = normalizeUsername(rawId);
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const userRow = db.find('users', (u) => (u.username && u.username.toLowerCase() === username.toLowerCase()) || (u.mobile_number && u.mobile_number.toLowerCase() === username.toLowerCase()));
  if (!userRow) return res.status(401).json({ error: 'Invalid username or password.' });

  const ok = await bcrypt.compare(password, userRow.password);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
  if (userRow.status === 'banned') return res.status(403).json({ error: 'This account is banned.' });

  const user = publicUser(userRow.id);
  res.json({ token: signToken(userRow), user });
});

app.post('/api/account/activate', auth, async (req, res) => {
  // Self-activation is disabled: only upline/sponsor can activate and place accounts via genealogy tree (+ Encode Slot)
  return res.status(403).json({
    error: 'Self-activation is disabled. Please contact your upline or direct sponsor to place and activate your account into the genealogy tree.',
  });
});

// Sponsor / Encoder Downline Placement Endpoint
app.post('/api/binary/encode-downline', auth, async (req, res) => {
  const memberMobile = normalizeUsername(req.body.member_mobile || req.body.member_username || req.body.username);
  const password = String(req.body.password || '').trim();
  const code = normalizeCode(req.body.code);
  const rawPos = String(req.body.position || '').trim().toUpperCase();
  const preferredPos = rawPos.startsWith('R') ? 'R' : rawPos.startsWith('L') ? 'L' : null;
  const placementMobile = (req.body.placement_mobile || req.body.placement_username) ? normalizeUsername(req.body.placement_mobile || req.body.placement_username) : null;
  const placementParentId = req.body.placement_parent_id ? Number(req.body.placement_parent_id) : null;

  if (!memberMobile) return res.status(400).json({ error: 'Please enter a valid member username to encode.' });
  if (!code || code.length < 6) return res.status(400).json({ error: 'Please enter a valid 8-character activation code.' });

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  try {
    const result = await db.tx((data) => {
      const encoder = data.users.find((x) => x.id === req.user.id);
      if (!encoder || encoder.status === 'banned') {
        const err = new Error('You do not have permission to encode accounts.');
        err.status = 403;
        throw err;
      }

      let target = data.users.find((x) => (x.username && x.username.toLowerCase() === memberMobile.toLowerCase()) || (x.mobile_number && x.mobile_number.toLowerCase() === memberMobile.toLowerCase()));
      if (!target) {
        // If user does not exist yet, require password (at least 4 characters) to register and place them directly
        if (!passwordHash || password.length < 4) {
          const err = new Error(`Member "${memberMobile}" is not yet registered. Please enter a password (min 4 characters) to register and place this new account into the slot.`);
          err.status = 404;
          throw err;
        }
        target = db.insert('users', {
          username: memberMobile,
          mobile_number: memberMobile,
          password: passwordHash,
          role: 'user',
          status: 'active',
          parent_id: encoder.id,
          total_binary_earnings: 0,
          created_at: nowIso(),
        });
        data.wallets.push(emptyWallet(target.id));
      } else {
        if (target.status === 'active') {
          const err = new Error(`Member "${memberMobile}" is already activated in the binary tree.`);
          err.status = 400;
          throw err;
        }
        if (target.status === 'banned') {
          const err = new Error('This account is banned.');
          err.status = 403;
          throw err;
        }
        if (passwordHash) {
          target.password = passwordHash;
        }
      }

      // Check code vault - universal code
      const vault = data.code_vault.find((c) => normalizeCode(c.code) === code && c.status !== 'used');
      if (!vault) {
        const err = new Error('Activation code is invalid or already used.');
        err.status = 400;
        throw err;
      }

      // Check member tree record
      let targetTree = data.binary_tree.find((t) => t.user_id === target.id);
      let sponsorId = targetTree && targetTree.sponsor_id ? targetTree.sponsor_id : encoder.id;
      if (!targetTree) {
        targetTree = emptyTree(target.id, null, sponsorId, null);
        data.binary_tree.push(targetTree);
      }

      // Placement starting node: defaults to placement_parent_id, placement_mobile, encoder, or sponsor
      let startNodeId = encoder.id;
      let pUser = null;
      if (placementParentId) {
        pUser = data.users.find((x) => x.id === placementParentId && x.status === 'active');
        if (!pUser) {
          const err = new Error('Selected placement parent node was not found or is not active.');
          err.status = 400;
          throw err;
        }
      } else if (placementMobile) {
        pUser = data.users.find((x) => ((x.username && x.username.toLowerCase() === placementMobile.toLowerCase()) || (x.mobile_number && x.mobile_number.toLowerCase() === placementMobile.toLowerCase())) && x.status === 'active');
        if (!pUser) {
          const err = new Error(`Placement upline ${placementMobile} is not an active member.`);
          err.status = 400;
          throw err;
        }
      }

      if (pUser) {
        if (!data.binary_tree.some((t) => t.user_id === pUser.id)) {
          const err = new Error(`Placement parent ${pUser.username || pUser.mobile_number} is not an active binary node.`);
          err.status = 400;
          throw err;
        }

        // STRICT CROSSLINE / UPLINE VALIDATION:
        // Must be sponsor/encoder themselves OR an active downline inside their subtree!
        const isSelf = pUser.id === sponsorId || pUser.id === encoder.id;
        const isSubDownline = isDownline(sponsorId, pUser.id, data) || isDownline(encoder.id, pUser.id, data);
        if (!isSelf && !isSubDownline && encoder.role !== 'admin') {
          const err = new Error('Crossline or upline placement is strictly prohibited. You can only place downlines under yourself or within your own downline tree.');
          err.status = 400;
          throw err;
        }
        startNodeId = pUser.id;
      } else if (targetTree.sponsor_id) {
        startNodeId = targetTree.sponsor_id;
      }

      // Calculate binary placement and spillover
      const place = assignPlacement(startNodeId, preferredPos, data);
      targetTree.parent_id = place.parentId;
      targetTree.position = place.position;
      targetTree.sponsor_id = sponsorId;

      // Mark code as used with full audit trail
      vault.status = 'used';
      vault.used_by = target.id;
      vault.encoded_by = encoder.id;
      vault.used_at = nowIso();
      vault.placement_parent_id = place.parentId;
      vault.position = place.position;

      // Activate target user
      target.status = 'active';
      target.parent_id = sponsorId;
      db.ingestCodeActivationPool(data);
      db.syncUserDownlineFields(target, data);

      // Commissions
      paySponsorBinary(data, sponsorId, target.id);
      processPairing(data, place.parentId, place.position, target.id);

      return {
        user: publicUser(target.id, data),
        placement: {
          parent_id: place.parentId,
          parent_mobile: mobileOf(place.parentId, data),
          position: place.position,
        },
      };
    });

    res.json({ ok: true, user: result.user, placement: result.placement });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Downline encoding failed.' });
  }
});

app.post('/api/account/renew', auth, async (req, res) => {
  const code = normalizeCode(req.body.code);
  if (!code || code.length < 6) return res.status(400).json({ error: 'Please enter a valid 8-character activation code to renew.' });
  try {
    const user = await db.tx((data) => {
      const u = data.users.find((x) => x.id === req.user.id);
      if (!u) {
        const err = new Error('Account not found.');
        err.status = 404;
        throw err;
      }
      if (u.status === 'banned') {
        const err = new Error('This account cannot be renewed.');
        err.status = 403;
        throw err;
      }
      const vault = data.code_vault.find((c) => normalizeCode(c.code) === code && c.status !== 'used');
      if (!vault) {
        const err = new Error('Activation code is invalid or already used.');
        err.status = 400;
        throw err;
      }
      vault.status = 'used';
      vault.used_by = u.id;
      if (!vault.assigned_to) {
        vault.assigned_to = u.id;
      }
      vault.used_at = nowIso();
      u.status = 'active';
      u.total_binary_earnings = 0;
      db.ingestCodeActivationPool(data);
      return publicUser(u.id, data);
    });
    res.json({ user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Renewal failed.' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  await processTradeinYields().catch(() => { });
  const user = publicUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  res.json({ user });
});

app.get('/api/dashboard', auth, async (req, res) => {
  await processTradeinYields().catch(() => { });
  const data = db.getStore();
  const user = publicUser(req.user.id, data);
  if (!user) return res.status(404).json({ error: 'Account not found.' });

  const packages = data.tradein_packages
    .filter((p) => p.user_id === req.user.id)
    .sort((a, b) => b.id - a.id);
  const withdrawals = data.withdrawals
    .filter((w) => w.user_id === req.user.id)
    .sort((a, b) => b.id - a.id)
    .slice(0, 20);
  const directs = data.binary_tree
    .filter((t) => t.sponsor_id === req.user.id)
    .map((t) => {
      const u = data.users.find((x) => x.id === t.user_id);
      return u
        ? {
          id: u.id,
          mobile_number: u.mobile_number,
          status: u.status,
          position: t.position,
          created_at: u.created_at,
        }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.id - a.id);
  const leftChild = data.binary_tree.find((t) => t.parent_id === req.user.id && t.position === 'L');
  const rightChild = data.binary_tree.find((t) => t.parent_id === req.user.id && t.position === 'R');

  // Direct and Indirect downlines (Levels 1 to 4)
  const directUserIds = directs.map((d) => d.id);
  const l2Nodes = data.binary_tree.filter((t) => directUserIds.includes(t.sponsor_id));
  const l2UserIds = l2Nodes.map((t) => t.user_id);
  const l3Nodes = data.binary_tree.filter((t) => l2UserIds.includes(t.sponsor_id));
  const l3UserIds = l3Nodes.map((t) => t.user_id);
  const l4Nodes = data.binary_tree.filter((t) => l3UserIds.includes(t.sponsor_id));

  const mapDownline = (node, level) => {
    const u = data.users.find((x) => x.id === node.user_id);
    const sp = data.users.find((x) => x.id === node.sponsor_id);
    return u
      ? {
        id: u.id,
        mobile_number: u.mobile_number,
        level,
        status: u.status,
        sponsor_mobile: sp ? sp.mobile_number : '—',
        created_at: u.created_at,
      }
      : null;
  };

  const indirects = [
    ...l2Nodes.map((n) => mapDownline(n, 2)),
    ...l3Nodes.map((n) => mapDownline(n, 3)),
    ...l4Nodes.map((n) => mapDownline(n, 4)),
  ].filter(Boolean).sort((a, b) => b.id - a.id);

  // Sub-tree nodes for Genealogy visualizer
  const getNodeInfo = (userId) => {
    if (!userId) return null;
    const u = data.users.find((x) => x.id === userId);
    if (!u) return null;
    const node = data.binary_tree.find((t) => t.user_id === userId);
    const lc = node ? data.binary_tree.find((t) => t.parent_id === userId && t.position === 'L') : null;
    const rc = node ? data.binary_tree.find((t) => t.parent_id === userId && t.position === 'R') : null;
    return {
      id: u.id,
      mobile: u.mobile_number,
      status: u.status,
      position: node ? node.position : null,
      left_count: countLeg(userId, 'L', data),
      right_count: countLeg(userId, 'R', data),
      left_child_id: lc ? lc.user_id : null,
      right_child_id: rc ? rc.user_id : null,
    };
  };

  const leftChildNode = leftChild ? getNodeInfo(leftChild.user_id) : null;
  const rightChildNode = rightChild ? getNodeInfo(rightChild.user_id) : null;

  // Code Vault stats for this user (Code seller inventory)
  const available_codes = data.code_vault
    .filter((c) => c.assigned_to === req.user.id && c.status === 'assigned')
    .map((c) => ({ id: c.id, code: c.code, created_at: c.created_at }));

  const used_codes = data.code_vault
    .filter((c) => c.assigned_to === req.user.id && c.status === 'used')
    .map((c) => ({
      id: c.id,
      code: c.code,
      used_at: c.used_at,
      used_by_mobile: c.used_by ? mobileOf(c.used_by, data) : '',
    }));

  // Trade-In active capital and slots capacity
  const maxTradeinSlots = Number(data.settings && data.settings.max_tradein_slots) || MAX_TRADEIN_SLOTS;
  const occupiedTradeinCount = packages.filter((p) => tradeinOccupiesSlot(p)).length;
  const availableTradeinSlots = Math.max(0, maxTradeinSlots - occupiedTradeinCount);

  const total_tradein_deposit = packages
    .filter((p) => p.cycle_status === 'active')
    .reduce((sum, p) => sum + (Number(p.capital) || 0), 0);

  const total_balance = (Number(user.binary_ref_balance) || 0) + (Number(user.tradein_ref_balance) || 0) + (Number(user.tradein_cycle_balance) || 0) + (Number(user.profit_sharing_balance) || 0);

  const profitSharingPublic = {
    pool_total: money((data.profit_sharing_pool && data.profit_sharing_pool.total_amount) || 0),
    qualified_members: db.listQualifiedMembers(data).map((q) => ({
      username: q.username,
      shares: q.shares,
    })),
  };

  const enrichedPackages = packages.map((p) => ({
    ...p,
    occupies_slot: tradeinOccupiesSlot(p),
    cycle_info: getPackageCycleInfo(p),
  }));

  // Direct referral earnings calculation (only active placed directs qualify)
  const activeDirects = (directs || []).filter((d) => d.status === 'active' && d.position);
  const directEarningRecords = Array.isArray(data.earnings_history)
    ? data.earnings_history.filter((e) => e.user_id === req.user.id && e.category === 'referral')
    : [];
  const directEarningsTotal = directEarningRecords.length > 0
    ? directEarningRecords.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    : (activeDirects.length * DIRECT_BONUS);

  // Indirect referral earnings calculation (only active indirect downlines qualify)
  const activeIndirects = (indirects || []).filter((ind) => ind.status === 'active');
  const indirectEarningRecords = Array.isArray(data.earnings_history)
    ? data.earnings_history.filter((e) => e.user_id === req.user.id && e.category === 'indirect')
    : [];
  const indirectEarningsTotal = indirectEarningRecords.length > 0
    ? indirectEarningRecords.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    : (activeIndirects.length * INDIRECT_BONUS);

  const activeBinaryCap = getBinaryCap(data);
  user.binary_cap = activeBinaryCap;

  res.json({
    user,
    packages: enrichedPackages,
    tradein_slots: {
      max: maxTradeinSlots,
      active: occupiedTradeinCount,
      available: availableTradeinSlots,
    },
    withdrawals,
    directs,
    indirects,
    inventory_codes: available_codes,
    code_vault: {
      available_count: available_codes.length,
      available_list: available_codes,
      used_count: used_codes.length,
      used_list: used_codes,
    },
    official_mop: getOfficialMops(data).filter((m) => m.is_active !== false),
    profit_sharing: profitSharingPublic,
    metrics: {
      binary: Number(user.binary_ref_balance) || 0,
      direct_earnings: money(directEarningsTotal),
      direct_count: activeDirects.length,
      direct_total_count: (directs || []).length,
      ppt_pairs: user.pairs_today || 0,
      ppt_earnings: (user.pairs_today || 0) * PAIR_BONUS,
      in_ppt_count: activeIndirects.length,
      in_ppt_total_count: (indirects || []).length,
      in_ppt_earnings: money(indirectEarningsTotal),
      total_balance,
      tradein_deposit: total_tradein_deposit,
      tradein_profit: Number(user.tradein_cycle_balance) || 0,
      tradein_ref: Number(user.tradein_ref_balance) || 0,
      profit_sharing: Number(user.profit_sharing_balance) || 0,
    },
    tree: {
      left_count: countLeg(req.user.id, 'L', data),
      right_count: countLeg(req.user.id, 'R', data),
      left_child: leftChild ? leftChild.user_id : null,
      right_child: rightChild ? rightChild.user_id : null,
      left_node: leftChildNode,
      right_node: rightChildNode,
    },
    weekly_payout_enabled: Boolean(data.settings.weekly_payout_enabled),
    constants: {
      entryFee: ENTRY_FEE,
      binaryCap: activeBinaryCap,
      withdrawalFees: {
        min: MIN_WITHDRAWAL,
        tiers: [
          { max: 1000, rate: 0.12 },
          { max: 5000, rate: 0.1 },
          { max: null, rate: 0.08 },
        ],
      },
    },
  });
});

app.get('/api/tree', auth, async (req, res) => {
  const data = db.getStore();
  const caller = data.users.find((u) => u.id === req.user.id);
  if (!caller) return res.status(404).json({ error: 'User not found.' });

  let targetId = req.user.id;
  if (req.query.userId) {
    targetId = Number(req.query.userId);
  } else if (req.query.username || req.query.mobile) {
    const norm = normalizeUsername(req.query.username || req.query.mobile);
    const found = norm ? data.users.find((u) => (u.username && u.username.toLowerCase() === norm.toLowerCase()) || (u.mobile_number && u.mobile_number.toLowerCase() === norm.toLowerCase())) : null;
    if (found) targetId = found.id;
    else return res.status(404).json({ error: 'Member not found.' });
  }

  const targetUser = data.users.find((u) => u.id === targetId);
  if (!targetUser) return res.status(404).json({ error: 'Target member not found.' });

  const isAdmin = caller.role === 'admin';
  if (!isAdmin && !isDownline(caller.id, targetId, data)) {
    return res.status(403).json({ error: 'Access denied. You can only view genealogy trees in your own downline.' });
  }

  const depth = Math.min(5, Math.max(2, Number(req.query.depth) || 3));
  const rootId = isDownline(caller.id, targetId, data) ? caller.id : targetId;
  const breadcrumbs = getAncestorsPath(rootId, targetId, data);
  const tree = buildSubtree(targetId, data, 1, depth);
  const downlines = isAdmin
    ? data.users.filter((u) => u.role !== 'admin').map((u) => {
      const name = u.username || u.mobile_number;
      return { id: u.id, username: name, mobile_number: name, mobile: name, status: u.status };
    })
    : getFlatDownlines(caller.id, data).map((d) => {
      const name = d.username || d.mobile;
      return { ...d, username: name, mobile_number: name, mobile: name };
    });

  // Pending unactivated directs for upline activation
  const unactivated_directs = data.users
    .filter((u) => {
      if (u.status === 'active' || u.status === 'banned') return false;
      const t = data.binary_tree.find((x) => x.user_id === u.id);
      return (t && t.sponsor_id === caller.id) || (!t && u.id !== caller.id);
    })
    .map((u) => {
      const name = u.username || u.mobile_number;
      return { id: u.id, username: name, mobile_number: name, mobile: name, created_at: u.created_at };
    });

  // Available codes in caller's inventory for quick activation
  const available_codes = data.code_vault
    .filter((c) => c.assigned_to === caller.id && c.status === 'assigned')
    .map((c) => c.code);

  const left_team_count = countLeg(targetId, 'L', data);
  const right_team_count = countLeg(targetId, 'R', data);
  const total_network_count = getFlatDownlines(targetId, data).length;
  const directs_count = data.binary_tree.filter(t => t.sponsor_id === targetId).length;

  const targetName = targetUser.username || targetUser.mobile_number;
  res.json({
    user: { id: targetUser.id, username: targetName, mobile_number: targetName, mobile: targetName },
    root_user_id: caller.id,
    viewed_user_id: targetId,
    breadcrumbs,
    ancestors: breadcrumbs,
    tree,
    depth,
    downlines,
    unactivated_directs,
    available_codes,
    metrics: {
      left_team_count,
      right_team_count,
      total_network_count,
      directs_count,
    },
  });
});

app.post('/api/tradein/purchase', auth, async (req, res) => {
  const capital = money(req.body.capital);
  if (!Number.isFinite(capital) || capital < TRADEIN_MIN) {
    return res.status(400).json({ error: `Minimum trade-in capital is ₱${TRADEIN_MIN}.` });
  }

  const ref_number = String(req.body.ref_number || '').trim();
  const payment_method = String(req.body.payment_method || 'GCash').trim();
  const receipt_url = req.body.receipt_url || req.body.receipt_image || req.body.receipt || req.body.proof_image || req.body.receiptSrc || null;

  try {
    const pkg = await db.tx((data) => {
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user || user.status !== 'active') {
        const err = new Error('Only active accounts can open a trade-in cycle.');
        err.status = 403;
        throw err;
      }

      const maxSlots = Number(data.settings && data.settings.max_tradein_slots) || MAX_TRADEIN_SLOTS;
      const occupied = data.tradein_packages.filter(
        (p) => p.user_id === req.user.id && tradeinOccupiesSlot(p)
      );
      if (occupied.length >= maxSlots) {
        const err = new Error(`Trade-In Slots Full: You have reached the maximum capacity of ${maxSlots} active trade-in slots. Please complete an existing 4-cycle package before opening a new slot.`);
        err.status = 400;
        throw err;
      }

      const created = db.insert('tradein_packages', {
        user_id: req.user.id,
        capital,
        total_return: money(capital * TRADEIN_ROI),
        start_date: null,
        cycle_start_date: null,
        cycle_status: 'pending',
        payouts_completed: 0,
        ref_number,
        payment_method,
        receipt_url,
        receipt_image: receipt_url,
        created_at: nowIso(),
      });
      return created;
    });
    res.status(201).json({ package: { ...pkg, cycle_info: getPackageCycleInfo(pkg) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Trade-in purchase failed.' });
  }
});

// Trade-In Cycle Installment Manual Claim
app.post('/api/tradein/claim/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid package ID.' });

  try {
    const result = await db.tx((data) => {
      const pkg = data.tradein_packages.find((p) => p.id === id);
      if (!pkg) {
        const err = new Error('Trade-in package not found.');
        err.status = 404;
        throw err;
      }
      if (Number(pkg.user_id) !== Number(req.user.id) && req.user.role !== 'admin') {
        const err = new Error('Access denied.');
        err.status = 403;
        throw err;
      }
      if (pkg.cycle_status !== 'active') {
        const err = new Error(`Package is ${pkg.cycle_status}, no active payout to claim.`);
        err.status = 400;
        throw err;
      }

      const cycleInfo = getPackageCycleInfo(pkg);
      if (cycleInfo.rollover_pending) {
        const err = new Error('Your rollover is waiting for admin approval. Cycle 4 can be claimed after the rollover is approved.');
        err.status = 400;
        throw err;
      }
      if (cycleInfo.rollover_required) {
        const err = new Error(`Roll over the full capital of ₱${money(pkg.capital).toLocaleString('en-PH')} and wait for admin approval before claiming Cycle 4.`);
        err.status = 400;
        throw err;
      }
      if (!cycleInfo.can_claim || cycleInfo.claimable_amount <= 0) {
        const remainingHours = cycleInfo.next_payout_in_hours !== null ? ` (next payout in ~${cycleInfo.next_payout_in_hours}h)` : '';
        const err = new Error(`Payout for Cycle ${Number(pkg.payouts_completed || 0) + 1} is not yet ready to claim${remainingHours}. Each cycle takes 3 full days.`);
        err.status = 400;
        throw err;
      }

      let wallet = data.wallets.find((w) => Number(w.user_id) === Number(pkg.user_id));
      if (!wallet) {
        wallet = emptyWallet(pkg.user_id);
        data.wallets.push(wallet);
      }

      const claimedAmount = cycleInfo.claimable_amount;

      // Credit to cash out wallet
      wallet.tradein_cycle_balance = money((Number(wallet.tradein_cycle_balance) || 0) + claimedAmount);
      pkg.payouts_completed = Number(pkg.payouts_completed || 0) + 1;
      pkg.last_claimed_at = nowIso();

      logEarning(data, {
        userId: pkg.user_id,
        category: 'tradein_earnings',
        amount: claimedAmount,
        sourceUserId: pkg.user_id,
        description: `Trade-In Cycle ${pkg.payouts_completed}/${TRADEIN_PAYOUTS} Payout Claim`,
        refId: pkg.id,
      });

      if (pkg.payouts_completed >= TRADEIN_PAYOUTS) {
        pkg.cycle_status = 'completed';
        pkg.completed_at = nowIso();
      } else {
        // STRICT PAUSED CYCLE RULE:
        // THE NEXT 3-DAY CYCLE COUNTDOWN STARTS RIGHT HERE, ONLY AFTER CLAIMING!
        pkg.cycle_start_date = nowIso();
      }

      return {
        package: { ...pkg, cycle_info: getPackageCycleInfo(pkg) },
        claimed_amount: claimedAmount,
        wallet_balance: wallet.tradein_cycle_balance,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to claim trade-in payout.' });
  }
});

// Roll over full package capital into a new cycle (required before Cycle 4 claim)
app.post('/api/tradein/rollover/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid package ID.' });

  try {
    const result = await db.tx((data) => {
      const pkg = data.tradein_packages.find((p) => p.id === id);
      if (!pkg) {
        const err = new Error('Trade-in package not found.');
        err.status = 404;
        throw err;
      }
      if (Number(pkg.user_id) !== Number(req.user.id) && req.user.role !== 'admin') {
        const err = new Error('Access denied.');
        err.status = 403;
        throw err;
      }
      if (pkg.cycle_status !== 'active') {
        const err = new Error(`Package is ${pkg.cycle_status}, capital cannot be rolled over.`);
        err.status = 400;
        throw err;
      }
      if (pkg.capital_rolled_over) {
        const err = new Error('Full capital has already been rolled over for this package.');
        err.status = 400;
        throw err;
      }
      if (pkg.rolled_over_package_id) {
        const pending = data.tradein_packages.find((p) => p.id === pkg.rolled_over_package_id);
        if (pending && pending.cycle_status === 'pending') {
          const err = new Error('A rollover is already pending admin approval for this package.');
          err.status = 400;
          throw err;
        }
        const err = new Error('Full capital has already been rolled over for this package.');
        err.status = 400;
        throw err;
      }
      const completed = Number(pkg.payouts_completed || 0);
      if (completed !== TRADEIN_PAYOUTS - 1) {
        const err = new Error(`Rollover is only available on Cycle 4 (after claiming Cycle ${TRADEIN_PAYOUTS - 1}). Currently at ${completed}/${TRADEIN_PAYOUTS} payouts claimed.`);
        err.status = 400;
        throw err;
      }

      const receipt_url = req.body.receipt_url || req.body.receipt_image || req.body.receipt || req.body.proof_image || req.body.receiptSrc || null;
      if (!receipt_url) {
        const err = new Error('Upload a payment receipt to submit this rollover.');
        err.status = 400;
        throw err;
      }
      const ref_number = String(req.body.ref_number || '').trim();
      const payment_method = String(req.body.payment_method || 'GCash').trim() || 'GCash';

      const capital = money(pkg.capital);
      const now = nowIso();
      const rolled = db.insert('tradein_packages', {
        user_id: pkg.user_id,
        capital,
        total_return: money(capital * TRADEIN_ROI),
        start_date: null,
        cycle_start_date: null,
        cycle_status: 'pending',
        payouts_completed: 0,
        is_rollover: true,
        rolled_from_package_id: pkg.id,
        payment_method,
        ref_number,
        receipt_url,
        receipt_image: receipt_url,
        created_at: now,
      });

      pkg.rolled_over_package_id = rolled.id;
      pkg.rollover_submitted_at = now;

      const buyer = data.users.find((u) => u.id === pkg.user_id);
      if (buyer) db.syncUserDownlineFields(buyer, data);

      return {
        package: { ...pkg, cycle_info: getPackageCycleInfo(pkg) },
        rolled_package: { ...rolled, cycle_info: getPackageCycleInfo(rolled) },
        rolled_capital: capital,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to roll over trade-in capital.' });
  }
});

// Test / Admin helper to simulate elapsed cycle time safely
app.post('/api/tradein/test-fastforward/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const days = Number(req.body.days || 3);
  try {
    const pkg = await db.tx((data) => {
      const p = data.tradein_packages.find((x) => x.id === id);
      if (!p) {
        const err = new Error('Package not found.');
        err.status = 404;
        throw err;
      }
      const prev = new Date(p.cycle_start_date || p.start_date || p.created_at).getTime();
      p.cycle_start_date = new Date(prev - (days * 24 * 60 * 60 * 1000 + 5000)).toISOString();
      return p;
    });
    res.json({ ok: true, package: { ...pkg, cycle_info: getPackageCycleInfo(pkg) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Fast-forward failed.' });
  }
});

// User Earnings History Endpoint
app.get('/api/user/earnings-history', auth, (req, res) => {
  const data = db.getStore();
  const category = String(req.query.category || 'all').trim().toLowerCase();
  let list = (data.earnings_history || []).filter((e) => e.user_id === req.user.id);
  if (category && category !== 'all') {
    list = list.filter((e) => e.category === category);
  }
  list.sort((a, b) => b.id - a.id);

  const allUserLogs = (data.earnings_history || []).filter((e) => e.user_id === req.user.id);
  const totals = {
    all: money(allUserLogs.reduce((s, e) => s + Number(e.amount || 0), 0)),
    referral: money(allUserLogs.filter((e) => e.category === 'referral').reduce((s, e) => s + Number(e.amount || 0), 0)),
    indirect: money(allUserLogs.filter((e) => e.category === 'indirect').reduce((s, e) => s + Number(e.amount || 0), 0)),
    matching: money(allUserLogs.filter((e) => e.category === 'matching').reduce((s, e) => s + Number(e.amount || 0), 0)),
    tradein_referral: money(allUserLogs.filter((e) => e.category === 'tradein_referral').reduce((s, e) => s + Number(e.amount || 0), 0)),
    tradein_earnings: money(allUserLogs.filter((e) => e.category === 'tradein_earnings').reduce((s, e) => s + Number(e.amount || 0), 0)),
    profit_sharing: money(allUserLogs.filter((e) => e.category === 'profit_sharing').reduce((s, e) => s + Number(e.amount || 0), 0)),
  };

  res.json({
    totals,
    records: list.slice(0, 200),
  });
});

// Admin Earnings History Endpoint
app.get('/api/admin/earnings-history', auth, adminOnly, (req, res) => {
  const data = db.getStore();
  const category = String(req.query.category || 'all').trim().toLowerCase();
  let list = (data.earnings_history || []).slice();
  if (category && category !== 'all') {
    list = list.filter((e) => e.category === category);
  }
  list.sort((a, b) => b.id - a.id);

  const totalPaidOut = money((data.earnings_history || []).reduce((s, e) => s + Number(e.amount || 0), 0));

  res.json({
    total_paid_out: totalPaidOut,
    records: list.slice(0, 300).map((e) => ({
      ...e,
      recipient_mobile: mobileOf(e.user_id, data),
    })),
  });
});

// Admin Binary Cap Settings Endpoint
app.post('/api/admin/settings/binary-cap', auth, adminOnly, async (req, res) => {
  const cap = money(req.body.cap || req.body.binary_cap);
  if (!cap || cap < 1000) return res.status(400).json({ error: 'Minimum binary cap is ₱1,000.' });
  await db.tx((data) => {
    data.settings.binary_cap = 3000;
  });
  res.json({ ok: true, binary_cap: 3000 });
});

// Admin Trade-In Slots Settings Endpoint
app.post('/api/admin/settings/tradein-slots', auth, adminOnly, async (req, res) => {
  const slots = Math.min(20, Math.max(1, Number(req.body.slots || req.body.max_tradein_slots) || 5));
  await db.tx((data) => {
    data.settings.max_tradein_slots = slots;
  });
  res.json({ ok: true, max_tradein_slots: slots });
});

// ==========================================
// OFFICIAL MODE OF PAYMENT (MOP) ENDPOINTS
// ==========================================

// Public / User Official MOP Endpoint
app.get('/api/mop', (_req, res) => {
  const data = db.getStore();
  const allMops = getOfficialMops(data);
  const activeMops = allMops.filter((m) => m.is_active !== false);
  res.json({ mop: activeMops });
});

// Admin All Official MOP Channels Endpoint
app.get('/api/admin/mop', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const mop = getOfficialMops(data);
  res.json({ mop });
});

// Admin Create or Update Official MOP Endpoint
app.post('/api/admin/mop', auth, adminOnly, async (req, res) => {
  const method = String(req.body.method || '').trim();
  const account_name = String(req.body.account_name || '').trim();
  const account_number = String(req.body.account_number || '').trim();
  const qr_image = String(req.body.qr_image || '').trim();
  const instructions = String(req.body.instructions || '').trim();
  const is_active = req.body.is_active !== false;
  const is_primary = Boolean(req.body.is_primary);
  const id = req.body.id ? String(req.body.id).trim() : null;

  if (!method) return res.status(400).json({ error: 'Please specify payment method (e.g. GCash, Maya, GoTyme).' });
  if (!account_name) return res.status(400).json({ error: 'Please enter account name.' });
  if (!account_number) return res.status(400).json({ error: 'Please enter account/mobile number.' });

  try {
    const saved = await db.tx((data) => {
      if (!data.settings) data.settings = {};
      if (!Array.isArray(data.settings.official_mop)) {
        data.settings.official_mop = getOfficialMops(data).slice();
      }

      if (is_primary) {
        data.settings.official_mop.forEach((m) => { m.is_primary = false; });
      }

      let target = id ? data.settings.official_mop.find((m) => m.id === id) : null;
      if (target) {
        target.method = method;
        target.account_name = account_name;
        target.account_number = account_number;
        if (qr_image) target.qr_image = qr_image;
        else if (req.body.remove_qr) target.qr_image = '';
        target.instructions = instructions;
        target.is_active = is_active;
        target.is_primary = is_primary;
        target.updated_at = nowIso();
      } else {
        target = {
          id: id || `mop_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          method,
          account_name,
          account_number,
          qr_image: qr_image || '',
          instructions: instructions || 'Send payment to the official account, then attach the screenshot below.',
          is_active,
          is_primary: is_primary || data.settings.official_mop.length === 0,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        data.settings.official_mop.push(target);
      }
      return target;
    });

    res.json({ ok: true, mop: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save Mode of Payment.' });
  }
});

// Admin Delete Official MOP Endpoint
app.delete('/api/admin/mop/:id', auth, adminOnly, async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    await db.tx((data) => {
      if (!data.settings || !Array.isArray(data.settings.official_mop)) return;
      data.settings.official_mop = data.settings.official_mop.filter((m) => m.id !== id);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete Mode of Payment.' });
  }
});

// Admin Toggle MOP Active Status
app.post('/api/admin/mop/:id/toggle', auth, adminOnly, async (req, res) => {
  const id = String(req.params.id || '').trim();
  try {
    const updated = await db.tx((data) => {
      if (!data.settings || !Array.isArray(data.settings.official_mop)) return null;
      const target = data.settings.official_mop.find((m) => m.id === id);
      if (!target) return null;
      target.is_active = !target.is_active;
      target.updated_at = nowIso();
      return target;
    });
    if (!updated) return res.status(404).json({ error: 'MOP channel not found.' });
    res.json({ ok: true, mop: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle MOP status.' });
  }
});

function normalizePayoutMethod(m) {
  const s = String(m || '').toLowerCase().trim();
  if (s.includes('ub') || s.includes('unionbank')) return 'UnionBank (UB)';
  if (s.includes('maribank')) return 'MariBank';
  if (s.includes('gotyme')) return 'GoTyme';
  if (s.includes('maya')) return 'Maya';
  if (s.includes('gcash')) return 'GCash';
  return null;
}

const VALID_PAYOUT_METHODS = ['GCash', 'Maya', 'GoTyme', 'MariBank', 'UB', 'UnionBank', 'UnionBank (UB)'];

app.post('/api/account/password', auth, async (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || req.body.password || '');
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  try {
    const userRow = db.find('users', (u) => u.id === req.user.id);
    if (!userRow) return res.status(404).json({ error: 'Account not found.' });
    const ok = await bcrypt.compare(currentPassword, userRow.password);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 10);
    await db.tx((data) => {
      const u = data.users.find((x) => x.id === req.user.id);
      if (!u) {
        const err = new Error('Account not found.');
        err.status = 404;
        throw err;
      }
      u.password = hash;
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

app.get('/api/profit-sharing', auth, (_req, res) => {
  const data = db.getStore();
  res.json({
    pool_total: money((data.profit_sharing_pool && data.profit_sharing_pool.total_amount) || 0),
    qualified_members: db.listQualifiedMembers(data).map((q) => ({
      username: q.username,
      shares: q.shares,
    })),
  });
});

app.get('/api/admin/profit-sharing', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const qualified = db.listQualifiedMembers(data);
  const totalShares = qualified.reduce((s, q) => s + q.shares, 0);
  const pool = money((data.profit_sharing_pool && data.profit_sharing_pool.total_amount) || 0);
  const rate = totalShares > 0 ? money(pool / totalShares) : 0;
  res.json({
    pool_total: pool,
    total_qualified_shares: totalShares,
    rate_per_share: rate,
    qualified_members: qualified,
    recent_disbursements: (data.profit_sharing_disbursements || []).slice().sort((a, b) => b.id - a.id).slice(0, 50),
    tiers: db.PROFIT_SHARE_TIERS,
  });
});

app.post('/api/admin/profit-sharing/release', auth, adminOnly, async (_req, res) => {
  try {
    const result = await db.tx((data) => {
      db.ensureStoreShape(data);
      const pool = money((data.profit_sharing_pool && data.profit_sharing_pool.total_amount) || 0);
      if (pool <= 0) {
        const err = new Error('Profit sharing pool is empty.');
        err.status = 400;
        throw err;
      }
      const qualified = db.listQualifiedMembers(data);
      const totalShares = qualified.reduce((s, q) => s + q.shares, 0);
      if (!qualified.length || totalShares <= 0) {
        const err = new Error('No qualified members to receive profit sharing.');
        err.status = 400;
        throw err;
      }
      const rate = pool / totalShares;
      const batchId = `ps_${Date.now()}`;
      const payouts = [];
      let distributed = 0;
      qualified.forEach((q, idx) => {
        let amount = money(q.shares * rate);
        if (idx === qualified.length - 1) {
          amount = money(pool - distributed);
        }
        distributed = money(distributed + amount);
        let wallet = data.wallets.find((w) => Number(w.user_id) === Number(q.user_id));
        if (!wallet) {
          wallet = emptyWallet(q.user_id);
          data.wallets.push(wallet);
        }
        wallet.profit_sharing_balance = money((Number(wallet.profit_sharing_balance) || 0) + amount);
        logEarning(data, {
          userId: q.user_id,
          category: 'profit_sharing',
          amount,
          description: `Profit sharing release · ${q.shares} share(s) @ ₱${money(rate)}`,
          refId: batchId,
        });
        const rec = db.insert('profit_sharing_disbursements', {
          batch_id: batchId,
          user_id: q.user_id,
          username: q.username,
          shares: q.shares,
          rate_per_share: money(rate),
          amount,
          pool_total: pool,
          total_shares: totalShares,
          created_at: nowIso(),
        });
        payouts.push(rec);
      });
      data.profit_sharing_pool.total_amount = 0;
      return {
        batch_id: batchId,
        pool_released: pool,
        total_shares: totalShares,
        rate_per_share: money(rate),
        payouts,
      };
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to release profit sharing.' });
  }
});

app.post('/api/admin/users/:id/password', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const newPassword = String(req.body.new_password || req.body.password || '');
  if (!id) return res.status(400).json({ error: 'Invalid user.' });
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }
  try {
    const hash = await bcrypt.hash(newPassword, 10);
    await db.tx((data) => {
      const u = data.users.find((x) => x.id === id);
      if (!u) {
        const err = new Error('User not found.');
        err.status = 404;
        throw err;
      }
      u.password = hash;
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not change password.' });
  }
});

app.post('/api/user/payout-account', auth, async (req, res) => {
  const rawMethod = String(req.body.method || '').trim();
  const normalizedMethod = normalizePayoutMethod(rawMethod);
  const account_name = String(req.body.account_name || '').trim();
  const account_number = String(req.body.account_number || '').trim();

  if (!normalizedMethod) {
    return res.status(400).json({ error: 'Please select a valid payment method: GCash, Maya, GoTyme, MariBank, or UB.' });
  }
  if (!account_name || account_name.length < 2) {
    return res.status(400).json({ error: 'Please enter a valid Account Name (minimum 2 characters).' });
  }
  if (!account_number || account_number.length < 5) {
    return res.status(400).json({ error: 'Please enter a valid Account/Mobile Number (minimum 5 digits).' });
  }

  try {
    const payoutAccount = await db.tx((data) => {
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user) {
        const err = new Error('User not found.');
        err.status = 404;
        throw err;
      }
      user.payout_account = {
        method: normalizedMethod,
        account_name,
        account_number,
        updated_at: nowIso(),
      };
      return user.payout_account;
    });
    res.json({ ok: true, payout_account: payoutAccount });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to bind payout account.' });
  }
});

async function requestWithdrawal(req, res, walletType) {
  const amount = money(req.body.amount);
  const column = WALLET_COLUMNS[walletType];
  if (!column) return res.status(400).json({ error: 'Unknown wallet.' });
  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ error: `Minimum withdrawal is ₱${MIN_WITHDRAWAL} per wallet.` });
  }
  const feeRate = feeRateForAmount(amount);

  try {
    const withdrawal = await db.tx((data) => {
      if (!Number(data.settings.weekly_payout_enabled)) {
        const err = new Error('Weekly payouts are currently disabled.');
        err.status = 403;
        throw err;
      }
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user || user.status === 'banned') {
        const err = new Error('Account cannot withdraw.');
        err.status = 403;
        throw err;
      }

      // Check or update bound payout account
      let payout = user.payout_account;
      if (req.body.method && req.body.account_name && req.body.account_number) {
        const norm = normalizePayoutMethod(req.body.method) || 'GCash';
        payout = {
          method: norm,
          account_name: String(req.body.account_name).trim(),
          account_number: String(req.body.account_number).trim(),
          updated_at: nowIso(),
        };
        user.payout_account = payout;
      }

      if (!payout || !payout.method || !payout.account_number) {
        const err = new Error('Please bind your payout account (GCash, Maya, GoTyme, MariBank, or UB) before cashing out.');
        err.status = 400;
        throw err;
      }

      const wallet = data.wallets.find((w) => w.user_id === req.user.id);
      const bal = money(wallet[column]);
      if (amount > bal) {
        const err = new Error('Insufficient wallet balance.');
        err.status = 400;
        throw err;
      }
      const fee = money(amount * feeRate);
      const net = money(amount - fee);
      wallet[column] = money(bal - amount);
      return db.insert('withdrawals', {
        user_id: req.user.id,
        wallet_type: walletType,
        amount,
        fee,
        net_amount: net,
        payout_method: payout.method,
        account_name: payout.account_name,
        account_number: payout.account_number,
        status: 'pending',
        created_at: nowIso(),
        processed_at: null,
      });
    });
    res.status(201).json({ withdrawal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Withdrawal request failed.' });
  }
}

app.post('/api/withdraw/binary-ref', auth, (req, res) => requestWithdrawal(req, res, 'binary_ref'));
app.post('/api/withdraw/tradein-ref', auth, (req, res) => requestWithdrawal(req, res, 'tradein_ref'));
app.post('/api/withdraw/tradein-cycle', auth, (req, res) => requestWithdrawal(req, res, 'tradein_cycle'));
app.post('/api/withdraw/profit-sharing', auth, (req, res) => requestWithdrawal(req, res, 'profit_sharing'));

app.get('/api/admin/overview', auth, adminOnly, async (_req, res) => {
  await processTradeinYields().catch(() => { });
  const data = db.getStore();

  const approvedWds = data.withdrawals.filter((w) => w.status === 'approved');
  const pendingWds = data.withdrawals.filter((w) => w.status === 'pending');
  const total_cashout = money(approvedWds.reduce((s, w) => s + Number(w.net_amount || w.amount || 0), 0));
  const total_cashout_gross = money(approvedWds.reduce((s, w) => s + Number(w.amount || 0), 0));
  const total_cashout_count = approvedWds.length;

  const pending_cashout = money(pendingWds.reduce((s, w) => s + Number(w.net_amount || w.amount || 0), 0));
  const pending_cashout_gross = money(pendingWds.reduce((s, w) => s + Number(w.amount || 0), 0));
  const pending_cashout_count = pendingWds.length;
  const pending_tradeins = data.tradein_packages.filter((p) => p.cycle_status === 'pending').length;
  const pending_load_wallets = (data.load_wallet_requests || []).filter((r) => r.status === 'pending').length;

  res.json({
    users: data.users.length,
    active: data.users.filter((u) => u.status === 'active').length,
    available_codes: data.code_vault.filter((c) => c.status === 'available').length,
    pending_withdrawals: pendingWds.length,
    pending_tradeins,
    pending_load_wallets,
    total_cashout,
    total_cashout_gross,
    total_cashout_count,
    pending_cashout,
    pending_cashout_gross,
    pending_cashout_count,
    kpis: {
      tradein_deposit: money(data.tradein_packages.reduce((s, p) => s + Number(p.capital), 0)),
      tradein_ref: money(data.wallets.reduce((s, w) => s + Number(w.tradein_ref_balance), 0)),
      total_code: data.code_vault.length,
      total_code_buy: data.code_vault.filter((c) => c.status === 'used' || c.assigned_to).length,
      total_binary: money(data.users.reduce((s, u) => s + Number(u.total_binary_earnings || 0), 0)),
      total_cashout,
      pending_cashout,
    },
    wallets: {
      binary_ref: data.wallets.reduce((s, w) => s + Number(w.binary_ref_balance), 0),
      tradein_ref: data.wallets.reduce((s, w) => s + Number(w.tradein_ref_balance), 0),
      tradein_cycle: data.wallets.reduce((s, w) => s + Number(w.tradein_cycle_balance), 0),
    },
    weekly_payout_enabled: Boolean(data.settings.weekly_payout_enabled),
    binary_cap: getBinaryCap(data),
    profit_sharing_pool: money((data.profit_sharing_pool && data.profit_sharing_pool.total_amount) || 0),
  });
});

app.get('/api/admin/users', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const users = data.users
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
    .map((u) => adminUserRow(u.id, data));
  res.json({ users });
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user.' });
  try {
    await db.tx((data) => {
      const u = data.users.find((x) => x.id === id);
      if (!u) {
        const err = new Error('User not found.');
        err.status = 404;
        throw err;
      }
      if (u.role === 'admin') {
        const err = new Error('Admin accounts cannot be deleted.');
        err.status = 400;
        throw err;
      }
      const tree = data.binary_tree.find((t) => t.user_id === id);
      const parentId = tree ? tree.parent_id : null;
      const sponsorId = tree ? tree.sponsor_id : null;
      data.binary_tree.forEach((child) => {
        if (child.parent_id === id) child.parent_id = parentId;
        if (child.sponsor_id === id) child.sponsor_id = sponsorId || parentId;
      });
      data.users = data.users.filter((x) => x.id !== id);
      data.wallets = data.wallets.filter((x) => x.user_id !== id);
      data.binary_tree = data.binary_tree.filter((x) => x.user_id !== id);
      data.tradein_packages = data.tradein_packages.filter((x) => x.user_id !== id);
      data.withdrawals = data.withdrawals.filter((x) => x.user_id !== id);
      data.code_vault.forEach((c) => {
        if (c.assigned_to === id) {
          c.assigned_to = null;
          if (c.status !== 'used') c.status = 'available';
        }
      });
    });
    res.json({ ok: true });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not delete user.' });
  }
});

// Admin Activate Inactive Member (e.g. Admin Directs or any pending downlines)
app.post('/api/admin/users/:id/activate', auth, adminOnly, async (req, res) => {
  const targetId = Number(req.params.id);
  const rawPos = req.body.position ? String(req.body.position).trim().toUpperCase() : null;
  const preferredPos = rawPos === 'R' ? 'R' : rawPos === 'L' ? 'L' : null;
  const placementParentId = req.body.placement_parent_id ? Number(req.body.placement_parent_id) : null;
  const placementMobile = req.body.placement_mobile ? normalizeUsername(req.body.placement_mobile) : null;
  const codeParam = req.body.code ? normalizeCode(req.body.code) : null;
  const autoCode = Boolean(req.body.auto_generate_code || !codeParam);

  try {
    const result = await db.tx((data) => {
      const admin = data.users.find((u) => u.id === req.user.id);
      if (!admin || admin.role !== 'admin') {
        const err = new Error('Admin authorization required.');
        err.status = 403;
        throw err;
      }

      const target = data.users.find((u) => u.id === targetId);
      if (!target) {
        const err = new Error('Member not found.');
        err.status = 404;
        throw err;
      }
      if (target.status === 'active') {
        const err = new Error(`Member "${target.username || target.mobile_number}" is already active.`);
        err.status = 400;
        throw err;
      }
      if (target.status === 'banned') {
        const err = new Error('Cannot activate a banned account.');
        err.status = 400;
        throw err;
      }

      // Check member tree record
      let targetTree = data.binary_tree.find((t) => t.user_id === target.id);
      let sponsorId = targetTree && targetTree.sponsor_id ? targetTree.sponsor_id : admin.id;
      if (!targetTree) {
        targetTree = emptyTree(target.id, null, sponsorId, null);
        data.binary_tree.push(targetTree);
      }

      // Placement parent starting node
      let startNodeId = sponsorId;
      let pUser = null;
      if (placementParentId) {
        pUser = data.users.find((x) => x.id === placementParentId && x.status === 'active');
        if (!pUser) {
          const err = new Error('Selected placement parent node was not found or is not active.');
          err.status = 400;
          throw err;
        }
        startNodeId = pUser.id;
      } else if (placementMobile) {
        pUser = data.users.find((x) => ((x.username && x.username.toLowerCase() === placementMobile.toLowerCase()) || (x.mobile_number && x.mobile_number.toLowerCase() === placementMobile.toLowerCase())) && x.status === 'active');
        if (!pUser) {
          const err = new Error(`Placement upline ${placementMobile} is not an active member.`);
          err.status = 400;
          throw err;
        }
        startNodeId = pUser.id;
      }

      // If specific parent & pos given, verify slot is open; else assignPlacement
      let place;
      if (pUser && preferredPos) {
        const existingChild = data.binary_tree.find((t) => t.parent_id === pUser.id && t.position === preferredPos);
        if (existingChild) {
          const childUser = data.users.find((u) => u.id === existingChild.user_id);
          const childName = childUser ? (childUser.username || childUser.mobile_number) : `#${existingChild.user_id}`;
          const err = new Error(`Position ${preferredPos === 'L' ? 'Left' : 'Right'} of ${pUser.username || pUser.mobile_number} is already occupied by ${childName}.`);
          err.status = 400;
          throw err;
        }
        place = { parentId: pUser.id, position: preferredPos };
      } else {
        place = assignPlacement(startNodeId, preferredPos, data);
      }

      // Find code or mint new code
      let vault = null;
      if (codeParam) {
        vault = data.code_vault.find((c) => normalizeCode(c.code) === codeParam && c.status !== 'used');
        if (!vault) {
          const err = new Error('Activation code is invalid or already used.');
          err.status = 400;
          throw err;
        }
      } else if (autoCode) {
        let codeStr = generateRandomCode(8);
        while (data.code_vault.some((c) => c.code === codeStr)) {
          codeStr = generateRandomCode(8);
        }
        vault = db.insert('code_vault', {
          code: codeStr,
          status: 'assigned',
          assigned_to: admin.id,
          used_by: null,
          created_at: nowIso(),
          used_at: null,
        });
      }

      // Set binary tree placement
      targetTree.parent_id = place.parentId;
      targetTree.position = place.position;
      targetTree.sponsor_id = sponsorId;

      // Mark code as used
      vault.status = 'used';
      vault.used_by = target.id;
      vault.encoded_by = admin.id;
      vault.used_at = nowIso();
      vault.placement_parent_id = place.parentId;
      vault.position = place.position;

      // Activate target user
      target.status = 'active';
      target.parent_id = sponsorId;
      db.ingestCodeActivationPool(data);
      db.syncUserDownlineFields(target, data);

      // Commissions
      paySponsorBinary(data, sponsorId, target.id);
      processPairing(data, place.parentId, place.position, target.id);

      return {
        user: adminUserRow(target.id, data),
        placement: {
          parent_id: place.parentId,
          parent_mobile: mobileOf(place.parentId, data),
          position: place.position,
        },
        code_used: vault.code,
      };
    });

    res.json({
      ok: true,
      message: `Account ${result.user.mobile_number} successfully activated and placed under ${result.placement.parent_mobile} (${result.placement.position === 'L' ? 'Left' : 'Right'} Leg)!`,
      user: result.user,
      placement: result.placement,
      code_used: result.code_used,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Admin activate user error:', err);
    res.status(500).json({ error: 'Failed to activate member.' });
  }
});

app.get('/api/admin/tradein', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const packages = data.tradein_packages
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
    .map((p) => ({
      ...p,
      mobile_number: mobileOf(p.user_id, data),
      cycle_info: getPackageCycleInfo(p),
    }));
  res.json({ packages });
});

app.get('/api/admin/tradein/:id/receipt', auth, adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const data = db.getStore();
  const pkg = data.tradein_packages.find((p) => p.id === id);
  if (!pkg) return res.status(404).json({ error: 'Trade-in package not found.' });
  const receipt_image = pkg.receipt_image || pkg.receipt_url || null;
  res.json({
    id: pkg.id,
    user_id: pkg.user_id,
    mobile_number: mobileOf(pkg.user_id, data),
    capital: pkg.capital,
    payment_method: pkg.payment_method,
    ref_number: pkg.ref_number,
    receipt_image,
    receipt_url: receipt_image,
    has_receipt: Boolean(receipt_image)
  });
});

app.post('/api/admin/tradein/:id/approve', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const pkg = await db.tx((data) => {
      const p = data.tradein_packages.find((x) => x.id === id);
      if (!p) {
        const err = new Error('Trade-in package not found.');
        err.status = 404;
        throw err;
      }
      if (p.cycle_status !== 'pending') {
        const err = new Error(`Package is already ${p.cycle_status}.`);
        err.status = 400;
        throw err;
      }
      p.cycle_status = 'active';
      p.start_date = nowIso();
      p.cycle_start_date = nowIso(); // Initialize Cycle 1 countdown timer
      p.payouts_completed = 0;
      p.approved_at = nowIso();
      if (isRolloverTradein(p) && p.rolled_from_package_id) {
        const source = data.tradein_packages.find((x) => x.id === p.rolled_from_package_id);
        if (source) {
          source.capital_rolled_over = true;
          source.rolled_over_at = nowIso();
          source.rolled_over_package_id = p.id;
        }
      }
      payTradeinReferrals(data, p.user_id, p.capital, p.id);
      db.ingestTradeinEntryPool(data, p.capital);
      const buyer = data.users.find((u) => u.id === p.user_id);
      if (buyer) db.syncUserDownlineFields(buyer, data);
      return p;
    });
    res.json({ ok: true, package: { ...pkg, cycle_info: getPackageCycleInfo(pkg) } });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to approve trade-in package.' });
  }
});

app.post('/api/admin/tradein/:id/reject', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body.reason || '').trim();
  try {
    const pkg = await db.tx((data) => {
      const p = data.tradein_packages.find((x) => x.id === id);
      if (!p) {
        const err = new Error('Trade-in package not found.');
        err.status = 404;
        throw err;
      }
      if (p.cycle_status !== 'pending') {
        const err = new Error(`Package is already ${p.cycle_status}.`);
        err.status = 400;
        throw err;
      }
      p.cycle_status = 'rejected';
      p.rejected_at = nowIso();
      p.reject_reason = reason || 'Payment could not be verified.';
      p.rejection_reason = p.reject_reason;
      if (isRolloverTradein(p) && p.rolled_from_package_id) {
        const source = data.tradein_packages.find((x) => x.id === p.rolled_from_package_id);
        if (source && source.rolled_over_package_id === p.id && !source.capital_rolled_over) {
          source.rolled_over_package_id = null;
          source.rollover_submitted_at = null;
        }
      }
      return p;
    });
    res.json({ ok: true, package: pkg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to reject trade-in package.' });
  }
});

app.get('/api/admin/withdrawals', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const withdrawals = data.withdrawals
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 300)
    .map((w) => {
      const u = data.users.find((x) => x.id === w.user_id);
      const userPayout = u && u.payout_account ? u.payout_account : null;
      return {
        ...w,
        mobile_number: u ? u.mobile_number : '',
        payout_method: w.payout_method || (userPayout ? userPayout.method : '—'),
        account_name: w.account_name || (userPayout ? userPayout.account_name : '—'),
        account_number: w.account_number || (userPayout ? userPayout.account_number : '—'),
      };
    });
  res.json({ withdrawals });
});

app.post('/api/admin/withdrawals/:id/review', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  const action = req.body.action === 'reject' ? 'rejected' : req.body.action === 'approve' ? 'approved' : null;
  if (!id || !action) return res.status(400).json({ error: 'action must be approve or reject.' });

  try {
    await db.tx((data) => {
      const wd = data.withdrawals.find((w) => w.id === id);
      if (!wd || wd.status !== 'pending') {
        const err = new Error('Withdrawal is not pending.');
        err.status = 400;
        throw err;
      }
      if (action === 'rejected') {
        const column = WALLET_COLUMNS[wd.wallet_type];
        const wallet = data.wallets.find((w) => w.user_id === wd.user_id);
        wallet[column] = money(wallet[column] + wd.amount);
      }
      wd.status = action;
      wd.processed_at = nowIso();
    });
    res.json({ ok: true, status: action });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not review withdrawal.' });
  }
});

app.post('/api/admin/codes', auth, adminOnly, async (req, res) => {
  const custom = Array.isArray(req.body.codes)
    ? req.body.codes.map((c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean)
    : [];
  const count = Math.min(50, Math.max(1, Number(req.body.count) || (custom.length ? custom.length : 3)));
  const codes = [];

  if (custom.length > 0) {
    for (const c of custom) {
      if (c.length >= 6) codes.push(c);
    }
  } else {
    for (let i = 0; i < count; i += 1) {
      codes.push(generateRandomCode(8));
    }
  }

  if (codes.length === 0) {
    return res.status(400).json({ error: 'No valid codes to generate.' });
  }

  try {
    await db.tx((data) => {
      for (const code of codes) {
        if (data.code_vault.some((c) => c.code === code)) {
          const err = new Error(`Code ${code} already exists.`);
          err.status = 409;
          throw err;
        }
        db.insert('code_vault', {
          code,
          status: 'available',
          assigned_to: null,
          used_by: null,
          created_at: nowIso(),
          used_at: null,
        });
      }
    });
    res.status(201).json({ codes });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not generate codes.' });
  }
});

app.get('/api/user/codes', auth, (req, res) => {
  const data = db.getStore();
  const codes = data.code_vault
    .filter((c) => c.assigned_to === req.user.id)
    .sort((a, b) => b.id - a.id)
    .map((c) => ({
      ...c,
      used_by_mobile: c.used_by ? mobileOf(c.used_by, data) : '',
      placement_parent_mobile: c.placement_parent_id ? mobileOf(c.placement_parent_id, data) : '',
      position: c.position || '',
    }));
  res.json({ codes });
});

app.post('/api/admin/codes/send', auth, adminOnly, async (req, res) => {
  const rawTarget = String(req.body.recipient || req.body.mobile_number || req.body.username || req.body.user_id || '').trim();
  const qty = Math.min(50, Math.max(1, Number(req.body.qty || req.body.quantity) || 1));
  if (!rawTarget) return res.status(400).json({ error: 'Enter a valid member username, mobile number, or ID.' });

  try {
    const sent = await db.tx((data) => {
      const user = db.findUserByExactUsername(data, rawTarget);

      if (!user) {
        const err = new Error(`Member "${rawTarget}" was not found. Username must match exactly.`);
        err.status = 404;
        throw err;
      }

      // Get available codes
      let free = data.code_vault.filter((c) => c.status === 'available' && !c.assigned_to);

      // Auto-mint if more codes are needed than currently available
      const needed = qty - free.length;
      if (needed > 0) {
        for (let i = 0; i < needed; i++) {
          let codeStr;
          do {
            codeStr = generateRandomCode(8);
          } while (data.code_vault.some((c) => c.code === codeStr));

          const newCode = db.insert('code_vault', {
            code: codeStr,
            status: 'available',
            assigned_to: null,
            used_by: null,
            created_at: nowIso(),
            used_at: null,
          });
          free.push(newCode);
        }
      }

      const picked = free.slice(0, qty);
      picked.forEach((c) => {
        c.assigned_to = user.id;
        c.status = 'assigned';
      });
      return picked.map((c) => c.code);
    });
    res.json({ codes: sent, mobile: rawTarget, username: rawTarget });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not send codes.' });
  }
});

// ==========================================
// BUY LOAD WALLET ENDPOINTS
// ==========================================

// Buy Load Wallet - User submit order
app.post('/api/load-wallet/request', auth, async (req, res) => {
  const amount = money(Number(req.body.amount));
  const phoneNumber = String(req.body.phone_number || '').trim();
  const paymentMethod = String(req.body.payment_method || 'GCash').trim();
  const refNumber = String(req.body.reference_number || req.body.ref_number || '').trim();
  const receiptImage = String(req.body.receipt_image || req.body.receipt_url || '').trim();

  if (!amount || amount < 50) {
    return res.status(400).json({ error: 'Please enter a valid load amount (minimum ₱50.00).' });
  }
  const cleanPhone = phoneNumber.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
    return res.status(400).json({ error: 'Please enter a valid phone number (e.g. 09171234567) where the load wallet will be sent.' });
  }
  if (!receiptImage) {
    return res.status(400).json({ error: 'Please attach a payment receipt screenshot.' });
  }

  try {
    const saved = await db.tx((data) => {
      if (!Array.isArray(data.load_wallet_requests)) data.load_wallet_requests = [];
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user || user.status === 'banned') {
        const err = new Error('Account not permitted to purchase load wallet.');
        err.status = 403;
        throw err;
      }

      const rec = db.insert('load_wallet_requests', {
        user_id: user.id,
        amount,
        phone_number: phoneNumber,
        clean_phone: cleanPhone,
        payment_method: paymentMethod,
        reference_number: refNumber,
        receipt_image: receiptImage,
        status: 'pending', // 'pending' | 'approved' | 'rejected'
        admin_notes: '',
        created_at: nowIso(),
        approved_at: null,
        rejected_at: null,
      });
      return rec;
    });

    res.status(201).json({ ok: true, request: saved });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to submit load wallet order.' });
  }
});

// Newly Activated Accounts - Claim ₱100 Load Wallet
app.post('/api/load-wallet/claim-100', auth, async (req, res) => {
  const phoneNumber = String(req.body.phone_number || '').trim();
  const network = String(req.body.network || '').trim();
  const actionType = String(req.body.action_type || '').trim(); // 'activate_and_claim' | 'claim_only'

  const allowedNetworks = ['Globe', 'Smart', 'TNT', 'DITO'];
  if (!allowedNetworks.includes(network)) {
    return res.status(400).json({ error: 'Please select a valid network (Globe, Smart, TNT, or DITO).' });
  }

  const cleanPhone = phoneNumber.replace(/\D/g, '');
  if (!cleanPhone || cleanPhone.length < 10 || cleanPhone.length > 13) {
    return res.status(400).json({ error: 'Please enter a valid Philippine mobile number (e.g. 09171234567).' });
  }

  const allowedActionTypes = ['activate_and_claim', 'claim_only'];
  if (!allowedActionTypes.includes(actionType)) {
    return res.status(400).json({ error: 'Please select an activation option.' });
  }

  try {
    const result = await db.tx((data) => {
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user || user.status === 'banned') {
        const err = new Error('Account not permitted to claim load wallet.');
        err.status = 403;
        throw err;
      }
      if (user.status !== 'active') {
        const err = new Error('Only activated accounts are eligible to claim the ₱100 Load Wallet. Please coordinate with your sponsor/upline to activate your account.');
        err.status = 400;
        throw err;
      }
      if (user.load_wallet_claimed) {
        const err = new Error('The ₱100 Load Wallet has already been claimed for this account. This privilege can only be claimed once.');
        err.status = 400;
        throw err;
      }

      if (!Array.isArray(data.load_wallet_requests)) data.load_wallet_requests = [];

      user.load_wallet_claimed = true;
      user.load_wallet_claimed_at = nowIso();
      user.load_wallet_claim_info = {
        phone_number: phoneNumber,
        clean_phone: cleanPhone,
        network,
        action_type: actionType,
        claimed_at: nowIso(),
      };

      const actionLabel = actionType === 'activate_and_claim'
        ? 'Activate My Number and Claim 100 Load Wallet'
        : 'Claim 100 Load Wallet (Multiple Accounts / Already Activated)';

      const rec = db.insert('load_wallet_requests', {
        user_id: user.id,
        amount: 100,
        phone_number: phoneNumber,
        clean_phone: cleanPhone,
        network: network,
        payment_method: 'Welcome Activation Bonus',
        reference_number: `CLAIM100-${network.toUpperCase()}-${user.id}`,
        receipt_image: '',
        status: 'pending',
        is_welcome_claim: true,
        claim_type: actionType,
        admin_notes: `FREE ₱100 CLAIM · Network: ${network} · Mode: ${actionLabel}`,
        created_at: nowIso(),
        approved_at: null,
        rejected_at: null,
      });

      return { request: rec, user: publicUser(user.id, data) };
    });

    res.status(201).json({
      ok: true,
      message: '₱100 Load Wallet claimed successfully! Your order has been placed in the queue for processing.',
      request: result.request,
      user: result.user,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Claim 100 Load Wallet error:', err);
    res.status(500).json({ error: 'Failed to process load wallet claim.' });
  }
});

// Buy Load Wallet - User view their requests
app.get('/api/load-wallet/my-requests', auth, (req, res) => {
  const data = db.getStore();
  const list = (data.load_wallet_requests || [])
    .filter((r) => Number(r.user_id) === Number(req.user.id))
    .sort((a, b) => b.id - a.id)
    .slice(0, 50);
  res.json({ requests: list });
});

// Buy Load Wallet - Admin list requests
app.get('/api/admin/load-wallet', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const list = (data.load_wallet_requests || [])
    .slice()
    .sort((a, b) => b.id - a.id)
    .map((r) => {
      const u = data.users.find((x) => Number(x.id) === Number(r.user_id));
      return {
        ...r,
        user_mobile: u ? u.mobile_number : '-',
        username: u ? u.username : '-',
      };
    });
  res.json({ requests: list });
});

// Buy Load Wallet - Admin approve
app.post('/api/admin/load-wallet/:id/approve', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid load wallet request ID.' });

  try {
    const updated = await db.tx((data) => {
      if (!Array.isArray(data.load_wallet_requests)) data.load_wallet_requests = [];
      const item = data.load_wallet_requests.find((x) => x.id === id);
      if (!item) {
        const err = new Error('Load wallet request not found.');
        err.status = 404;
        throw err;
      }
      if (item.status === 'approved') {
        const err = new Error('Request is already approved.');
        err.status = 400;
        throw err;
      }
      item.status = 'approved';
      item.approved_at = nowIso();
      item.admin_notes = String(req.body.notes || item.admin_notes || '').trim();
      return item;
    });

    res.json({ ok: true, request: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to approve load wallet request.' });
  }
});

// Buy Load Wallet - Admin reject
app.post('/api/admin/load-wallet/:id/reject', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid load wallet request ID.' });

  try {
    const updated = await db.tx((data) => {
      if (!Array.isArray(data.load_wallet_requests)) data.load_wallet_requests = [];
      const item = data.load_wallet_requests.find((x) => x.id === id);
      if (!item) {
        const err = new Error('Load wallet request not found.');
        err.status = 404;
        throw err;
      }
      item.status = 'rejected';
      item.rejected_at = nowIso();
      item.admin_notes = String(req.body.notes || 'Payment could not be verified.').trim();
      return item;
    });

    res.json({ ok: true, request: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Failed to reject load wallet request.' });
  }
});

app.get('/api/admin/codes', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const codes = data.code_vault
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 500)
    .map((c) => {
      const treeNode = c.used_by ? data.binary_tree.find((t) => t.user_id === c.used_by) : null;
      const placementParentId = c.placement_parent_id || (treeNode ? treeNode.parent_id : null);
      const position = c.position || (treeNode ? treeNode.position : null);
      const sponsorId = treeNode ? treeNode.sponsor_id : null;
      return {
        ...c,
        assigned_mobile: c.assigned_to ? mobileOf(c.assigned_to, data) : '',
        used_mobile: c.used_by ? mobileOf(c.used_by, data) : (c.status === 'used' && c.assigned_to ? mobileOf(c.assigned_to, data) : ''),
        placement_parent_mobile: placementParentId ? mobileOf(placementParentId, data) : '',
        position: position || '',
        sponsor_mobile: sponsorId ? mobileOf(sponsorId, data) : '',
      };
    });
  res.json({ codes });
});

app.delete('/api/admin/codes/:id', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid code ID.' });
  try {
    await db.tx((data) => {
      const code = data.code_vault.find((c) => c.id === id);
      if (!code) {
        const err = new Error('Code not found.');
        err.status = 404;
        throw err;
      }
      if (code.status === 'used') {
        const err = new Error('Cannot delete a code that has already been used.');
        err.status = 400;
        throw err;
      }
      data.code_vault = data.code_vault.filter((c) => c.id !== id);
    });
    res.json({ ok: true, id });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not delete code.' });
  }
});

app.post('/api/admin/settings/payouts', auth, adminOnly, async (req, res) => {
  const enabled = req.body.enabled ? 1 : 0;
  await db.tx((data) => {
    data.settings.weekly_payout_enabled = enabled;
  });
  res.json({ weekly_payout_enabled: Boolean(enabled) });
});

app.post('/api/admin/process-yields', auth, adminOnly, async (_req, res) => {
  try {
    res.json(await processTradeinYields());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Yield processing failed.' });
  }
});

app.post('/api/admin/users/:id/ban', auth, adminOnly, async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid user.' });
  try {
    const user = await db.tx((data) => {
      const u = data.users.find((x) => x.id === id);
      if (!u) {
        const err = new Error('User not found.');
        err.status = 404;
        throw err;
      }
      if (u.role === 'admin') {
        const err = new Error('Admin accounts cannot be banned.');
        err.status = 400;
        throw err;
      }
      u.status = u.status === 'banned' ? 'active' : 'banned';
      return { id: u.id, status: u.status };
    });
    res.json({ ok: true, ...user });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not update user status.' });
  }
});

app.use((err, _req, res, _next) => {

  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

async function start() {
  await seedAdmin();
  setInterval(() => {
    processTradeinYields().catch((err) => console.error('yield job', err));
  }, 60 * 60 * 1000);
  app.listen(PORT, () => {
    console.log(`Infinite Trading running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start:', err.message || err);
  process.exit(1);
});
