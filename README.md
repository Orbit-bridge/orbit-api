# orbit-api

> The control tower of [Orbit](https://github.com/Orbit-bridge) — REST API, MCP server, and orchestration layer.

`orbit-api` is the public face of Orbit. It connects frontends, AI agents (via MCP), and third-party integrations to `orbit-core` (intelligence) and `orbit-executor` (execution).

---

## What it exposes

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/routes?from=&to=&asset=&amount=` | Find best routes (quick GET) |
| `POST` | `/quote` | Find and rank routes (full body) |
| `POST` | `/execute` | Execute a route |
| `GET` | `/status/:id` | Track a transfer |
| `GET` | `/health` | Health check |

### MCP tools (for Claude, Cursor, VSCode)

| Tool | Description |
|------|-------------|
| `find_best_route` | Discovers and ranks cross-chain routes |
| `estimate_bridge_cost` | Returns cost breakdown for a transfer |
| `check_bridge_risk` | Safety and risk score for a route |
| `execute_transfer` | Initiates a bridge execution |
| `check_transfer_status` | Live status of an in-flight transfer |

---

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

API runs on `http://localhost:3000`.

---

## MCP setup (Claude Desktop / Cursor)

Add to your MCP config:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": ["path/to/orbit-api/dist/index.js"],
      "env": { "MCP_MODE": "stdio" }
    }
  }
}
```

Then ask Claude:

> "Find the cheapest route to send 500 USDC from Base to Stellar"

---

## Quote example

```bash
curl -X POST http://localhost:3000/quote \
  -H 'Content-Type: application/json' \
  -d '{
    "fromChain": "base",
    "toChain":   "stellar",
    "fromAsset": "USDC",
    "toAsset":   "USDC",
    "amount":    "500"
  }'
```

---

## Environment variables

```env
PORT=3000
MCP_MODE=          # set to "stdio" to run as MCP server
```

---

## Architecture

```
orbit-api           ← you are here
├── calls orbit-core    for route intelligence
└── calls orbit-executor for execution
```
