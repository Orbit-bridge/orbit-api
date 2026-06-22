# Orbit — System Architecture

> **Version:** 0.1  
> **Scope:** Full system — covers all three repositories

---

## 1. What Orbit Is

Orbit is a **cross-chain routing and execution network**. It finds the optimal path for moving assets between blockchains, scores risk, prices the transfer, and builds the unsigned transactions needed to carry it out.

**The product truth:**  
Moving assets across chains today is manual, opaque, and dangerous. Users must:
- Manually compare bridge fees across fragmented interfaces
- Research which bridges have been hacked and whether they support their assets
- Manage multi-step approvals and submissions across different UIs
- Monitor slow cross-chain confirmations with no feedback
- Recover from failed bridges with no clear path forward

Orbit automates all of this via a clean API.

**What Orbit is not:**  
Orbit is not an AI assistant. It is not a bridge itself. It is not custodial. The AI agent interface (MCP) is a distribution channel layered on top of the core network — not the product.

---

## 2. User Hierarchy

Three real user classes, in order of priority:

### Developers (primary)
Building wallets, fintech apps, on/off-ramps, treasury systems, arbitrage bots.  
They need: a reliable API, deterministic outputs, observability, clear pricing, an SDK.

### Power users (secondary)
Traders, DeFi participants, crypto-native individuals moving their own assets.  
They need: fast routes, low cost, clear risk information, simple confirmation flow.

### AI agents (emerging)
Claude Desktop, Cursor agents, automation workflows calling Orbit tools.  
They need: structured MCP tools, clean function schemas, predictable execution.

---

## 3. Three-Layer Architecture

Orbit is organised into three repositories with a strict dependency direction: intelligence → execution → interface. No reverse dependencies exist.

```
┌───────────────────────────────────────────────────────────────────┐
│                          orbit-api                                 │
│                                                                    │
│   REST API (:3000)            MCP Server (stdio)                   │
│   ─────────────────           ───────────────────                  │
│   POST /quote                 find_best_route                      │
│   GET  /routes                estimate_bridge_cost                 │
│   POST /execute               check_bridge_risk                    │
│   GET  /status/:id            execute_transfer                     │
│                               check_transfer_status                │
│                                                                    │
│   Auth · Rate limiting · Quote cache · WebSocket · SSE             │
└────────────────────┬──────────────────────┬───────────────────────┘
                     │   npm import          │   npm import
                     │                       │
        ┌────────────▼──────────┐  ┌─────────▼──────────────────┐
        │      orbit-core       │  │      orbit-executor         │
        │                       │  │                             │
        │  RouteDiscovery       │  │  Executor                   │
        │  PricingEngine        │  │  BridgeAdapters             │
        │  RiskEngine           │  │    LayerZero                │
        │  LiquidityAnalyzer    │  │    Wormhole (→ Stellar)     │
        │  RouteRanker          │  │    Circle CCTP              │
        │  AssetRegistry        │  │    Axelar                   │
        │  QuoteCache           │  │    Stargate V2              │
        │                       │  │    StellarNative            │
        │  Pure TypeScript      │  │  TransactionMonitor         │
        │  No side effects      │  │  ApprovalManager            │
        │  No I/O (except       │  │  TxSimulator                │
        │  oracle reads)        │  │  TxWatcher                  │
        └───────────────────────┘  └─────────────────────────────┘
```

### Communication model

`orbit-core` and `orbit-executor` are **npm packages imported directly** into `orbit-api` in the same Node.js process. This is not microservices — it is a well-structured monolith with enforced internal boundaries.

Consequences:
- Single deployable unit (one Docker container)
- No inter-service HTTP, no serialisation overhead between layers
- TypeScript types flow across boundaries without API contracts
- No distributed transactions, no partial failure between services
- Can be extracted to separate services later if scale demands it

---

## 4. Stellar-Native Design

Stellar is not "one of nine chains" in Orbit. It is the **architectural anchor**.

### Why Stellar

| Property | Stellar | Ethereum L1 | Base (L2) | Arbitrum |
|----------|---------|-------------|-----------|----------|
| Finality | **~5 seconds** | ~15 minutes | ~2 seconds | ~7 days (fraud proof) |
| Tx cost | **<$0.001** | $2–20 | $0.01–0.10 | $0.01–0.05 |
| USDC | **Circle-issued** (canonical) | Circle-issued | Circle-issued | Circle-issued |
| Native DEX | **SDEX** (built-in AMM) | External | External | External |
| Bridge support | Wormhole NTT | All | Most | Most |

