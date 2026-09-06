#!/usr/bin/env node
/**
 * Infinite Trading - Database Reset Script
 * 
 * Safely resets data/store.json to a clean, pristine state:
 * - Automatically creates a timestamped backup in data/
 * - Clears all test trade deposits, cycle payouts, withdrawals, downlines, and earnings history
 * - Re-creates root Admin account (credentials from .env or defaults)
 * - Mints 5 fresh 8-character activation codes
 * - Zero changes to any business logic, calculations, or server processes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function generateRandomCode(length = 8) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

async function runReset() {
  console.log('====================================================');
  console.log('  Infinite Trading - System Data Reset Tool');
  console.log('====================================================');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // 1. Create backup if store.json exists
  if (fs.existsSync(STORE_FILE)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(DATA_DIR, `store.backup.${timestamp}.json`);
    fs.copyFileSync(STORE_FILE, backupFile);
    console.log(`✓ Backup created successfully: ${path.basename(backupFile)}`);
  }

  // 2. Prepare Admin Credentials
  const adminMobile = process.env.ADMIN_MOBILE || 'Toshi';
  const adminPassword = process.env.ADMIN_PASSWORD || 'SuperAcenigga24';
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);

  // 3. Generate 5 Starter Codes
  const starterCodes = [];
  const codeVault = [];
  for (let i = 1; i <= 5; i++) {
    const code = generateRandomCode(8);
    starterCodes.push(code);
    codeVault.push({
      id: i,
      code,
      status: 'available',
      assigned_to: null,
      used_by: null,
      created_at: nowIso(),
      used_at: null,
    });
  }

  // 4. Construct Fresh Clean Store
  const cleanStore = {
    nextId: {
      users: 2,
      tradein_packages: 1,
      withdrawals: 1,
      code_vault: 6,
      earnings_history: 1,
    },
    users: [
      {
        id: 1,
        username: adminMobile,
        mobile_number: adminMobile,
        password: adminPasswordHash,
        role: 'admin',
        status: 'active',
        total_binary_earnings: 0,
        created_at: nowIso(),
      },
    ],
    wallets: [
      {
        user_id: 1,
        binary_ref_balance: 0,
        tradein_ref_balance: 0,
        tradein_cycle_balance: 0,
      },
    ],
    binary_tree: [
      {
        user_id: 1,
        parent_id: null,
        sponsor_id: null,
        position: null,
        leftover_left: 0,
        leftover_right: 0,
        pairs_today: 0,
        last_pair_date: null,
      },
    ],
    tradein_packages: [],
    withdrawals: [],
    code_vault: codeVault,
    earnings_history: [],
    settings: {
      weekly_payout_enabled: 0,
      binary_cap: 6000,
      max_tradein_slots: 5,
    },
  };

  // 5. Write atomically
  const tmpFile = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(cleanStore, null, 2), 'utf8');
  fs.renameSync(tmpFile, STORE_FILE);

  console.log('✓ Clean data/store.json successfully generated!');
  console.log('----------------------------------------------------');
  console.log('Summary of Reset:');
  console.log('  • Total Trade Deposits: ₱0 (0 packages)');
  console.log('  • All Member Wallets: ₱0 (Reset)');
  console.log('  • Withdrawals: 0 (Cleared)');
  console.log('  • Downline Tree: Clean Root Node only');
  console.log('  • Earnings History: 0 records');
  console.log('  • Starter Codes Generated (5):', starterCodes.join(', '));
  console.log('----------------------------------------------------');
  console.log(`Admin Login:`);
  console.log(`  Username / Mobile: ${adminMobile}`);
  console.log(`  Password:          ${adminPassword}`);
  console.log('====================================================');
  console.log('NOTE: Please restart your server or PM2 to load the new store:');
  console.log('  - Locally: restart your "npm run dev" terminal');
  console.log('  - On VPS:  pm2 restart infinitetrading');
  console.log('====================================================');
}

runReset().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
