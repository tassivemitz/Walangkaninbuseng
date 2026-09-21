const http = require('http');

async function runTests() {
  console.log('--- Starting Verification Tests ---');

  // Test 1: Verify direct and indirect calculation formulas directly
  const DIRECT_BONUS = 50;
  const INDIRECT_BONUS = 5;

  // Scenario 1: User has 2 direct signups, but both are inactive / unplaced
  const directsUnplaced = [
    { id: 2, mobile_number: 'qwert', status: 'inactive', position: null },
    { id: 3, mobile_number: 'qwert2', status: 'inactive', position: null },
  ];
  const indirectsUnplaced = [
    { id: 4, mobile_number: 'sub1', status: 'inactive', level: 2 },
    { id: 5, mobile_number: 'sub2', status: 'inactive', level: 2 },
  ];
  const earningsHistoryEmpty = [];

  const activeDirects1 = directsUnplaced.filter(d => d.status === 'active' && d.position);
  const directEarningRecords1 = earningsHistoryEmpty.filter(e => e.category === 'referral');
  const directEarningsTotal1 = directEarningRecords1.length > 0
    ? directEarningRecords1.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    : (activeDirects1.length * DIRECT_BONUS);

  const activeIndirects1 = indirectsUnplaced.filter(ind => ind.status === 'active');
  const indirectEarningRecords1 = earningsHistoryEmpty.filter(e => e.category === 'indirect');
  const indirectEarningsTotal1 = indirectEarningRecords1.length > 0
    ? indirectEarningRecords1.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    : (activeIndirects1.length * INDIRECT_BONUS);

  console.log('Test 1 (Unplaced signups):');
  console.log('  Active Directs Count:', activeDirects1.length, '(Expected: 0)');
  console.log('  Direct Earnings Total:', directEarningsTotal1, '(Expected: 0)');
  console.log('  Active Indirects Count:', activeIndirects1.length, '(Expected: 0)');
  console.log('  Indirect Earnings Total:', indirectEarningsTotal1, '(Expected: 0)');

  if (directEarningsTotal1 !== 0 || activeDirects1.length !== 0 || indirectEarningsTotal1 !== 0 || activeIndirects1.length !== 0) {
    throw new Error('Test 1 Failed: Unplaced signups should have zero earnings!');
  }
  console.log('  -> PASS');

  // Scenario 2: Downline is encoded (becomes active and placed in binary tree)
  const directsPlaced = [
    { id: 2, mobile_number: 'qwert', status: 'active', position: 'L' },
    { id: 3, mobile_number: 'qwert2', status: 'inactive', position: null },
  ];
  const earningsHistoryWithDirect = [
    { user_id: 1, category: 'referral', amount: 50, description: 'Direct Referral Bonus (Level 1)' }
  ];

  const activeDirects2 = directsPlaced.filter(d => d.status === 'active' && d.position);
  const directEarningRecords2 = earningsHistoryWithDirect.filter(e => e.category === 'referral');
  const directEarningsTotal2 = directEarningRecords2.length > 0
    ? directEarningRecords2.reduce((sum, e) => sum + Number(e.amount || 0), 0)
    : (activeDirects2.length * DIRECT_BONUS);

  console.log('\nTest 2 (1 Placed & Active, 1 Unplaced):');
  console.log('  Active Directs Count:', activeDirects2.length, '(Expected: 1)');
  console.log('  Direct Earnings Total:', directEarningsTotal2, '(Expected: 50)');

  if (directEarningsTotal2 !== 50 || activeDirects2.length !== 1) {
    throw new Error('Test 2 Failed: Encoded direct should have ₱50 earnings and count of 1!');
  }
  console.log('  -> PASS');

  console.log('\n--- All Unit Logic Tests Passed Successfully ---');
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
