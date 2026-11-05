import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWords, likePatterns, rankChats, chatSearchResult, chatSourceUrl, CHAT_SEARCH_TOOL_DEFINITION, CHAT_SEARCH_MAX_CHATS } from '../src/chat-search.js';

test('a query becomes its distinct words, lowercased, without one-letter words', () => {
  assert.deepEqual(searchWords('Lisbon HOTEL, a lisbon trip!'), ['lisbon', 'hotel', 'trip']);
  assert.deepEqual(searchWords('Café São Paulo'), ['café', 'são', 'paulo']);
  assert.deepEqual(searchWords(''), []);
  assert.deepEqual(searchWords(undefined), []);
  assert.equal(searchWords('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10').length, 8);
});

test('search patterns take % and _ literally', () => {
  assert.deepEqual(likePatterns(['10%', 'a_b', 'x\\y']), ['%10\\%%', '%a\\_b%', '%x\\\\y%']);
});

const row = (id, position, role, content, extra = {}) => ({ id, title: 'Chat ' + id, updatedAt: '2026-10-14T09:00:00.000Z', position, role, content, ...extra });

test('chats matching more words come first, then the most recent', () => {
  const rows = [
    row('recent', 0, 'user', 'Lisbon flights'),
    row('older', 0, 'user', 'Which Lisbon hotel?'),
    row('oldest', 0, 'user', 'Lisbon'),
  ];
  assert.deepEqual(rankChats(rows, ['lisbon', 'hotel']).map((c) => c.id), ['older', 'recent', 'oldest']);
});

test('at most five chats and three passages each, in chat order, without citation markup', () => {
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(row('c' + i, 0, 'user', 'lisbon'));
  assert.equal(rankChats(rows, ['lisbon']).length, CHAT_SEARCH_MAX_CHATS);

  const one = rankChats([
    row('a', 0, 'user', 'lisbon one'),
    row('a', 1, 'assistant', 'lisbon hotel two [[1]](https://x.example/a)\n\n**Sources**\n1. [A](https://x.example/a)'),
    row('a', 2, 'user', 'lisbon three'),
    row('a', 3, 'assistant', 'lisbon hotel four'),
    row('a', 4, 'user', 'nothing here'),
  ], ['lisbon', 'hotel'])[0];
  assert.deepEqual(one.snippets, ['User: lisbon one', 'Proxi: lisbon hotel two', 'Proxi: lisbon hotel four']);
});

test('a long message is cut around the match', () => {
  const text = 'x '.repeat(300) + 'Lisbon hotel ' + 'y '.repeat(300);
  const [chat] = rankChats([row('a', 0, 'user', text)], ['lisbon']);
  assert.match(chat.snippets[0], /^User: \.\.\..*Lisbon hotel.*\.\.\.$/);
  assert.ok(chat.snippets[0].length < 330);
});

test('a chat that matched by title only has no passages', () => {
  const [chat] = rankChats([row('a', 0, 'user', 'something else', { title: 'Lisbon trip' })], ['lisbon']);
  assert.deepEqual(chat.snippets, []);
  const result = chatSearchResult('toolu_1', [chat], 'https://proxi.example');
  assert.equal(result.content[0].content.at(-1).text, '(Only the title matched.)');
});

test('results are citable search results that link to the chat', () => {
  const chats = rankChats([row('lisbon-1', 0, 'user', 'Lisbon hotel?')], ['lisbon']);
  const result = chatSearchResult('toolu_1', chats, 'https://proxi.example');
  assert.equal(result.tool_use_id, 'toolu_1');
  assert.deepEqual(result.content[0], {
    type: 'search_result',
    source: 'https://proxi.example/?chat=lisbon-1',
    title: 'Chat lisbon-1',
    content: [{ type: 'text', text: 'Chat last active 2026-10-14.' }, { type: 'text', text: 'User: Lisbon hotel?' }],
    citations: { enabled: true },
  });
  assert.deepEqual(chatSearchResult('toolu_2', [], 'https://proxi.example'), { type: 'tool_result', tool_use_id: 'toolu_2', content: 'No saved chats matched.' });
  assert.equal(chatSourceUrl('https://p.example', 'a b'), 'https://p.example/?chat=a%20b');
});

test('the tool asks for a query', () => {
  assert.equal(CHAT_SEARCH_TOOL_DEFINITION.name, 'search_chats');
  assert.deepEqual(CHAT_SEARCH_TOOL_DEFINITION.input_schema.required, ['query']);
});
