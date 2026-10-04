// Generates a synthetic plan sheet with KNOWN values, used as the estimator's
// regression fixture. Synthetic on purpose: no customer drawing is involved, and
// because we wrote the numbers we can check an extraction exactly rather than
// squinting at it.
//
// The area figures are deliberately comma-formatted four-digit numbers ("1,312"),
// because the failure mode this product fears most is a dropped leading digit
// turning 1,312 into 312.
//
//   node scripts/make-test-plan.js  ->  media/test-plan.png
//
// Truth is declared in scripts/test-plan-truth.json next to it, so the probe and
// any future harness check against one source rather than a copy.

const fs = require('fs');
const path = require('path');
const { createCanvas } = (() => {
  try { return require('canvas'); } catch (e) { return {}; }
})();

const TRUTH = {
  totalPrintedSqft: 2486,
  stories: 2,
  overallWidthFt: 42,
  overallDepthFt: 34,
  areaSchedule: [
    { label: 'MAIN FLOOR', sqft: 1312, conditioned: true },
    { label: 'UPPER FLOOR', sqft: 1174, conditioned: true },
    { label: 'GARAGE', sqft: 484, conditioned: false },
    { label: 'COVERED PORCH', sqft: 168, conditioned: false }
  ],
  windows: { front: 7, rear: 6, left: 3, right: 4, total: 20 },
  roof: 'gable',
  rooms: ['LIVING', 'KITCHEN', 'DINING', 'GARAGE', 'BEDROOM 1', 'BEDROOM 2', 'BEDROOM 3', 'BATH']
};

const OUT_TRUTH = path.join(__dirname, 'test-plan-truth.json');
fs.writeFileSync(OUT_TRUTH, JSON.stringify(TRUTH, null, 2) + '\n');
console.log('wrote', path.relative(process.cwd(), OUT_TRUTH));

if (!createCanvas) {
  console.log('\nnode-canvas is not installed, so the PNG was not drawn here.');
  console.log('The Python generator (scripts/make_test_plan.py) produces the same sheet.');
  process.exit(0);
}
console.log('node-canvas present but the Python generator is the canonical one.');
