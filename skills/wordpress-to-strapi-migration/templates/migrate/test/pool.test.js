import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPool } from '../lib/pool.js';

/**
 * Entries migrate one at a time, so a site's media uploads one file at a time:
 * 204 sequential round-trips on Neuros, and a site with thousands of images
 * would spend its afternoon waiting. A small pool fixes that, provided it keeps
 * the two promises the sequential loop made for free — results in the order they
 * went in, and a limit that is actually respected.
 */

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

test('returns results in the order the items came in', async () => {
  const items = [5, 1, 4, 2, 3];
  const out = await mapPool(items, 2, async (n) => {
    await tick(n);
    return n * 10;
  });
  assert.deepEqual(out, [50, 10, 40, 20, 30]);
});

test('never runs more than the limit at once', async () => {
  let running = 0;
  let peak = 0;
  await mapPool([...Array(12).keys()], 4, async () => {
    running++;
    peak = Math.max(peak, running);
    await tick(2);
    running--;
  });
  assert.equal(peak, 4);
});

test('a limit of one is the sequential loop it replaces', async () => {
  const order = [];
  await mapPool([1, 2, 3], 1, async (n) => {
    order.push(`start ${n}`);
    await tick(1);
    order.push(`end ${n}`);
  });
  assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
});

test('runs everything, however small the list', async () => {
  assert.deepEqual(await mapPool([], 4, async () => 1), []);
  assert.deepEqual(await mapPool([7], 4, async (n) => n), [7]);
});

/** A failing task must not leave the pool holding a slot forever. */
test('a failure surfaces without stalling the run', async () => {
  const done = [];
  await assert.rejects(
    () =>
      mapPool([1, 2, 3, 4], 2, async (n) => {
        if (n === 2) throw new Error('upload refused');
        await tick(1);
        done.push(n);
      }),
    /upload refused/
  );
  assert.ok(done.length > 0, 'the tasks that could finish did');
});

test('does not start new work after a failure', async () => {
  const started = [];
  await assert.rejects(
    () =>
      mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
        started.push(n);
        await tick(1);
        if (n === 1) throw new Error('nope');
      }),
    /nope/
  );
  assert.ok(started.length < 6, `stopped early, started ${started.length} of 6`);
});
