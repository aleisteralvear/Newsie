import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRunScheduledSync } from './refreshScheduler';

test('shouldRunScheduledSync enforces manual mode, offline state, overlap lock, and wifi-only setting', () => {
  assert.equal(
    shouldRunScheduledSync(0, true, { online: true, isMeteredOrCellular: false }, false).allowed,
    false,
  );
  assert.equal(
    shouldRunScheduledSync(30, true, { online: true, isMeteredOrCellular: false }, true).allowed,
    false,
  );
  assert.equal(
    shouldRunScheduledSync(30, true, { online: false, isMeteredOrCellular: false }, false).allowed,
    false,
  );
  assert.equal(
    shouldRunScheduledSync(30, true, { online: true, isMeteredOrCellular: true }, false).allowed,
    false,
  );
  assert.equal(
    shouldRunScheduledSync(30, false, { online: true, isMeteredOrCellular: true }, false).allowed,
    true,
  );
  assert.equal(
    shouldRunScheduledSync(60, true, { online: true, isMeteredOrCellular: false }, false).allowed,
    true,
  );
});
