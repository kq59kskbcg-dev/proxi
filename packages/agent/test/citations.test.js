import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceNumber, linkSafe, escapeLinkText, citationMarker, sourcesList, blockCitations } from '../src/citations.js';

const cite = (source, title) => ({ type: 'search_result_location', source, title });

test('sources are numbered in the order first cited, once per URL', () => {
  const sources = [];
  assert.equal(sourceNumber(sources, cite('https://a.example/x', 'A')), 1);
  assert.equal(sourceNumber(sources, cite('https://b.example/y', 'B')), 2);
  assert.equal(sourceNumber(sources, cite('https://a.example/x', 'A again')), 1);
  assert.deepEqual(sources, [{ url: 'https://a.example/x', title: 'A' }, { url: 'https://b.example/y', title: 'B' }]);
});

test('a citation without a web URL gets no number', () => {
  const sources = [];
  assert.equal(sourceNumber(sources, cite('javascript:alert(1)', 'x')), 0);
  assert.equal(sourceNumber(sources, cite(undefined, 'x')), 0);
  assert.equal(sourceNumber(sources, null), 0);
  assert.deepEqual(sources, []);
});

test('spaces in URLs and brackets in titles cannot break the Markdown link', () => {
  const sources = [];
  sourceNumber(sources, cite('https://a.example/a b', ''));
  assert.equal(sources[0].url, 'https://a.example/a%20b');
  assert.equal(sources[0].title, 'https://a.example/a b', 'the URL is the title when there is none');
  assert.equal(escapeLinkText('a [b] \\c'), 'a \\[b\\] \\\\c');
});

test('markers link each number to its source', () => {
  const sources = [{ url: 'https://a.example', title: 'A' }, { url: 'https://b.example', title: 'B' }];
  assert.equal(citationMarker(sources, new Set([2, 1])), '[[2]](https://b.example)[[1]](https://a.example)');
});

test('the Sources list is numbered, and empty when nothing was cited', () => {
  assert.equal(sourcesList([]), '');
  assert.equal(sourcesList([{ url: 'https://a.example', title: 'A [1]' }, { url: 'https://b.example', title: 'B' }]),
    '\n\n**Sources**\n1. [A \\[1\\]](https://a.example)\n2. [B](https://b.example)');
});

test('a block citing the same sources as the one before it gets no marker', () => {
  const sources = [];
  const blocks = blockCitations(sources);
  blocks.cite(cite('https://a.example', 'A'));
  assert.equal(blocks.endBlock(true), '[[1]](https://a.example)');
  blocks.cite(cite('https://a.example', 'A'));
  assert.equal(blocks.endBlock(true), '');
  blocks.cite(cite('https://b.example', 'B'));
  assert.equal(blocks.endBlock(true), '[[2]](https://b.example)');
});

test('uncited text resets the marker, but an empty block does not', () => {
  const blocks = blockCitations([]);
  blocks.cite(cite('https://a.example', 'A'));
  assert.equal(blocks.endBlock(true), '[[1]](https://a.example)');
  assert.equal(blocks.endBlock(false), '');
  blocks.cite(cite('https://a.example', 'A'));
  assert.equal(blocks.endBlock(true), '', 'an empty block in between keeps the last marker');
  assert.equal(blocks.endBlock(true), '');
  blocks.cite(cite('https://a.example', 'A'));
  assert.equal(blocks.endBlock(true), '[[1]](https://a.example)', 'uncited text in between shows it again');
});

test('a citation without a URL adds no marker', () => {
  const blocks = blockCitations([]);
  blocks.cite(cite('not a url', 'x'));
  assert.equal(blocks.endBlock(true), '');
});

// The destination a Markdown parser reads for "[text](url)": up to the first ")" or whitespace.
const destination = (link) => link.match(/\]\(([^)\s]*)\)/)?.[1];

test('parentheses and whitespace in cited URLs are encoded so the link stays whole', () => {
  assert.equal(linkSafe('https://en.wikipedia.org/wiki/Mercury_(planet)'), 'https://en.wikipedia.org/wiki/Mercury_%28planet%29');
  assert.equal(linkSafe('https://a.example/a b\tc\nd'), 'https://a.example/a%20b%09c%0Ad');
  assert.equal(linkSafe('https://a.example/x?q=(1)%20'), 'https://a.example/x?q=%281%29%20', 'existing escapes are kept');

  const sources = [];
  const url = 'https://en.wikipedia.org/wiki/Mercury_(planet) notes';
  assert.equal(sourceNumber(sources, cite(url, 'Mercury (planet)')), 1);
  assert.equal(sourceNumber(sources, cite(url, 'again')), 1, 'the same URL keeps its number');
  const encoded = 'https://en.wikipedia.org/wiki/Mercury_%28planet%29%20notes';
  assert.equal(destination(citationMarker(sources, [1])), encoded);
  assert.equal(destination(sourcesList(sources)), encoded);
  assert.match(sourcesList(sources), /1\. \[Mercury \(planet\)\]\(/);

  // An unmatched ")" used to end the link early, leaving the rest of the URL as text.
  const unmatched = [];
  sourceNumber(unmatched, cite('https://a.example/smile:)/page', ''));
  assert.equal(destination(citationMarker(unmatched, [1])), 'https://a.example/smile:%29/page');
});
