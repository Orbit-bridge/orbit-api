import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { routesHandler } from './routes/routes.js';
import { quoteHandler } from './routes/quote.js';
import { executeHandler } from './routes/execute.js';
import { statusHandler } from './routes/status.js';

export function createApp() {
  const app = new Hono();

  app.use('*', logger());
  app.use('*', cors({ origin: '*' }));
  app.use('*', prettyJSON());

  app.get('/', (c) => c.json({
    name:    'orbit-api',
    version: '0.1.0',
    docs:    'https://github.com/Orbit-bridge/orbit-api',
  }));

  app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

  // Route intelligence
  app.get ('/routes',   routesHandler);
  app.post('/quote',    quoteHandler);

  // Execution
  app.post('/execute',        executeHandler);
  app.get ('/status/:id',     statusHandler);

  app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND', status: 404 }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Internal server error', code: 'INTERNAL_ERROR', status: 500 }, 500);
  });

  return app;
}