### Stellar routing priority

`orbit-core`'s route ranker applies a **15-point bonus** to any route that uses Stellar natively. This is a deliberate product bias: Orbit exists to demonstrate Stellar's interoperability advantages.

The priority order for routes touching Stellar:

1. **Intra-Stellar swaps** — SDEX path payments. Atomic, ~5s, sub-cent fees. Always preferred when available.
2. **EVM → Stellar bridging** — Wormhole NTT is the only production-grade EVM↔Stellar bridge for USDC.
3. **Stellar → EVM** — same Wormhole NTT path in reverse.

### Stellar-specific constraints

These are architectural, not implementation details:

- **No mempool** — Stellar transactions are accepted or rejected within one ledger (~5s). There is no gas replacement, no stuck transactions, no MEV.
- **XDR, not calldata** — Stellar unsigned transactions are base64 XDR envelopes, not hex calldata. The executor returns `{ type: 'stellar', stellarXdr: '...' }`.
- **Freighter for signing** — The Stellar wallet ecosystem is centred on Freighter. Frontend integrations should use Freighter's API. CLI tools can use Stellar keypairs directly.
- **Assets are `CODE:ISSUER`** — Stellar assets are identified as e.g. `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, not hex addresses.
- **Fixed fees** — Stellar base fee is 100 stroops (0.00001 XLM). No dynamic gas market. `GasOracle` skips Stellar.
- **Horizon, not JSON-RPC** — All Stellar chain data comes from the Horizon REST API. There is no `eth_call` equivalent — Stellar has Soroban RPC for contract simulation.

---

## 5. Non-Custodial Security Model

Orbit **never holds private keys, never signs transactions, never holds user funds** at any point.

The complete flow:

```
Developer / User               orbit-api + orbit-core + orbit-executor              Chain
      │                                       │                                        │
      │  POST /quote                          │                                        │
      ├──────────────────────────────────────►│                                        │
      │                                       │  discover + score + rank routes        │
      │  { routes[], requestId }              │                                        │
      │◄──────────────────────────────────────┤                                        │
      │                                       │                                        │
      │  POST /execute { routeId, addr, sig } │                                        │
      ├──────────────────────────────────────►│                                        │
      │                                       │  verify ECDSA sig                      │
      │                                       │  retrieve route from cache             │
      │                                       │  build unsigned tx(s)                  │
      │  { executionId, payloads[] }          │                                        │
      │◄──────────────────────────────────────┤                                        │
      │                                       │                                        │
      │  (user signs in their own wallet)     │                                        │
      │  submits to chain ─────────────────────────────────────────────────────────►   │
      │                                       │                                        │
      │                                       │  monitors confirmation ◄───────────────┤
      │  GET /stream/status/:id (SSE)         │                                        │
      │◄──────────────────────────────────────┤                                        │
```

### Security invariants

1. **No Orbit-controlled signing** — `TransactionPayload` objects are always unsigned. The caller signs.
2. **ECDSA gating on execute** — `POST /execute` requires an EIP-191 signature from `signerAddress` over the request payload. A third party cannot initiate a transfer on behalf of another address.
3. **Quote cache, not route replay** — The full `Route` object is never sent back by the client. Only `routeId` is sent; Orbit retrieves the original from cache. Clients cannot tamper with route fields.
4. **Nonce replay protection** — Each execute request includes a unique nonce stored in Redis. Replayed requests are rejected.
5. **If the bridge fails** — The bridge protocol itself issues the refund to the original sender. Orbit monitors and reflects this as `ExecutionStatus: 'refunded'`.

---

## 6. Data Flows

### 6.1 Quote flow

```
POST /quote
  │
  ├─ [auth] validateApiKey()
  ├─ [validate] zod schema
  │
  └─ RouteAggregator.findRoutes(request)
       │
       ├─ RouteDiscovery.discoverAllPaths()
       │    ├─ findDirectPaths() → protocols supporting both fromChain + toChain
       │    ├─ findIndirectPaths() → 2-hop paths via hub chains (ethereum, base)
       │    └─ StellarPathDiscovery.findPaths() → SDEX paths (if Stellar involved)
       │
       ├─ filters.removeCircular() → drop paths revisiting a chain
       ├─ filters.removeDuplicates() → drop identical step sequences
       │
       ├─ For each path [parallel]:
       │    ├─ PricingEngine.estimateCost()
       │    │    ├─ GasOracle.getGasData() → live fee history from RPC
       │    │    ├─ FeeCalculator.estimateBridgeFee()
       │    │    ├─ PriceImpactSimulator (if amount > $10k)
       │    │    └─ PriceOracle.getUSDPrice() → Pyth Network
       │    │
       │    └─ RiskEngine.scoreRoute()
       │         ├─ BridgeScorer.scoreSafety()
       │         ├─ IncidentHistoryFetcher.getIncidentScore()
       │         └─ LiquidityAnalyzer.getLiquidity() → live pool TVL
       │
       ├─ filters.removeDominated() → drop routes worse on all dimensions
       ├─ RouteRanker.rank(profile) → tags + recommended
       ├─ QuoteCache.set() → keyed by routeId (TTL: 30s)
       │
       └─ Returns RouteResult { routes[], requestId, generatedAt }
