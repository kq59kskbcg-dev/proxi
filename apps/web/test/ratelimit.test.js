import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit, resetRateLimits, trackedKeys, WINDOW_MS, MAX_REQUESTS, MAX_KEYS } from '../lib/ratelimit.js';

beforeEach(() => resetRateLimits());

const T0 = 1_700_000_000_000;

test('allows MAX_REQUESTS in a window, then refuses with a retryAfter', () => {
  for (let i = 0; i < MAX_REQUESTS; i++) assert.equal(rateLimit('u1', T0 + i * 1000).ok, true);
  const refused = rateLimit('u1', T0 + 30_000);
  assert.equal(refused.ok, false);
  // The oldest request in the window leaves it at T0 + WINDOW_MS.
  assert.equal(refused.retryAfter, Math.ceil((WINDOW_MS - 30_000) / 1000));
  // Other keys are unaffected.
  assert.equal(rateLimit('u2', T0 + 30_000).ok, true);
});

test('requests leave the window as it slides', () => {
  for (let i = 0; i < MAX_REQUESTS; i++) rateLimit('u1', T0);
  assert.equal(rateLimit('u1', T0 + WINDOW_MS - 1).ok, false);
  assert.equal(rateLimit('u1', T0 + WINDOW_MS).ok, true);
});

test('a refused request does not extend the wait', () => {
  for (let i = 0; i < MAX_REQUESTS; i++) rateLimit('u1', T0);
  for (let i = 1; i <= 5; i++) assert.equal(rateLimit('u1', T0 + i * 60_000).ok, false);
  assert.equal(rateLimit('u1', T0 + WINDOW_MS).ok, true);
});

test('a flood of new keys evicts the least recently active, not everyone', () => {
  // A limited user, active recently.
  for (let i = 0; i < MAX_REQUESTS; i++) rateLimit('victim', T0);
  // Rotating keys, many more than are kept.
  for (let i = 0; i < MAX_KEYS * 2; i++) {
    rateLimit(`ip:${i}`, T0 + 1000);
    // The limited user keeps trying, which keeps their key recent.
    if (i % 1000 === 0) assert.equal(rateLimit('victim', T0 + 1000).ok, false);
  }
  assert.ok(trackedKeys() <= MAX_KEYS);
  assert.equal(rateLimit('victim', T0 + 2000).ok, false);
});

test('expired keys are dropped as new requests come in', () => {
  for (let i = 0; i < 100; i++) rateLimit(`old:${i}`, T0);
  assert.equal(trackedKeys(), 100);
  rateLimit('new', T0 + WINDOW_MS);
  assert.equal(trackedKeys(), 1);
});
