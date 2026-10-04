import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseActivation } from '../../electron/features/app-help/activation';

const id = randomUUID();
const timestamp = Date.now();
const argv = (bundle = 'com.apple.FaceTime') => ['HelpOS', '--background', '--app-help', bundle, '--activation-id', id, '--activation-at', String(timestamp)];

test('activation parser accepts exactly the three supported bundle IDs and preserves event identity', () => {
  for (const bundleId of ['com.apple.FaceTime', 'com.apple.Safari', 'com.apple.finder']) {
    assert.deepEqual(parseActivation(argv(bundleId)), { bundleId, activationId: id, timestamp });
  }
});

test('background alone, missing flags and missing values do not request an offer', () => {
  assert.equal(parseActivation(['HelpOS', '--background']), null);
  assert.equal(parseActivation([]), null);
  for (const key of ['--app-help', '--activation-id', '--activation-at']) {
    const absent = argv(); const index = absent.indexOf(key); absent.splice(index, 2);
    assert.equal(parseActivation(absent), null);
    const missingValue = argv(); missingValue.splice(missingValue.indexOf(key) + 1, 1);
    assert.equal(parseActivation(missingValue), null);
  }
});

test('each request flag must appear exactly once even with identical duplicate values', () => {
  for (const key of ['--app-help', '--activation-id', '--activation-at']) {
    const args = argv();
    assert.equal(parseActivation([...args, key, args[args.indexOf(key) + 1]]), null);
    assert.equal(parseActivation([...args, key]), null);
  }
});

test('bundle matching is exact and cannot be selected by unsupported or prefix values', () => {
  for (const bundle of ['', 'com.apple.Finder', 'com.apple.Safari.extra', 'com.apple.TextEdit', 'app.helpos.desktop', '__proto__']) {
    assert.equal(parseActivation(argv(bundle)), null);
  }
});

test('malformed or missing episode UUIDs are rejected', () => {
  for (const invalid of ['', '123', 'not-a-uuid', id.slice(1), `${id}suffix`, '--background']) {
    const args = argv(); args[args.indexOf('--activation-id') + 1] = invalid;
    assert.equal(parseActivation(args), null);
  }
  const upper = argv(); upper[upper.indexOf('--activation-id') + 1] = id.toUpperCase();
  assert.equal(parseActivation(upper)?.activationId, id.toUpperCase());
});

test('non-finite, non-positive and nonnumeric activation times are rejected', () => {
  for (const invalid of ['', 'NaN', 'Infinity', '-Infinity', '0', '-1', 'not-a-time', '--background']) {
    const args = argv(); args[args.indexOf('--activation-at') + 1] = invalid;
    assert.equal(parseActivation(args), null);
  }
});

test('flag order is independent and split or equals values may be used once per key', () => {
  assert.deepEqual(parseActivation(['--activation-at', String(timestamp), '--app-help', 'com.apple.Safari', '--activation-id', id]), { bundleId: 'com.apple.Safari', activationId: id, timestamp });
  for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const entries = [['--app-help', 'com.apple.FaceTime'], ['--activation-id', id], ['--activation-at', String(timestamp)]];
    const args = entries.flatMap(([key, value], index) => mask & (1 << index) ? [`${key}=${value}`] : [key, value]);
    assert.deepEqual(parseActivation(args), { bundleId: 'com.apple.FaceTime', activationId: id, timestamp });
  }
});

test('Chromium second-instance switches retain their associated equals values among unrelated flags', () => {
  const args = ['/Applications/HelpOS.app/Contents/MacOS/HelpOS', '--background',
    '--app-help=com.apple.Safari', `--activation-id=${id}`, `--activation-at=${timestamp}`,
    '--allow-file-access-from-files', '--enable-avfoundation'];
  assert.deepEqual(parseActivation(args), { bundleId: 'com.apple.Safari', activationId: id, timestamp });
  assert.deepEqual(parseActivation([args[0], args[6], args[4], args[5], args[2], args[1], args[3]]), { bundleId: 'com.apple.Safari', activationId: id, timestamp });
});

test('mixed split and equals duplicates are rejected in either order even if values match', () => {
  for (const [key, value] of [['--app-help', 'com.apple.FaceTime'], ['--activation-id', id], ['--activation-at', String(timestamp)]]) {
    const split = argv();
    assert.equal(parseActivation([...split, `${key}=${value}`]), null);
    assert.equal(parseActivation([`${key}=${value}`, ...split]), null);
    const index = split.indexOf(key); split.splice(index, 2, `${key}=${value}`);
    assert.equal(parseActivation([...split, `${key}=${value}`]), null);
    assert.equal(parseActivation([...split, key, value]), null);
  }
});

test('empty equals values are rejected instead of borrowing trailing positional values', () => {
  for (const key of ['--app-help', '--activation-id', '--activation-at']) {
    const args = argv(); const index = args.indexOf(key); const value = args[index + 1];
    args.splice(index, 2, `${key}=`);
    assert.equal(parseActivation(args), null);
    assert.equal(parseActivation([...args, value]), null);
  }
});

test('unassociated reordered positional values cannot be guessed into an activation', () => {
  const args = ['/Applications/HelpOS.app/Contents/MacOS/HelpOS', '--background', '--app-help',
    '--activation-id', '--activation-at', '--allow-file-access-from-files', '--enable-avfoundation',
    'com.apple.Safari', id, String(timestamp)];
  assert.equal(parseActivation(args), null);
});

test('equals syntax keeps the same strict bundle, UUID and numeric validation', () => {
  for (const [bundle, episode, at] of [
    ['com.apple.Safari.extra', id, String(timestamp)], ['com.apple.Finder', id, String(timestamp)],
    ['com.apple.Safari', 'bad-uuid', String(timestamp)], ['com.apple.Safari', id, 'NaN'],
    ['com.apple.Safari', id, 'Infinity'], ['com.apple.Safari', id, '0'],
  ]) assert.equal(parseActivation([`--app-help=${bundle}`, `--activation-id=${episode}`, `--activation-at=${at}`]), null);
});
