// Builds lib/docs-index.json from the help center pages in apps/docs: one entry per section
// (a heading and the text under it). `search_docs` searches this file, so the MCP server needs
// no access to apps/docs when it runs. Run `npm run build-docs-index` after changing the docs;
// a test fails when the committed file is out of date.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsDir = fileURLToPath(new URL('../../docs/', import.meta.url));
const outFile = fileURLToPath(new URL('../lib/docs-index.json', import.meta.url));

function mdxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return mdxFiles(path);
    return entry.name.endsWith('.mdx') ? [path] : [];
  });
}

// Plain text from one page: the front matter's title, and the sections split at headings.
export function sectionsOf(source, page) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = match?.[1] ?? '';
  const field = (name) => front.match(new RegExp(`^${name}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1]?.trim() ?? '';
  const title = field('title') || page;
  const body = source.slice(match?.[0].length ?? 0)
    .replace(/^(import|export) .*$/gm, '')
    .replace(/<Update label="([^"]*)"[^>]*>/g, '\n## $1\n')
    .replace(/<\/?[A-Z][A-Za-z]*[^>]*>/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  const sections = [];
  let heading = '';
  let lines = [];
  const flush = () => {
    const text = lines.join('\n').trim();
    if (text) sections.push({ page, title, heading, text });
    lines = [];
  };
  let fenced = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const h = !fenced && line.match(/^#{1,3}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1].trim();
    } else {
      lines.push(line);
    }
  }
  flush();
  const description = field('description');
  if (description && sections.length) sections[0].text = `${description}\n\n${sections[0].text}`;
  return sections;
}

export function buildIndex() {
  return mdxFiles(docsDir).sort().flatMap((file) => {
    const page = relative(docsDir, file).replace(/\\/g, '/').replace(/\.mdx$/, '');
    return sectionsOf(readFileSync(file, 'utf8'), page);
  });
}

export const indexJson = () => `${JSON.stringify(buildIndex(), null, 1)}\n`;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(outFile, indexJson());
  console.log(`Wrote ${buildIndex().length} sections to lib/docs-index.json`);
}
