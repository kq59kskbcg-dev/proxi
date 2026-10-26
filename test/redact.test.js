import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../lib/redact.js';

test('masks valid card numbers in common formats', () => {
  for (const card of ['4111111111111111', '4111 1111 1111 1111', '5500-0000-0000-0004', '378282246310005']) {
    const { text, counts } = redact(`my card is ${card} thanks`);
    assert.equal(text, 'my card is [CARD] thanks');
    assert.equal(counts.CARD, 1);
  }
});

test('leaves numbers that fail the Luhn check alone', () => {
  const { counts } = redact('order 4111111111111112 shipped');
  assert.equal(counts.CARD, undefined);
});

test('masks valid IBANs, with or without spaces', () => {
  for (const iban of ['NL91ABNA0417164300', 'DE89 3704 0044 0532 0130 00', 'GB82WEST12345698765432']) {
    const { text, counts } = redact(`pay to ${iban} today`);
    assert.equal(text, 'pay to [IBAN] today');
    assert.equal(counts.IBAN, 1);
  }
});

test('leaves IBAN-shaped strings with a bad checksum alone', () => {
  const { counts } = redact('ref NL91ABNA0417164301');
  assert.equal(counts.IBAN, undefined);
});

test('masks emails and phone numbers', () => {
  const { text, counts } = redact('Mail jane.doe@example.com or call +31 20 123 4567');
  assert.equal(text, 'Mail [EMAIL] or call [PHONE]');
  assert.deepEqual(counts, { EMAIL: 1, PHONE: 1 });
});

test('keeps ordinary text, years and short numbers intact', () => {
  const input = 'In 2024 we shipped 3 releases and 120 fixes.';
  const { text, counts } = redact(input);
  assert.equal(text, input);
  assert.deepEqual(counts, {});
});
