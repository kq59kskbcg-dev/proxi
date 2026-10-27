import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import * as z from 'zod';

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
  return server;
}

export const handler = createMcpHandler(createServer);
