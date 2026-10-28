import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const DISCOVERY_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 20000;

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
    const result = await client.callTool({ name: block.name, arguments: block.input ?? {} }, { timeout: CALL_TIMEOUT_MS });
    return { type: 'tool_result', tool_use_id: block.id, content: toClaudeContent(result), is_error: result.isError === true };
  } catch (error) {
    return { type: 'tool_result', tool_use_id: block.id, content: `Tool failed: ${error?.message || 'unknown error'}`, is_error: true };
  }
}

export function toClaudeContent(result) {
  const blocks = (result.content ?? []).map((item) => {
    if (item.type === 'text') return { type: 'text', text: item.text };
    if (item.type === 'image') return { type: 'image', source: { type: 'base64', media_type: item.mimeType, data: item.data } };
    if (item.type === 'resource' && typeof item.resource?.text === 'string') return toSearchResult(item.resource);
    return { type: 'text', text: JSON.stringify(item) };
  });
  if (!blocks.length && result.structuredContent) blocks.push({ type: 'text', text: JSON.stringify(result.structuredContent) });
  return blocks.length ? blocks : [{ type: 'text', text: '(no output)' }];
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