```

### 6.2 Execute flow

```
POST /execute { routeId, signerAddress, nonce, timestamp, signature }
  │
  ├─ [auth] validateApiKey()
  ├─ [security] verifyECDSASignature(signerAddress, payload)
  ├─ [replay] checkNonce(nonce) → reject if seen
  ├─ [cache] QuoteCache.getRoute(routeId) → Route or 404/410 expired
  │
  └─ Executor.execute(route, signerAddress)
       │
       ├─ Create ExecutionState { executionId, status: 'pending', steps: [] }
       ├─ Persist to DB (SQLite)
       │
       └─ runSteps() [async, fire-and-forget]
            │
            ├─ status → 'signing'
            │
            └─ For each step (sequential):
                 │
                 ├─ [EVM only] ApprovalManager.checkAllowance()
                 │    └─ if insufficient → prepend approve() TransactionPayload
                 │
                 ├─ [EVM only] TxSimulator.simulate() via eth_call
                 │    └─ revert → throw SimulationRevertError, step = 'failed'
                 │
                 ├─ adapter.buildTransaction() → TransactionPayload
                 │    ├─ EVM → { type: 'evm', to, data, value }
                 │    └─ Stellar → { type: 'stellar', stellarXdr }
                 │
                 │   ◄── payloads returned to client via SSE/WebSocket
                 │   ◄── client signs + submits externally
                 │
                 ├─ status → 'submitted', srcTxHash stored
                 │
                 ├─ TxWatcher.waitForConfirmation()
                 │    └─ stuck? → buildReplacement (+20% gas), retry ×3
                 │
                 ├─ status → 'bridging'
                 │
                 ├─ BridgeEventListener → destination event / Horizon poll
                 │
                 └─ status → 'completed' / 'failed' / 'refunded'
                      └─ webhooks fired, SSE closed
```

### 6.3 Track flow

Three ways to track a transfer, in order of preference:

| Method | Latency | Best for |
|--------|---------|---------|
| `GET /stream/status/:id` (SSE) | ~100ms push | Browser frontends, long-running transfers |
| `WS /ws/status/:id` | ~100ms push | Native app clients, programmatic integration |
| `GET /status/:id` (polling) | Depends on poll interval | Simple scripts, CLI tools |

---

## 7. Interface Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    orbit-api (:3000)                     │
│                                                         │
│  Layer 1 — REST API                                     │
│  Primary interface. Used by developers, wallets, apps.  │
│  Full capability: quote, execute, track, manage keys.   │
│                                                         │
│  Layer 2 — MCP Server (stdio)                           │
│  Secondary interface. Used by AI agents.                │
│  Wraps REST API logic. Conversational output format.    │
│  Exposes tools + resources for Claude/Cursor.           │
│                                                         │
│  Layer 3 — orbit-sdk (future)                           │
│  TypeScript SDK wrapping the REST API.                  │
│  Type-safe client for developer applications.           │
└─────────────────────────────────────────────────────────┘
```

**Build order:** REST API → SDK → MCP.  
The MCP server is built last because it wraps the REST API, not the other way round. Improving `orbit-core` route quality automatically improves all three layers simultaneously.

---

## 8. Deployment

Single VPS, Docker Compose. TLS via Nginx + Let's Encrypt.

