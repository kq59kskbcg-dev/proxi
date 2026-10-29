import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/redact.js';

test('masks valid card numbers in common formats', () => {
  for (const card of ['4111111111111111', '4111 1111 1111 1111', '5500-0000-0000-0004', '378282246310005']) {
    const { text, counts } = redact(`my card is ${card} thanks`);
    assert.equal(text, `my card is •••• •••• •••• ${card.replace(/\D/g, '').slice(-4)} thanks`);
    assert.ok(!text.includes(card.replace(/\D/g, '').slice(0, 6)), 'the leading digits are gone');
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

test('dates are not mistaken for phone numbers, real numbers still are', () => {
  for (const date of ['Released 2026-10-27 at 19:38', 'Met on 27-10-2026', 'Due 2026/01/05']) {
    assert.deepEqual(redact(date).counts, {}, date);
  }
  for (const phone of ['06 12345678', '+31 6 1234 5678', '020-1234567', '+44 20 7946 0958']) {
    assert.equal(redact(phone).counts.PHONE, 1, phone);
  }
});

test('tool inputs are redacted before they leave Proxi', async () => {
  const { redactArgs } = await import('../src/mcp.js');
  assert.deepEqual(redactArgs({ query: 'invoice for jane@example.com', limit: 5, tags: ['call 06 12345678'] }),
    { query: 'invoice for [EMAIL]', limit: 5, tags: ['call [PHONE]'] });
});
