import { timingSafeEqual } from 'node:crypto';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { searchDocs, DocsSearchError } from './mintlify.js';
import { searchWeb, webSearchConfigured, WebSearchError } from './websearch.js';

export const VERSION = '0.1.0';
const startedAt = Date.now();

export function getStatus() {
  return {
    status: 'ok',
    service: 'proxi-mcp',
    version: VERSION,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  };
}

export function createServer() {
  const server = new McpServer({ name: 'proxi', version: VERSION });
  server.registerTool(
    'get_status',
    {
      title: 'Get status',
      description: 'Check that the Proxi MCP server is up. Returns its status, version and uptime as JSON.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.literal('ok'),
        service: z.string(),
        version: z.string(),
        uptimeSeconds: z.number(),
        time: z.string(),
      }),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const status = getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status };
    },
  );
  server.registerTool(
    'search_docs',
    {
      title: 'Search Proxi docs',
      description: 'Search the Proxi documentation (features, privacy, security, how Proxi works). Use it for any question about Proxi itself, and cite the results you use. Returns matching passages with their page title and link.',
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe('What to look for, in plain words.'),
        limit: z.number().int().min(1).max(10).optional().describe('How many passages to return (default 5).'),
      }),
      outputSchema: z.object({
        results: z.array(z.object({ title: z.string(), url: z.string(), text: z.string(), score: z.number().optional() })),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit }) => {
      try {
        const results = await searchDocs(query, { limit: limit ?? 5 });
        if (!results.length) {
          return { content: [{ type: 'text', text: 'No matching docs found.' }], structuredContent: { results } };
        }
        return {
          content: results.map((r) => ({
            type: 'resource',
            resource: { uri: r.url, mimeType: 'text/markdown', text: r.text, _meta: { title: r.title } },
          })),
          structuredContent: { results },
        };
      } catch (error) {
        const message = error instanceof DocsSearchError ? error.message : 'Docs search is unavailable right now.';
        if (!(error instanceof DocsSearchError)) console.error('search_docs failed', error);
        return { content: [{ type: 'text', text: message }], isError: true };
      }
    },
  );
  // Offered only when it can work, so the agent never picks a tool that always fails.
  if (webSearchConfigured()) {
    server.registerTool(
      'web_search',
      {
        title: 'Search the web',
        description: "Search the web for current or recent information: news, prices, releases, events, or facts that change over time or that you don't know. Don't use it for questions about Proxi itself (use search_docs) or for general knowledge you already have. Returns a short answer and the web pages it cites; cite the ones you use.",
        inputSchema: z.object({
          query: z.string().min(1).max(300).describe('What to look up, as a clear question or search phrase.'),
        }),
        outputSchema: z.object({
          answer: z.string(),
          sources: z.array(z.object({ title: z.string(), url: z.string(), text: z.string() })),
        }),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async ({ query }) => {
        try {
          const { cited, ...result } = await searchWeb(query);
          // With cited pages, the chat model gets only those pages, whose passages hold the
          // answer's facts. Given the written answer too, it often cites that instead, and the
          // answer has no web address to link, so the reply shows no sources.
          return {
            content: [
              ...(cited ? [] : [{ type: 'text', text: result.answer || 'No answer was found.' }]),
              ...result.sources.map((r) => ({
                type: 'resource',
                resource: { uri: r.url, mimeType: 'text/plain', text: r.text, _meta: { title: r.title } },
              })),
            ],
            structuredContent: result,
          };
        } catch (error) {
          const message = error instanceof WebSearchError ? error.message : 'Web search is unavailable right now.';
          if (!(error instanceof WebSearchError)) console.error('web_search failed', error?.status ?? error?.name);
          return { content: [{ type: 'text', text: message }], isError: true };
        }
      },
    );
  }
  return server;
}

// Only callers with the shared MCP_TOKEN get in: the tools spend our Anthropic and Mintlify quota.
// Fails closed: without MCP_TOKEN set, nobody gets in.
export function requireToken(request) {
  // Trimmed: a value pasted with a trailing space or line break would fail every check.
  const expected = process.env.MCP_TOKEN?.trim();
  if (!expected) return { error: 'The MCP server is not set up yet.', status: 503 };
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
  const given = Buffer.from(match ? match[1].trim() : '');
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { error: 'Unauthorized.', status: 401 };
  return null;
}

export function withAuth(inner) {
  return {
    ...inner,
    fetch(request, options) {
      const denied = requireToken(request);
      if (denied) return Response.json({ error: denied.error }, { status: denied.status, headers: denied.status === 401 ? { 'www-authenticate': 'Bearer' } : {} });
      return inner.fetch(request, options);
    },
  };
}

export const handler = withAuth(createMcpHandler(createServer));
