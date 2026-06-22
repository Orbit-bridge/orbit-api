# orbit-api — Development Guide

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 20 | Runtime |
| npm | ≥ 10 | Package management |
| Redis | ≥ 7 | Quote cache + rate limiting (optional for local) |
| Docker | any | Full stack local run |

For integration testing against real testnets:
- Stellar testnet account with XLM (get from https://laboratory.stellar.org/#account-creator)
- Base Sepolia RPC URL (Alchemy or Infura free tier)

---

## Local Setup

```bash
# 1. Clone all three repos (orbit-api imports the other two as packages)
git clone https://github.com/Orbit-bridge/orbit-core
git clone https://github.com/Orbit-bridge/orbit-executor
git clone https://github.com/Orbit-bridge/orbit-api

# 2. Install and link packages
cd orbit-core && npm install && npm run build && npm link
cd orbit-executor && npm install && npm run build && npm link
cd orbit-api && npm install
npm link @orbit-bridge/core @orbit-bridge/executor

# 3. Configure environment
cp .env.example .env
# Edit .env — at minimum set STELLAR_NETWORK and one EVM RPC URL

# 4. Run database migrations
npm run db:migrate

# 5. Start development server (hot-reload)
npm run dev
```

The API will be available at `http://localhost:3000`.

---

## Environment Variables

See `.env.example` for all variables. The minimum required for local development:

```env
STELLAR_NETWORK=testnet
PORT=3000
LOG_LEVEL=debug
```

For quote functionality to work with live data:
```env
PYTH_HERMES_URL=https://hermes.pyth.network
EVM_RPC_BASE=https://mainnet.base.org    # or Alchemy/Infura URL
```

---

## Running the Full Stack with Docker

```bash
cd orbit-api
docker compose up
```

This starts:
- `orbit-api` on port 3000
- `redis` on port 6379

Logs from all services are streamed to the terminal. `Ctrl+C` to stop.

---

## MCP Development Mode

To run as an MCP server (for Claude Desktop or Cursor testing):

```bash
MCP_MODE=stdio npm run dev
```

Or point your MCP client at the built binary:
```json
{
  "command": "node",
  "args": ["./dist/index.js"],
  "env": { "MCP_MODE": "stdio", "STELLAR_NETWORK": "testnet" }
}
```

---

## Testing

```bash
# Unit tests (no network)
npm test

# Unit tests with coverage
npm run test:coverage

# Integration tests (requires TESTNET_ENABLED=true and testnet credentials)
TESTNET_ENABLED=true npm run test:integration
```

Test structure:
```
tests/
├── unit/
│   ├── auth/
│   ├── routes/
│   ├── mcp/
│   └── middleware/
├── integration/
│   └── e2e-stellar-testnet.test.ts
└── fixtures/
    ├── routes.ts      ← canned Route objects
    └── executions.ts  ← canned ExecutionState objects
```

---

## Key npm Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Start with tsx watch (hot reload) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled output (production) |
| `npm test` | Run unit tests with Vitest |
| `npm run test:run` | Run tests once (no watch) |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run test:integration` | Run E2E tests (requires env) |
| `npm run db:migrate` | Create/update SQLite schema |
| `npm run generate-key` | Generate a new API key |
| `npm run generate-spec` | Write OpenAPI spec to `dist/openapi.json` |
| `npm run lint` | ESLint on `src/` |

---

## Project Conventions

### File naming
- Route handlers: `src/routes/<resource>.ts`
- Middleware: `src/middleware/<concern>.ts`
- MCP tools: `src/mcp/server.ts` (all tools in one file, grouped by domain)
- Tests mirror source: `tests/unit/routes/quote.test.ts` tests `src/routes/quote.ts`

### Error handling
All errors thrown inside route handlers are caught by Hono's `app.onError()`. Throw an instance of `ApiError` for structured client-facing errors:
```ts
throw new ApiError('Quote expired or not found', 'QUOTE_EXPIRED', 410);
```

### Logging
Use `logger` (pino) exported from `src/middleware/logger.ts`, not `console.log`:
```ts
import { logger } from '../middleware/logger.js';
logger.info({ executionId, status }, 'execution status changed');
```

### Environment access
Never read `process.env` directly in route handlers or services. Import from `src/config.ts`, which validates all env vars at startup using Zod:
```ts
import { config } from '../config.js';
config.stellarHorizonUrl; // typed, validated
```

---

## Adding a New REST Endpoint

1. Create `src/routes/<name>.ts` with the Hono handler
2. Add Zod schema for request validation using `zValidator`
3. Register in `src/app.ts`
4. Add to OpenAPI registry in `src/routes/openapi.ts`
5. Write unit test in `tests/unit/routes/<name>.test.ts`

---

## Adding a New MCP Tool

1. Open `src/mcp/server.ts`
2. Add `server.tool('<name>', '<description>', zodSchema, handler)` before `return server`
3. The handler receives validated args — no manual validation needed
4. Format output as conversational text, not raw JSON
5. Add a unit test in `tests/unit/mcp/tools.test.ts`
