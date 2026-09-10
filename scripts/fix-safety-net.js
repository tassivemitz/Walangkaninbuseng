#!/usr/bin/env node
/**
 * Infinite Trading - Safety Net & Account Correction Script
 * 
 * Corrects accounts that received accidental pairing bonus from unflushed pairs
 * (such as Asd1 who had 5 pairs trigger mistakenly after exceeding yesterday's cap).
 * 
 * Usage:
 *   node scripts/fix-safety-net.js [username]
 *   node scripts/fix-safety-net.js Asd1
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function money(n) {
  return Math.round(Number(n) * 100) / 100;
}

function runFix() {
  const targetUsername = process.argv[2] || 'Asd1';

  console.log('====================================================');
  console.log(`  Infinite Trading - Safety Net Account Repair Tool`);
  console.log(`  Target User: ${targetUsername}`);
  console.log('====================================================');

  if (!fs.existsSync(STORE_FILE)) {
    console.error(`Error: store.json not found at ${STORE_FILE}`);
    process.exit(1);
  }

  // 1. Create timestamped backup
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(DATA_DIR, `store.backup.before-safetynet-fix.${timestamp}.json`);
  fs.copyFileSync(STORE_FILE, backupFile);
  console.log(`✓ Backup saved: ${path.basename(backupFile)}`);

  const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));

  // 2. Locate target user
  const user = (data.users || []).find(
    (u) =>
      (u.username && u.username.toLowerCase() === targetUsername.toLowerCase()) ||
      (u.mobile_number && u.mobile_number.toLowerCase() === targetUsername.toLowerCase())
  );

  if (!user) {
    console.error(`User "${targetUsername}" not found in store.json.`);
    console.log('Available users:', (data.users || []).map((u) => u.username || u.mobile_number).join(', '));
    process.exit(1);
  }

  const userId = user.id;
  const wallet = (data.wallets || []).find((w) => w.user_id === userId);
  const tree = (data.binary_tree || []).find((t) => t.user_id === userId);

  console.log(`\nCurrent State for User #${userId} (${user.username || user.mobile_number}):`);
  console.log(`- Total Binary Earnings: ₱${user.total_binary_earnings || 0}`);
  if (wallet) console.log(`- Binary Ref Balance: ₱${wallet.binary_ref_balance || 0}`);
  if (tree) {
    console.log(`- Pairs Today: ${tree.pairs_today || 0}`);
    console.log(`- Leftover Left: ${tree.leftover_left || 0}`);
    console.log(`- Leftover Right: ${tree.leftover_right || 0}`);
    console.log(`- Last Pair Date: ${tree.last_pair_date}`);
  }

  // Calculate corrections
  // If user has pairs today (e.g., 5 pairs = ₱250) that should have been safety net:
  const excessPairs = tree ? (tree.pairs_today || 0) : 0;
  const amountToRevert = money(excessPairs * 50);

  if (amountToRevert > 0) {
    console.log(`\nReverting ${excessPairs} accidental pairs (₱${amountToRevert}):`);

    // Deduct from wallet
    if (wallet) {
      const prevBal = wallet.binary_ref_balance;
      wallet.binary_ref_balance = money(Math.max(0, wallet.binary_ref_balance - amountToRevert));
      console.log(`✓ Wallet binary_ref_balance: ₱${prevBal} -> ₱${wallet.binary_ref_balance}`);
    }

    // Deduct from total binary earnings cap
    const prevCapEarnings = user.total_binary_earnings || 0;
    user.total_binary_earnings = money(Math.max(0, (user.total_binary_earnings || 0) - amountToRevert));
    console.log(`✓ User total_binary_earnings: ₱${prevCapEarnings} -> ₱${user.total_binary_earnings}`);

    // Reset tree counters
    if (tree) {
      tree.pairs_today = 0;
      // If user had 16 Left vs 15 Right, the true waiting count is Left: 1, Right: 0
      tree.leftover_left = 1;
      tree.leftover_right = 0;
      console.log(`✓ Binary tree pairs_today reset to 0`);
      console.log(`✓ Binary tree leftovers adjusted to Left: 1, Right: 0`);
    }

    // Update today's matching earnings in earnings_history to safety_net (₱0)
    const todayStr = new Date().toISOString().slice(0, 10);
    let convertedLogs = 0;
    if (Array.isArray(data.earnings_history)) {
      for (const log of data.earnings_history) {
        if (
          log.user_id === userId &&
          log.category === 'matching' &&
          String(log.created_at || '').startsWith(todayStr)
        ) {
          log.category = 'safety_net';
          log.amount = 0;
          log.description = 'Pairing Safety Net / Flush Out (Reversed Accidental Payout)';
          convertedLogs++;
        }
      }
    }
    console.log(`✓ Converted ${convertedLogs} matching earning logs to safety_net (₱0)`);
  } else {
    // If pairs_today was already 0 or different, still ensure no overlapping points remain
    if (tree && tree.leftover_left > 0 && tree.leftover_right > 0) {
      const flush = Math.min(tree.leftover_left, tree.leftover_right);
      tree.leftover_left -= flush;
      tree.leftover_right -= flush;
      console.log(`✓ Flushed ${flush} overlapping leftover points from binary tree.`);
    } else {
      console.log('\nNo accidental pairing earnings today detected for this account.');
    }
  }

  // 3. Persist updated store
  const tmpFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpFile, STORE_FILE);

  console.log('\n====================================================');
  console.log('✓ Account correction completed successfully.');
  console.log('====================================================\n');
}

runFix();
