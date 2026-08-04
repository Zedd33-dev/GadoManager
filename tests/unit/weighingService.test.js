import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWeight,
  detectOutlier,
  validateWeighing,
  collectBatchRows,
} from '../../src/services/weighingService.js';
import { WEIGHT_LOSS_OUTLIER_FRACTION } from '../../src/domain/constants.js';

const animal = { birth_date: '2024-03-15', ear_tag: 'BV-0001' };

// ---------------------------------------------------------------------------
// parseWeight
// ---------------------------------------------------------------------------

test('parseWeight reads pt-BR decimal notation', () => {
  assert.equal(parseWeight('482,5'), 482.5);
  assert.equal(parseWeight('1.482,5'), 1482.5);
  assert.equal(parseWeight('480'), 480);
});

test('parseWeight accepts a plain decimal point too', () => {
  assert.equal(parseWeight('482.5'), 482.5);
});

test('parseWeight returns null for blank or unparsable input', () => {
  assert.equal(parseWeight(''), null);
  assert.equal(parseWeight('   '), null);
  assert.equal(parseWeight('abc'), null);
  assert.equal(parseWeight(null), null);
});

// ---------------------------------------------------------------------------
// detectOutlier
// ---------------------------------------------------------------------------

test('a first weighing has nothing to compare against', () => {
  const result = detectOutlier({ weightKg: 300, weighDate: '2026-08-01' }, null);

  assert.equal(result.isOutlier, false);
  assert.equal(result.gmd, null);
});

test('weight gain is never an outlier and yields the implied GMD', () => {
  // 400 -> 460 kg over 61 days = 60/61 kg/day.
  const result = detectOutlier(
    { weightKg: 460, weighDate: '2026-08-03' },
    { weightKg: 400, weighDate: '2026-06-03' },
  );

  assert.equal(result.isOutlier, false);
  assert.ok(Math.abs(result.gmd - 60 / 61) < 1e-9);
});

test('a small weight loss is recorded without a warning', () => {
  // 400 -> 390 kg is a 2.5% loss, under the 5% threshold. Real dry-season
  // losses of this size occur in the seeded herd.
  const result = detectOutlier(
    { weightKg: 390, weighDate: '2026-08-03' },
    { weightKg: 400, weighDate: '2026-07-03' },
  );

  assert.equal(result.isOutlier, false);
  assert.ok(result.lossFraction < WEIGHT_LOSS_OUTLIER_FRACTION);
  assert.ok(result.gmd < 0, 'negative GMD is still reported, not clamped');
});

test('a loss beyond the threshold is flagged with an explanatory reason', () => {
  // The classic typo: 382 entered as 38 (a 90% "loss").
  const result = detectOutlier(
    { weightKg: 38, weighDate: '2026-08-03' },
    { weightKg: 382, weighDate: '2026-06-03' },
  );

  assert.equal(result.isOutlier, true);
  assert.match(result.reason, /Perda de/);
  assert.match(result.reason, /Confirme/);
});

test('the threshold boundary is exclusive - exactly 5% does not flag', () => {
  // 400 -> 380 is exactly 5%.
  const atThreshold = detectOutlier(
    { weightKg: 380, weighDate: '2026-08-03' },
    { weightKg: 400, weighDate: '2026-07-03' },
  );
  assert.equal(atThreshold.isOutlier, false);

  const justBeyond = detectOutlier(
    { weightKg: 379, weighDate: '2026-08-03' },
    { weightKg: 400, weighDate: '2026-07-03' },
  );
  assert.equal(justBeyond.isOutlier, true);
});

test('the threshold is relative, so it scales with animal size', () => {
  // A 20 kg drop is unremarkable for a 500 kg steer (4%)...
  const steer = detectOutlier(
    { weightKg: 480, weighDate: '2026-08-03' },
    { weightKg: 500, weighDate: '2026-07-03' },
  );
  assert.equal(steer.isOutlier, false);

  // ...and alarming for a 120 kg calf (16.7%).
  const calf = detectOutlier(
    { weightKg: 100, weighDate: '2026-08-03' },
    { weightKg: 120, weighDate: '2026-07-03' },
  );
  assert.equal(calf.isOutlier, true);
});

// ---------------------------------------------------------------------------
// validateWeighing
// ---------------------------------------------------------------------------

test('a valid weighing passes and normalises its fields', () => {
  const result = validateWeighing(
    { weighDate: '2026-08-01', weightKg: '482,5', notes: '  ok  ' },
    { animal },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.weightKg, 482.5);
  assert.equal(result.data.notes, 'ok');
});

test('a weighing may not have a future date', () => {
  const result = validateWeighing({ weighDate: '2099-01-01', weightKg: '400' }, { animal });

  assert.equal(result.ok, false);
  assert.match(result.errors.weighDate, /futura/);
});

test('a weighing may not precede the animal\'s birth', () => {
  const result = validateWeighing({ weighDate: '2020-01-01', weightKg: '400' }, { animal });

  assert.equal(result.ok, false);
  assert.match(result.errors.weighDate, /nascimento/);
});

test('a duplicate date for the same animal is reported as a field error', () => {
  // The schema's UNIQUE(animal_id, weigh_date) would also catch this, but as
  // a raw constraint failure rather than something the form can display.
  const result = validateWeighing(
    { weighDate: '2026-08-01', weightKg: '400' },
    { animal, dateAlreadyUsed: true },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.weighDate, /Já existe/);
});

test('weight must be present and strictly positive', () => {
  assert.match(validateWeighing({ weighDate: '2026-08-01', weightKg: '' }, { animal }).errors.weightKg, /Informe/);
  assert.match(validateWeighing({ weighDate: '2026-08-01', weightKg: '0' }, { animal }).errors.weightKg, /maior que zero/);
  assert.match(validateWeighing({ weighDate: '2026-08-01', weightKg: '-5' }, { animal }).errors.weightKg, /maior que zero/);
});

test('an implausibly large weight is rejected as a typo', () => {
  const result = validateWeighing({ weighDate: '2026-08-01', weightKg: '4820' }, { animal });

  assert.equal(result.ok, false);
  assert.match(result.errors.weightKg, /plausível/);
});

// ---------------------------------------------------------------------------
// collectBatchRows
// ---------------------------------------------------------------------------

test('collectBatchRows pairs the parallel arrays a batch form posts', () => {
  const rows = collectBatchRows(['BV-0001', 'BV-0002'], ['480', '500']);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { index: 0, earTag: 'BV-0001', rawWeight: '480' });
});

test('collectBatchRows drops fully blank rows', () => {
  // The batch screen renders many empty rows so it works without JavaScript;
  // treating those as errors would make it unusable.
  const rows = collectBatchRows(['BV-0001', '', '  ', 'BV-0004'], ['480', '', '', '500']);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.earTag), ['BV-0001', 'BV-0004']);
});

test('collectBatchRows keeps a half-filled row so it can be reported as an error', () => {
  // A tag with no weight is a mistake the operator needs told about, not a
  // blank row to silently skip.
  const rows = collectBatchRows(['BV-0001', 'BV-0002'], ['480', '']);

  assert.equal(rows.length, 2);
  assert.equal(rows[1].rawWeight, '');
});

test('collectBatchRows preserves the original row index for error reporting', () => {
  const rows = collectBatchRows(['', '', 'BV-0003'], ['', '', '480']);

  assert.equal(rows[0].index, 2, 'the surviving row must remember it was the third');
});

test('collectBatchRows handles a single non-array submission', () => {
  // A form with one filled row posts a string, not an array.
  const rows = collectBatchRows('BV-0001', '480');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].earTag, 'BV-0001');
});
