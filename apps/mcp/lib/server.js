import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod';
import { searchDocs, DocsSearchError } from './mintlify.js';

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
  return server;
}

export const handler = createMcpHandler(createServer);
