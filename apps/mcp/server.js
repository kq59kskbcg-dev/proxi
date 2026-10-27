import http from 'node:http';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { handler } from './lib/server.js';

const port = Number(process.env.PORT) || 3001;
http.createServer(toNodeHandler(handler)).listen(port, '127.0.0.1', () => {
  console.log(`Proxi MCP server on http://localhost:${port}/mcp`);
});
