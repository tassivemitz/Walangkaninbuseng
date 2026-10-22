/**
 * Mature the current Trade-In cycle (make it claimable) for a user.
 *
 * On a live PM2 server, stop the app first so in-memory store does not overwrite this:
 *   pm2 stop infinite-trading
 *   node scripts/mature-tradein-cycle.js --user Asd53 --ref 25AeH57
 *   node scripts/mature-tradein-cycle.js --user Asd53 --ref 25AeH57 --apply
 *   pm2 start infinite-trading
 *
 * Defaults to dry-run. Pass --apply to write store.json.
 */
const path = require('path');

process.chdir(path.join(__dirname, '..'));

const db = require('../db');

const CYCLE_MS = 3 * 24 * 60 * 60 * 1000;
const PAD_MS = 5000;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

function peso(n) {
  return `₱${Number(n || 0).toLocaleString('en-PH')}`;
}

function cycleLabel(pkg) {
  const done = Number(pkg.payouts_completed || 0);
  return `Cycle ${Math.min(done + 1, 4)}/4 (${done}/4 claimed)`;
}

async function main() {
  const username = String(arg('--user', 'Asd53'));
  const ref = arg('--ref') === true ? null : arg('--ref', null);
  const packageId = arg('--id') === true ? null : arg('--id');
  const apply = process.argv.includes('--apply');

  const result = await db.tx((data) => {
    const user = db.findUserByExactUsername(data, username);
    if (!user) {
      throw new Error(`User not found: ${username}`);
    }

    const pkgs = (data.tradein_packages || []).filter((p) => Number(p.user_id) === Number(user.id));
    if (!pkgs.length) {
      throw new Error(`No trade-in packages for ${user.username || username}`);
    }

    const cycle4 = pkgs.filter(
      (p) => p.cycle_status === 'active' && Number(p.payouts_completed || 0) === 3
    );

    let target = null;
    if (packageId) {
      target = pkgs.find((p) => String(p.id) === String(packageId));
    } else if (ref) {
      const needle = String(ref).toLowerCase();
      target = cycle4.find((p) => String(p.ref_number || '').toLowerCase() === needle)
        || pkgs.find((p) => String(p.ref_number || '').toLowerCase() === needle);
    }
    if (!target && cycle4.length === 1) {
      target = cycle4[0];
    } else if (!target && cycle4.length > 1) {
      target = cycle4.find((p) => Number(p.capital) === 10000) || cycle4[0];
    }

    if (!target) {
      const summary = pkgs
        .map((p) => `#${p.id} ${peso(p.capital)} ${p.cycle_status} ${cycleLabel(p)} ref=${p.ref_number || '-'}`)
        .join('\n  ');
      throw new Error(`No matching Cycle 4 package. Packages:\n  ${summary}`);
    }

    const prevStart = target.cycle_start_date || target.start_date || target.created_at;
    const maturedStart = new Date(Date.now() - CYCLE_MS - PAD_MS).toISOString();
    const snapshot = {
      user: user.username || user.mobile_number,
      user_id: user.id,
      package_id: target.id,
      capital: target.capital,
      ref_number: target.ref_number || null,
      status: target.cycle_status,
      payouts_completed: Number(target.payouts_completed || 0),
      capital_rolled_over: Boolean(target.capital_rolled_over),
      rolled_over_package_id: target.rolled_over_package_id || null,
      previous_cycle_start_date: prevStart,
      new_cycle_start_date: maturedStart,
    };

    if (apply) {
      target.cycle_start_date = maturedStart;
    }

    return { apply, snapshot, packages: pkgs };
  });

  const s = result.snapshot;
  console.log(result.apply ? 'APPLIED' : 'DRY RUN (pass --apply to write)');
  console.log(`User: ${s.user} (#${s.user_id})`);
  console.log(`Package #${s.package_id} ${peso(s.capital)}  ref=${s.ref_number}  status=${s.status}`);
  console.log(`Payouts claimed: ${s.payouts_completed}/4`);
  console.log(`cycle_start_date: ${s.previous_cycle_start_date}`);
  console.log(`            -> ${s.new_cycle_start_date}`);
  if (s.payouts_completed === 3 && !s.capital_rolled_over) {
    console.log('Note: Cycle 4 still requires a paid rollover + admin approval before claim.');
  }
  if (!result.apply) {
    console.log('\nRe-run with --apply after: pm2 stop infinite-trading');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