```
internet
   │
   ▼
Nginx (443 → :3000, WebSocket upgrade)
   │
   ▼
orbit-api container (:3000)
   │
   ├── imports @orbit-bridge/core
   ├── imports @orbit-bridge/executor
   ├── reads/writes SQLite (./data/orbit.db)
   └── connects to Redis (:6379)

redis container (:6379)
   ├── quote cache (route:${routeId} keys, 30s TTL)
   ├── rate limit counters (per API key, sliding window)
   └── nonce store (execute request nonces, 10min TTL)
```

### docker-compose.yml (production)

```yaml
services:
  api:
    image: ghcr.io/orbit-bridge/orbit-api:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      NODE_ENV: production
      PORT: 3000
      STELLAR_NETWORK: mainnet
      STELLAR_HORIZON_URL: https://horizon.stellar.org
      REDIS_URL: redis://redis:6379
      DB_PATH: /data/orbit.db
      LOG_LEVEL: info
    volumes:
      - orbit-data:/data
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data

volumes:
  orbit-data:
  redis-data:
```

### Nginx configuration (excerpt)

```nginx
server {
  listen 443 ssl;
  server_name api.orbit.bridge;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;   # keep SSE/WS connections alive
  }
}
```

---

## 9. Architectural Decision Records

### ADR-001 — npm packages, not microservices

**Status:** Accepted  
**Decision:** `orbit-core` and `orbit-executor` are TypeScript npm packages imported directly into `orbit-api` in the same process.

**Context:** At current scale, three network-separated services would add operational complexity (service discovery, health checks, inter-service auth, serialization contracts) with no benefits.

**Consequences:**
- Single deployable process — simpler ops, faster local development
- TypeScript types flow across all three packages without API contracts
- No network round-trip between intelligence and execution layers
- To extract into microservices later: the boundary is already clean (each package has a single public export)

---

### ADR-002 — Stellar is the anchor, not a peer

**Status:** Accepted  
**Decision:** `orbit-core` applies a 15-point route score bonus for any route that touches Stellar natively. `RouteDiscovery` queries Stellar Horizon for SDEX paths alongside bridge protocol paths.

**Context:** Orbit's core differentiation is making Stellar's interoperability advantages accessible. A chain-agnostic router would underweight Stellar's 5s finality and sub-cent fees.

**Consequences:**
- Orbit will recommend Stellar-touching routes more often than pure-cost optimisation would
- Stellar path discovery adds ~100ms to quote time (Horizon API call)
- Some EVM-only users will receive Stellar-routed quotes they didn't expect

---

### ADR-003 — Fully non-custodial; unsigned transactions only

**Status:** Accepted  
**Decision:** `orbit-executor` returns `TransactionPayload[]` (unsigned calldata / XDR) and never submits transactions to the chain.

**Context:** Holding signing authority is custodial — it creates regulatory exposure, makes Orbit a high-value attack target, and breaks user trust.

**Consequences:**
- Orbit cannot offer a "single-click bridge" without a wallet integration (frontend or Freighter)
- Users must sign and submit each step themselves (or via an SDK wrapper)
- Orbit monitors the chain after the user submits, without any privileged access

---

### ADR-004 — ECDSA signature required on POST /execute

**Status:** Accepted  
**Decision:** `POST /execute` requires the caller to sign the request payload with the private key of `signerAddress`. Orbit verifies via `viem.verifyMessage()`.

**Context:** Without this, any API key holder can initiate a transfer for any `signerAddress` — including addresses they don't control. This would let a rogue client drain a user's bridge allowance.

**Consequences:**
- Client must implement EIP-191 signing (trivial with viem/ethers/Freighter)
- Stellar addresses require a different signing scheme (Ed25519, handled separately)
- Nonces must be stored (Redis) to prevent replay attacks

---

### ADR-005 — Route cache as the bridge between quote and execute

**Status:** Accepted  
**Decision:** `POST /execute` accepts only `{ routeId, signerAddress, signature }`. The full `Route` object is retrieved from `QuoteCache` server-side.

**Context:** If the client sends the full route object back, they can modify it — changing fees, destination addresses, or route steps. This is a critical attack surface for a financial system.

**Consequences:**
- Routes must be fetched via `POST /quote` before executing (no cold-start execution)
- Quotes expire in 30 seconds — users must execute promptly or re-quote
- Cache must be shared across API instances (Redis) for horizontal scaling

---

### ADR-006 — SQLite for execution state, Redis for ephemeral state

**Status:** Accepted  
**Decision:** Execution state (`ExecutionState`) is persisted in SQLite via Drizzle ORM. Quote cache, rate limit counters, and nonces live in Redis.

