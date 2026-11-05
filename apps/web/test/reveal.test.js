import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWords, createReveal, createFadeTracker, REVEAL_MS } from '../ui/reveal.js';

// A fake clock: timers run only when the test moves time forward.
function fakeTimers() {
  let now = 0;
  let timers = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, at: now + ms }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        now = next.at;
        next.fn();
      }
      now = until;
    },
  };
}

function setup(options = {}) {
  const clock = fakeTimers();
  const out = [];
  const reveal = createReveal({ show: (t) => out.push(t), setTimer: clock.setTimer, clearTimer: clock.clearTimer, ...options });
  return { clock, out, reveal, text: () => out.join('') };
}

test('splitWords keeps every space and line break', () => {
  const text = '  Hello  world,\n\nnew paragraph ';
  assert.deepEqual(splitWords(text), ['  Hello  ', 'world,\n\n', 'new ', 'paragraph ']);
  assert.equal(splitWords(text).join(''), text);
  assert.deepEqual(splitWords('\n\n'), ['\n\n']);
  assert.deepEqual(splitWords(''), []);
});

test('one big piece appears one word per tick, at the same pace as small pieces', () => {
  const big = setup();
  big.reveal.push('one two three four five six');
  big.clock.advance(REVEAL_MS * 3);
  assert.equal(big.text(), 'one two three ');

  const small = setup();
  for (const w of ['one ', 'two ', 'three ', 'four ', 'five ', 'six']) small.reveal.push(w);
  small.clock.advance(REVEAL_MS * 3);
  assert.equal(small.text(), 'one two three ');

  big.clock.advance(REVEAL_MS * 3);
  assert.equal(big.text(), 'one two three four five six');
});

test('words keep their order across pieces that split a word', () => {
  const { clock, reveal, text } = setup();
  reveal.push('Hel');
  reveal.push('lo wor');
  reveal.push('ld');
  clock.advance(REVEAL_MS * 10);
  assert.equal(text(), 'Hello world');
});

test('flush shows everything waiting at once and stops the timer', () => {
  const { clock, reveal, text, out } = setup();
  reveal.push('a b c d');
  clock.advance(REVEAL_MS);
  reveal.flush();
  assert.equal(text(), 'a b c d');
  const count = out.length;
  clock.advance(REVEAL_MS * 5);
  assert.equal(out.length, count);
  assert.equal(reveal.pending, 0);
});

test('drop discards what is waiting', () => {
  const { clock, reveal, text } = setup();
  reveal.push('a b c');
  clock.advance(REVEAL_MS);
  reveal.drop();
  clock.advance(REVEAL_MS * 5);
  assert.equal(text(), 'a ');
});

test('idle resolves once the last word is shown, or at once when nothing waits', async () => {
  const { clock, reveal } = setup();
  await reveal.idle();
  reveal.push('a b');
  let done = false;
  reveal.idle().then(() => { done = true; });
  clock.advance(REVEAL_MS);
  await Promise.resolve();
  assert.equal(done, false);
  clock.advance(REVEAL_MS);
  await Promise.resolve();
  assert.equal(done, true);
});

test('with reduce motion, text shows as it arrives', () => {
  const { reveal, text } = setup({ instant: true });
  reveal.push('all of this at once');
  assert.equal(text(), 'all of this at once');
});

test('the fade tracker remembers when each stretch appeared and forgets it after the fade', () => {
  let now = 0;
  const fades = createFadeTracker({ duration: 150, now: () => now });
  assert.deepEqual(fades.update(5), [{ start: 0, end: 5, elapsed: 0 }]);
  now = 100;
  assert.deepEqual(fades.update(9), [{ start: 0, end: 5, elapsed: 100 }, { start: 5, end: 9, elapsed: 0 }]);
  now = 200;
  assert.deepEqual(fades.update(9), [{ start: 5, end: 9, elapsed: 100 }]);
  // Text that renders shorter (a list or bold closing) trims what's fading.
  assert.deepEqual(fades.update(7), [{ start: 5, end: 7, elapsed: 100 }]);
  now = 400;
  assert.deepEqual(fades.update(7), []);
});
