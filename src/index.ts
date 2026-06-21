import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const app  = createApp();
const port = parseInt(process.env['PORT'] ?? '3000', 10);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Orbit API running on http://localhost:${port}`);
});

// MCP mode: run as stdio server instead of HTTP
if (process.env['MCP_MODE'] === 'stdio') {
  const { startMcpStdio } = await import('./mcp/index.js');
  await startMcpStdio();
}