**Context:** Execution state is durable business data — it must survive restarts. Quote cache is ephemeral — 30-second TTL makes Redis ideal. Mixing both into SQLite would create contention under load.

**Consequences:**
- SQLite is simple to operate on a VPS — no separate DB server
- Redis is already required for quote cache — adding rate limiting costs nothing
- Migrating from SQLite to Postgres is straightforward (Drizzle supports both)

---

## 10. Error Handling Philosophy

Three categories of errors, handled differently:

### User errors (4xx)
Validation failures, expired quotes, bad signatures, rate limits.  
Orbit returns a structured `ApiError` with a machine-readable `code` and human-readable `error`.  
Never retry these without changing the request.

```ts
{ error: 'Quote expired or not found', code: 'QUOTE_EXPIRED', status: 410 }
```

### Bridge errors (execution failures)
Simulation reverts, stuck transactions, bridge timeouts.  
Orbit retries with backoff (gas replacement for EVM). After max retries, `ExecutionStatus` transitions to `'failed'`.  
The bridge protocol handles the refund; Orbit detects and reflects `'refunded'`.

### Infrastructure errors (5xx)
RPC node down, Horizon unavailable, Redis connection lost.  
Orbit falls back where possible (last known gas price, in-memory cache) and logs at `error` level.  
Returns 503 with `Retry-After` header when the system cannot serve the request.

---

## 11. Extension Points

These are the correct places to extend Orbit without breaking existing behaviour:

| What to add | Where | How |
|-------------|-------|-----|
| New bridge protocol | `orbit-executor/src/adapters/<name>/` | Extend `BaseAdapter`, register in `adapters/index.ts` |
| New chain | `orbit-core/src/routes/discovery.ts` | Add to `PROTOCOL_CHAIN_SUPPORT` and `CHAIN_RELIABILITY` |
| New pricing signal | `orbit-core/src/pricing/` | Add a class, inject into `PricingEngine` |
| New risk signal | `orbit-core/src/risk/` | Add a class, blend into `RiskEngine.scoreRoute()` |
| New API endpoint | `orbit-api/src/routes/` | Add Hono handler, register in `app.ts` |
| New MCP tool | `orbit-api/src/mcp/server.ts` | Add `server.tool(...)` call |
| New chain's wallet signing | Client-side only | Orbit returns unsigned payload; signing is the client's concern |

---

## 12. Repository Map

```
Orbit-bridge/
├── orbit-core          → @orbit-bridge/core npm package
│   ├── src/
│   │   ├── types/      → Chain, Route, RiskMetrics, etc.
│   │   ├── routes/     → RouteDiscovery, RouteAggregator
│   │   ├── risk/       → RiskEngine, BridgeScorer, LiquidityAnalyzer
│   │   ├── pricing/    → PricingEngine, GasEstimator, FeeCalculator
│   │   ├── ranking/    → RouteRanker
│   │   ├── assets/     → AssetRegistry (canonical addresses)
│   │   └── cache/      → QuoteCache
│   └── tests/
│
├── orbit-executor      → @orbit-bridge/executor npm package
│   ├── src/
│   │   ├── types/      → ExecutionState, BridgeAdapter, TransactionPayload
│   │   ├── adapters/   → LayerZero, Wormhole, CCTP, Axelar, Stargate, Stellar
│   │   ├── orchestrator/ → Executor
│   │   ├── tracker/    → TransactionMonitor, BridgeEventListener
│   │   ├── wallet/     → ApprovalManager
│   │   ├── db/         → ExecutionRepository (SQLite)
│   │   └── simulator/  → TxSimulator
│   └── tests/
│
└── orbit-api           → Deployable Node.js application
    ├── src/
    │   ├── types/      → API-level types (ApiRoute, QuoteRequest, etc.)
    │   ├── app.ts      → Hono application factory
    │   ├── routes/     → REST handlers (quote, execute, status, routes)
    │   ├── mcp/        → MCP server + tools
    │   ├── auth/       → API key validation, ECDSA verification
    │   ├── middleware/  → Auth, rate limiting, logging
    │   ├── webhooks/   → Delivery engine
    │   └── cache/      → Redis quote cache wrapper
    ├── ARCHITECTURE.md (this file)
    ├── AGENT.md
    ├── DEVELOPMENT.md
    ├── docker-compose.yml
    └── .env.example
```
