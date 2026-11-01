import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { redact } from './redact.js';

const DISCOVERY_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 60000; // a web search can take a while

let connection = null;

export function getMcpTools() {
  const url = process.env.MCP_URL?.trim();
  if (!url) return Promise.resolve(null);
  connection ??= connect(url).catch((error) => {
    connection = null;
    console.error('MCP connection failed', error);
    return null;
  });
  return connection;
}

async function connect(url) {
  const client = new Client({ name: 'proxi-web', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: DISCOVERY_TIMEOUT_MS });
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: DISCOVERY_TIMEOUT_MS });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return {
    tools: tools.map(toClaudeTool),
    titles: Object.fromEntries(tools.map((tool) => [tool.name, tool.title || tool.name])),
    call: (block) => callTool(client, block),
  };
}

export function toClaudeTool(tool) {
  const { $schema, ...input_schema } = tool.inputSchema;
  return { name: tool.name, description: tool.description ?? tool.title ?? tool.name, input_schema };
}

async function callTool(client, block) {
  try {
    const result = await client.callTool({ name: block.name, arguments: redactArgs(block.input ?? {}) }, { timeout: CALL_TIMEOUT_MS });
    return { type: 'tool_result', tool_use_id: block.id, content: toClaudeContent(result), is_error: result.isError === true };
  } catch (error) {
    return { type: 'tool_result', tool_use_id: block.id, content: `Tool failed: ${error?.message || 'unknown error'}`, is_error: true };
  }
}

// Tool inputs leave Proxi (a web search query goes to a search provider), so
// they're redacted like messages: no card numbers, IBANs, emails or phone numbers.
export function redactArgs(value) {
  if (typeof value === 'string') return redact(value).text;
  if (Array.isArray(value)) return value.map(redactArgs);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactArgs(v)]));
  return value;
}

export function toClaudeContent(result) {
  const blocks = (result.content ?? []).map((item) => {
    if (item.type === 'text') return { type: 'text', text: item.text };
    if (item.type === 'image') return { type: 'image', source: { type: 'base64', media_type: item.mimeType, data: item.data } };
    if (item.type === 'resource' && typeof item.resource?.text === 'string') return toSearchResult(item.resource);
    return { type: 'text', text: JSON.stringify(item) };
  });
  if (!blocks.length && result.structuredContent) blocks.push({ type: 'text', text: JSON.stringify(result.structuredContent) });
  if (!blocks.length) return [{ type: 'text', text: '(no output)' }];
  // A tool result with search results may hold nothing else: the API rejects the mix with a 400.
  // Other text, such as web_search's written answer, goes in as a search result of its own. Its
  // source isn't a web address, so the chat shows no link when Claude cites it.
  if (blocks.some((b) => b.type === 'search_result')) {
    const text = blocks.filter((b) => b.type === 'text');
    const results = blocks.filter((b) => b.type === 'search_result');
    if (!text.length) return results;
    return [{
      type: 'search_result',
      source: 'tool-output',
      title: 'Tool answer',
      content: text.map((b) => ({ type: 'text', text: b.text })),
      citations: { enabled: true },
    }, ...results];
  }
  return blocks;
}

function toSearchResult(resource) {
  const title = resource._meta?.title ?? resource.title ?? resource.uri;
  return {
    type: 'search_result',
    source: resource.uri,
    title: String(title),
    content: [{ type: 'text', text: resource.text }],
    citations: { enabled: true },
  };
}
