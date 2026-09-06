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

const ENTRY_FEE = 300;
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

function normalizeMobile(raw) {
  const str = String(raw || '').trim();
  const digits = str.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 12 && digits.startsWith('63')) return `0${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith('09')) return digits;
  if (str.length >= 3 && /^[a-zA-Z0-9_\-.@]+$/.test(str)) return str;
  return null;
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
  return u ? u.mobile_number : '';
}

function adminUserRow(userId, data = db.getStore()) {
  const u = publicUser(userId, data);
  if (!u) return null;
  const sponsor = u.sponsor_id ? data.users.find((x) => x.id === u.sponsor_id) : null;
  const parent = u.parent_id ? data.users.find((x) => x.id === u.parent_id) : null;
  return {
    ...u,
    sponsor_mobile: sponsor ? sponsor.mobile_number : '',
    parent_mobile: parent ? parent.mobile_number : '',
    directs: data.binary_tree.filter((t) => t.sponsor_id === userId).length,
    packages: data.tradein_packages.filter((p) => p.user_id === userId).length,
  };
}

function publicUser(userId, data = db.getStore()) {
  const u = data.users.find((x) => x.id === userId);
  if (!u) return null;
  const w = data.wallets.find((x) => x.user_id === userId) || emptyWallet(userId);
  const t = data.binary_tree.find((x) => x.user_id === userId) || {};
  return {
    id: u.id,
    mobile_number: u.mobile_number,
    role: u.role,
    status: u.status,
    total_binary_earnings: u.total_binary_earnings,
    created_at: u.created_at,
    binary_ref_balance: w.binary_ref_balance,
    tradein_ref_balance: w.tradein_ref_balance,
    tradein_cycle_balance: w.tradein_cycle_balance,
    parent_id: t.parent_id || null,
    sponsor_id: t.sponsor_id || null,
    position: t.position || null,
    pairs_today: t.pairs_today || 0,
    last_pair_date: t.last_pair_date || null,
    payout_account: u.payout_account || null,
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
      path.unshift({
        id: u.id,
        mobile: u.mobile_number,
        mobile_number: u.mobile_number,
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

  return {
    id: u.id,
    mobile: u.mobile_number,
    mobile_number: u.mobile_number,
    status: u.status,
    position: node ? node.position : null,
    sponsor_mobile: sponsor ? sponsor.mobile_number : null,
    parent_mobile: parent ? parent.mobile_number : null,
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
        list.push({ id: u.id, mobile: u.mobile_number, position: kid.position });
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

function creditBinary(data, userId, amount) {
  const creditWanted = money(amount);
  if (creditWanted <= 0) return 0;
  const user = data.users.find((x) => x.id === userId);
  const wallet = data.wallets.find((x) => x.user_id === userId);
  if (!user || !wallet || user.status !== 'active') return 0;

  const earned = money(user.total_binary_earnings);
  const room = money(BINARY_CAP - earned);
  if (room <= 0) {
    user.status = 'expired';
    return 0;
  }

  const credit = Math.min(creditWanted, room);
  user.total_binary_earnings = money(earned + credit);
  wallet.binary_ref_balance = money(wallet.binary_ref_balance + credit);
  if (user.total_binary_earnings >= BINARY_CAP) user.status = 'expired';
  return credit;
}

function resetPairsIfNeeded(node) {
  const today = new Date().toISOString().slice(0, 10);
  const last = node.last_pair_date ? String(node.last_pair_date).slice(0, 10) : null;
  if (last !== today) {
    node.pairs_today = 0;
    node.last_pair_date = today;
  }
}

function processPairing(data, parentId, incomingPosition) {
  let currentId = parentId;
  let side = incomingPosition;

  while (currentId) {
    const node = data.binary_tree.find((x) => x.user_id === currentId);
    if (!node) break;
    resetPairsIfNeeded(node);
    if (side === 'L') node.leftover_left += 1;
    else node.leftover_right += 1;

    while (node.leftover_left > 0 && node.leftover_right > 0) {
      if (node.pairs_today >= MAX_PAIRS_PER_DAY) break;
      const credited = creditBinary(data, node.user_id, PAIR_BONUS);
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

function paySponsorBinary(data, sponsorId) {
  if (!sponsorId) return;
  creditBinary(data, sponsorId, DIRECT_BONUS);
  let current = sponsorId;
  for (let level = 2; level <= 4; level += 1) {
    const row = data.binary_tree.find((x) => x.user_id === current);
    if (!row || !row.sponsor_id) break;
    current = row.sponsor_id;
    creditBinary(data, current, INDIRECT_BONUS);
  }
}

function payTradeinReferrals(data, buyerId, capital) {
  let current = buyerId;
  for (let i = 0; i < TRADEIN_REF_RATES.length; i += 1) {
    const row = data.binary_tree.find((x) => x.user_id === current);
    if (!row || !row.sponsor_id) break;
    current = row.sponsor_id;
    const user = data.users.find((x) => x.id === current);
    const wallet = data.wallets.find((x) => x.user_id === current);
    if (!user || !wallet || user.status !== 'active') continue;
    wallet.tradein_ref_balance = money(wallet.tradein_ref_balance + capital * TRADEIN_REF_RATES[i]);
  }
}

function processTradeinYieldsIn(data) {
  const packages = data.tradein_packages.filter((p) => p.cycle_status === 'active');
  let paid = 0;
  for (const pkg of packages) {
    const start = new Date(pkg.start_date);
    const days = Math.floor((Date.now() - start.getTime()) / 86400000);
    const expected = Math.min(TRADEIN_PAYOUTS, Math.floor(days / TRADEIN_PAYOUT_EVERY));
    const due = expected - Number(pkg.payouts_completed);
    if (due <= 0) continue;
    const installment = money(Number(pkg.total_return) / TRADEIN_PAYOUTS);
    const credit = money(installment * due);
    const wallet = data.wallets.find((x) => x.user_id === pkg.user_id);
    if (!wallet) continue;
    wallet.tradein_cycle_balance = money(wallet.tradein_cycle_balance + credit);
    pkg.payouts_completed = Number(pkg.payouts_completed) + due;
    if (pkg.payouts_completed >= TRADEIN_PAYOUTS) pkg.cycle_status = 'completed';
    paid += 1;
  }
  return { processed: packages.length, updated: paid };
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
        mobile_number: mobile,
        password: hash,
        role: 'admin',
        status: 'active',
        total_binary_earnings: 0,
        created_at: nowIso(),
      });
      data.wallets.push(emptyWallet(admin.id));
      data.binary_tree.push(emptyTree(admin.id, null, null, null));
    } else {
      admin.mobile_number = mobile;
      admin.password = hash;
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
    console.log(`Admin account ready: ${mobile}`);
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: 'file', file: 'data/store.json' });
});

app.get('/api/config', (_req, res) => {
  res.json({
    entryFee: ENTRY_FEE,
    binaryCap: BINARY_CAP,
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
  const mobile = normalizeMobile(req.body.mobile_number);
  const password = String(req.body.password || '');
  const sponsorMobile = req.body.sponsor_mobile ? normalizeMobile(req.body.sponsor_mobile) : null;

  if (!mobile) return res.status(400).json({ error: 'Enter a valid PH mobile number.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const userId = await db.tx((data) => {
      if (data.users.some((u) => u.mobile_number === mobile)) {
        const err = new Error('Mobile number is already registered.');
        err.status = 409;
        throw err;
      }

      let sponsorId = null;
      if (sponsorMobile) {
        const sponsor = data.users.find((u) => u.mobile_number === sponsorMobile);
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
        mobile_number: mobile,
        password: hash,
        role: 'user',
        status: 'inactive',
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
  const mobile = normalizeMobile(req.body.mobile_number);
  const password = String(req.body.password || '');
  if (!mobile || !password) return res.status(400).json({ error: 'Mobile number and password are required.' });

  const userRow = db.find('users', (u) => u.mobile_number === mobile);
  if (!userRow) return res.status(401).json({ error: 'Invalid mobile number or password.' });

  const ok = await bcrypt.compare(password, userRow.password);
  if (!ok) return res.status(401).json({ error: 'Invalid mobile number or password.' });
  if (userRow.status === 'banned') return res.status(403).json({ error: 'This account is banned.' });

  const user = publicUser(userRow.id);
  res.json({ token: signToken(userRow), user });
});

app.post('/api/account/activate', auth, async (req, res) => {
  const code = normalizeCode(req.body.code);
  const rawPos = String(req.body.position || '').trim().toUpperCase();
  const preferredPos = rawPos.startsWith('R') ? 'R' : rawPos.startsWith('L') ? 'L' : null;
  const placementMobile = req.body.placement_mobile ? normalizeMobile(req.body.placement_mobile) : null;

  if (!code || code.length < 6) {
    return res.status(400).json({ error: 'Please enter a valid 8-character activation code.' });
  }

  try {
    const result = await db.tx((data) => {
      const u = data.users.find((x) => x.id === req.user.id);
      if (!u) {
        const err = new Error('Account not found.');
        err.status = 404;
        throw err;
      }
      if (u.status === 'active') {
        const err = new Error('Account is already activated.');
        err.status = 400;
        throw err;
      }
      if (u.status === 'banned') {
        const err = new Error('This account is banned.');
        err.status = 403;
        throw err;
      }

      // Check code vault - universal & random codes
      const vault = data.code_vault.find((c) => normalizeCode(c.code) === code && c.status !== 'used');
      if (!vault) {
        const err = new Error('Activation code is invalid or already used.');
        err.status = 400;
        throw err;
      }

      // Determine sponsor
      let treeNode = data.binary_tree.find((t) => t.user_id === u.id);
      let sponsorId = treeNode && treeNode.sponsor_id ? treeNode.sponsor_id : null;
      if (!sponsorId) {
        const admin = data.users.filter((x) => x.role === 'admin').sort((a, b) => a.id - b.id)[0];
        sponsorId = admin ? admin.id : 1;
      }

      if (!treeNode) {
        treeNode = emptyTree(u.id, null, sponsorId, null);
        data.binary_tree.push(treeNode);
      }

      // Placement root: either designated upline parent or fallback to sponsor
      let startNodeId = sponsorId;
      if (placementMobile) {
        const pUser = data.users.find((x) => x.mobile_number === placementMobile && x.status === 'active');
        if (pUser && data.binary_tree.some((t) => t.user_id === pUser.id)) {
          startNodeId = pUser.id;
        }
      }

      // Binary placement with deliberate positioning & spillover cascading
      const place = findPlacement(startNodeId, preferredPos, data);
      treeNode.parent_id = place.parentId;
      treeNode.position = place.position;
      treeNode.sponsor_id = sponsorId;

      // Mark code as used with full audit data for anti-fraud tracking
      vault.status = 'used';
      vault.used_by = u.id;
      if (!vault.assigned_to) {
        vault.assigned_to = u.id;
      }
      vault.used_at = nowIso();
      vault.placement_parent_id = place.parentId;
      vault.position = place.position;

      // Activate user account
      u.status = 'active';

      // Trigger Direct (₱50), Indirect (₱5), and Pairing Bonuses (₱50/pair)
      paySponsorBinary(data, sponsorId);
      processPairing(data, place.parentId, place.position);

      return {
        user: publicUser(u.id, data),
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
    res.status(500).json({ error: 'Account activation failed.' });
  }
});

// Sponsor / Encoder Downline Placement Endpoint
app.post('/api/binary/encode-downline', auth, async (req, res) => {
  const memberMobile = normalizeMobile(req.body.member_mobile);
  const code = normalizeCode(req.body.code);
  const rawPos = String(req.body.position || '').trim().toUpperCase();
  const preferredPos = rawPos.startsWith('R') ? 'R' : rawPos.startsWith('L') ? 'L' : null;
  const placementMobile = req.body.placement_mobile ? normalizeMobile(req.body.placement_mobile) : null;

  if (!memberMobile) return res.status(400).json({ error: 'Please enter a valid member mobile number to encode.' });
  if (!code || code.length < 6) return res.status(400).json({ error: 'Please enter a valid 8-character activation code.' });

  try {
    const result = await db.tx((data) => {
      const encoder = data.users.find((x) => x.id === req.user.id);
      if (!encoder || encoder.status === 'banned') {
        const err = new Error('You do not have permission to encode accounts.');
        err.status = 403;
        throw err;
      }

      const target = data.users.find((x) => x.mobile_number === memberMobile);
      if (!target) {
        const err = new Error(`Member with mobile ${memberMobile} was not found.`);
        err.status = 404;
        throw err;
      }
      if (target.status === 'active') {
        const err = new Error(`Member ${memberMobile} is already activated in the binary tree.`);
        err.status = 400;
        throw err;
      }
      if (target.status === 'banned') {
        const err = new Error('This account is banned.');
        err.status = 403;
        throw err;
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

      // Placement starting node: defaults to placement_mobile or encoder or sponsor
      let startNodeId = encoder.id;
      if (placementMobile) {
        const pUser = data.users.find((x) => x.mobile_number === placementMobile && x.status === 'active');
        if (pUser && data.binary_tree.some((t) => t.user_id === pUser.id)) {
          startNodeId = pUser.id;
        } else {
          const err = new Error(`Placement upline ${placementMobile} is not an active binary node.`);
          err.status = 400;
          throw err;
        }
      } else if (targetTree.sponsor_id) {
        startNodeId = targetTree.sponsor_id;
      }

      // Calculate binary placement and spillover
      const place = findPlacement(startNodeId, preferredPos, data);
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

      // Commissions
      paySponsorBinary(data, sponsorId);
      processPairing(data, place.parentId, place.position);

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

  // Trade-In active capital
  const total_tradein_deposit = packages
    .filter((p) => p.cycle_status === 'active')
    .reduce((sum, p) => sum + (Number(p.capital) || 0), 0);

  const total_balance = (Number(user.binary_ref_balance) || 0) + (Number(user.tradein_ref_balance) || 0) + (Number(user.tradein_cycle_balance) || 0);

  res.json({
    user,
    packages,
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
    metrics: {
      binary: Number(user.binary_ref_balance) || 0,
      ppt_pairs: user.pairs_today || 0,
      ppt_earnings: (user.pairs_today || 0) * PAIR_BONUS,
      in_ppt_count: indirects.length,
      in_ppt_earnings: indirects.length * INDIRECT_BONUS,
      total_balance,
      tradein_deposit: total_tradein_deposit,
      tradein_profit: Number(user.tradein_cycle_balance) || 0,
      tradein_ref: Number(user.tradein_ref_balance) || 0,
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
      binaryCap: BINARY_CAP,
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
  } else if (req.query.mobile) {
    const norm = normalizeMobile(req.query.mobile);
    const found = data.users.find((u) => u.mobile_number === norm);
    if (found) targetId = found.id;
    else return res.status(404).json({ error: 'Member mobile not found.' });
  }

  const targetUser = data.users.find((u) => u.id === targetId);
  if (!targetUser) return res.status(404).json({ error: 'Target member not found.' });

  const isAdmin = caller.role === 'admin';
  if (!isAdmin && !isDownline(caller.id, targetId, data)) {
    return res.status(403).json({ error: 'Access denied. You can only view genealogy trees in your own downline.' });
  }

  const rootId = isDownline(caller.id, targetId, data) ? caller.id : targetId;
  const breadcrumbs = getAncestorsPath(rootId, targetId, data);
  const tree = buildSubtree(targetId, data, 1, 3);
  const downlines = isAdmin
    ? data.users.filter((u) => u.role !== 'admin').map((u) => ({ id: u.id, mobile_number: u.mobile_number, mobile: u.mobile_number, status: u.status }))
    : getFlatDownlines(caller.id, data).map(d => ({ ...d, mobile_number: d.mobile }));

  res.json({
    user: { id: targetUser.id, mobile_number: targetUser.mobile_number },
    root_user_id: caller.id,
    viewed_user_id: targetId,
    breadcrumbs,
    ancestors: breadcrumbs,
    tree,
    downlines,
  });
});

app.post('/api/tradein/purchase', auth, async (req, res) => {
  const capital = money(req.body.capital);
  if (!Number.isFinite(capital) || capital < TRADEIN_MIN) {
    return res.status(400).json({ error: `Minimum trade-in capital is ₱${TRADEIN_MIN}.` });
  }

  const ref_number = String(req.body.ref_number || '').trim();
  const payment_method = String(req.body.payment_method || 'GCash').trim();
  const receipt_url = req.body.receipt_url || req.body.receipt_image || null;

  try {
    const pkg = await db.tx((data) => {
      const user = data.users.find((u) => u.id === req.user.id);
      if (!user || user.status !== 'active') {
        const err = new Error('Only active accounts can open a trade-in cycle.');
        err.status = 403;
        throw err;
      }
      const created = db.insert('tradein_packages', {
        user_id: req.user.id,
        capital,
        total_return: money(capital * TRADEIN_ROI),
        start_date: null,
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
    res.status(201).json({ package: pkg });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Trade-in purchase failed.' });
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

app.get('/api/admin/overview', auth, adminOnly, async (_req, res) => {
  await processTradeinYields().catch(() => { });
  const data = db.getStore();
  res.json({
    users: data.users.length,
    active: data.users.filter((u) => u.status === 'active').length,
    available_codes: data.code_vault.filter((c) => c.status === 'available').length,
    pending_withdrawals: data.withdrawals.filter((w) => w.status === 'pending').length,
    kpis: {
      tradein_deposit: money(data.tradein_packages.reduce((s, p) => s + Number(p.capital), 0)),
      tradein_ref: money(data.wallets.reduce((s, w) => s + Number(w.tradein_ref_balance), 0)),
      total_code: data.code_vault.length,
      total_code_buy: data.code_vault.filter((c) => c.status === 'used' || c.assigned_to).length,
      total_binary: money(data.users.reduce((s, u) => s + Number(u.total_binary_earnings || 0), 0)),
    },
    wallets: {
      binary_ref: data.wallets.reduce((s, w) => s + Number(w.binary_ref_balance), 0),
      tradein_ref: data.wallets.reduce((s, w) => s + Number(w.tradein_ref_balance), 0),
      tradein_cycle: data.wallets.reduce((s, w) => s + Number(w.tradein_cycle_balance), 0),
    },
    weekly_payout_enabled: Boolean(data.settings.weekly_payout_enabled),
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

app.get('/api/admin/tradein', auth, adminOnly, (_req, res) => {
  const data = db.getStore();
  const packages = data.tradein_packages
    .slice()
    .sort((a, b) => b.id - a.id)
    .slice(0, 200)
    .map((p) => ({ ...p, mobile_number: mobileOf(p.user_id, data) }));
  res.json({ packages });
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
      p.approved_at = nowIso();
      payTradeinReferrals(data, p.user_id, p.capital);
      return p;
    });
    res.json({ ok: true, package: pkg });
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
  const mobile = normalizeMobile(req.body.mobile_number || req.body.username);
  const qty = Math.min(50, Math.max(1, Number(req.body.qty) || 1));
  if (!mobile) return res.status(400).json({ error: 'Enter a valid member mobile number.' });
  try {
    const sent = await db.tx((data) => {
      const user = data.users.find((u) => u.mobile_number === mobile);
      if (!user) {
        const err = new Error('Member was not found.');
        err.status = 404;
        throw err;
      }
      const free = data.code_vault.filter((c) => c.status === 'available' && !c.assigned_to);
      if (free.length < qty) {
        const err = new Error(`Only ${free.length} unassigned code(s) available.`);
        err.status = 400;
        throw err;
      }
      const picked = free.slice(0, qty);
      picked.forEach((c) => {
        c.assigned_to = user.id;
        c.status = 'assigned';
      });
      return picked.map((c) => c.code);
    });
    res.json({ codes: sent, mobile });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Could not send codes.' });
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
