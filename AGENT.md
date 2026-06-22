# Orbit — AI Agent Integration (MCP)

> This document is for developers connecting AI agents to Orbit via the Model Context Protocol (MCP).  
> For the REST API, see the main README. For system architecture, see ARCHITECTURE.md.

---

## What MCP gives you

When an AI agent (Claude Desktop, Cursor, VS Code) is connected to Orbit, it can:
- Find the best cross-chain routes for any transfer
- Break down the full cost and risk of each route
- Initiate a transfer execution (returns unsigned payloads for the user to sign)
- Track a transfer in real time

### The right mental model

MCP is a **distribution interface**, not the product. The routing intelligence lives in `orbit-core`, the execution engine lives in `orbit-executor`, and the REST API is the primary programmatic interface. MCP wraps these the same way a great CLI wraps a library.

Improving `orbit-core`'s route quality automatically improves what the AI agent returns — there is no separate "agent logic" to maintain.

---

## Connecting to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": ["/path/to/orbit-api/dist/index.js"],
      "env": {
        "MCP_MODE": "stdio",
        "STELLAR_NETWORK": "mainnet"
      }
    }
  }
}
```

Or if running orbit-api as a Docker container, use the HTTP transport via `mcp-remote`:

```json
{
  "mcpServers": {
    "orbit": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

Restart Claude Desktop. You should see "orbit" in the tools panel.

---

## Connecting to Cursor

Add to `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` globally):

```json
{
  "mcpServers": {
    "orbit": {
      "command": "node",
      "args": ["/path/to/orbit-api/dist/index.js"],
      "env": {
        "MCP_MODE": "stdio"
      }
    }
  }
}
```

After saving, open the Cursor settings → MCP and confirm the server shows as connected.

---

## MCP Tool Reference

### `find_best_route`

Find and rank cross-chain routes for a transfer. Always call this first.

**Arguments:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `fromChain` | string | Source chain: `base`, `ethereum`, `arbitrum`, `stellar`, etc. |
| `toChain` | string | Destination chain |
| `fromAsset` | string | Asset to send: `USDC`, `ETH`, `XLM`, etc. |
| `toAsset` | string | Asset to receive (can be same as fromAsset) |
| `amount` | string | Amount as a string: `"500"` |

**Returns:** Top 3 routes ranked by balanced score, each with:
- Protocol path (e.g. `wormhole`)
- Estimated cost, time, and risk score (0–100)
- Warnings (e.g. multi-hop, low liquidity)
- Amount the user receives after fees and slippage
- `requestId` for follow-up tool calls

**Example prompt:**
> "Find the best route to send 500 USDC from Base to Stellar"

**Example output:**
```
Found 3 routes for 500 USDC from base → stellar

Route 1 [safest, balanced]
  Protocol: wormhole
  Cost: $1.80  Time: 2m  Risk: 87/100
  You receive: 498.20 USDC

Route 2 [cheapest]
  Protocol: layerzero → wormhole
  Cost: $1.10  Time: 4m  Risk: 76/100
  ⚠ Multi-hop route: higher complexity and gas cost
  You receive: 498.90 USDC

Route 3 [fastest]
  Protocol: stellar-native
  Cost: $0.01  Time: <1m  Risk: 90/100
  You receive: 499.99 USDC

requestId: f4a2b1c3-...
```

---

### `estimate_bridge_cost`

Get a detailed cost breakdown for a transfer without the full route comparison.

**Arguments:** Same as `find_best_route`.

**Returns:** Cost breakdown for the cheapest available route.

**Example prompt:**
> "How much will it cost to bridge 1000 USDC from Ethereum to Base?"

**Example output:**
```
Cost estimate for 1000 USDC (ethereum → base)

  Gas:          $3.20
  Bridge fee:   $0.00
  Slippage:     0.000%
  Total cost:   $3.20
  You receive:  996.80 USDC
```

---

### `check_bridge_risk`

Assess the safety of a specific bridge before committing.

**Arguments:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromChain` | string | Yes | Source chain |
| `toChain` | string | Yes | Destination chain |
| `amount` | string | Yes | Transfer amount |
| `asset` | string | Yes | Asset being transferred |
| `protocol` | string | No | Specific protocol to check (omit for best available) |

**Returns:** Risk rating with component breakdown and any warnings.

**Example prompt:**
> "Is it safe to use Wormhole to bridge $50k USDC from Ethereum to Stellar?"

**Example output:**
```
Risk assessment: ⚠️ Moderate (76/100)

  Bridge safety:        75/100
  Liquidity:            85/100
  Protocol reliability: 88/100
  Failure probability:  0.50%

Warnings:
  • Wormhole had a $320M exploit in 2022 (patched and reimbursed)
  • For amounts above $10k, consider CCTP for zero-slippage USDC (EVM only)
```

---

### `execute_transfer`

Initiate the execution of a previously quoted route. Returns the API call needed to begin — the user must sign and submit each transaction themselves.

**Arguments:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `routeId` | string | The `routeId` from `find_best_route` output |
| `signerAddress` | string | The wallet address that will sign the transactions |

**Returns:** Instructions for calling `POST /execute` with the required ECDSA signature.

**Important:** Orbit never signs anything. This tool returns the unsigned transaction payloads. The user signs in their own wallet (MetaMask, Freighter, etc.).

**Example prompt:**
> "Execute route f4a2b1c3 for my address 0xABCD..."

---

### `check_transfer_status`

Check the live status of a transfer that's in progress.

**Arguments:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `executionId` | string | The `executionId` returned by `execute_transfer` |

**Returns:** Current status, step-by-step breakdown, and any errors.

**Example output:**
```
Transfer status: BRIDGING
Route: base → stellar
Asset: 500 USDC

Steps:
  Step 1: completed (tx: 0x4f8a2b1c...)
  Step 2: bridging — waiting for Wormhole Guardian attestation
```

---

## MCP Resources

Orbit exposes browseable resources that AI agents can inspect before making tool calls:

| URI | Contents |
|-----|----------|
| `orbit://chains` | All supported chains with IDs, native assets, average bridge times |
| `orbit://assets` | Bridgeable assets with contract addresses per chain |
| `orbit://protocols` | Bridge protocols with safety scores, fee structures, supported chains |
| `orbit://protocols/{protocol}/stats` | Live TVL and 24h volume for a specific protocol |

---

## Design Guidelines for Agent Authors

If you are building an agent that uses Orbit MCP tools, follow these principles:

### 1. Always quote before executing

Call `find_best_route` first. Never call `execute_transfer` with a hardcoded route — prices and liquidity change. Quotes expire in 30 seconds.

### 2. Show risk to the user before executing

If `risk.overallScore < 75` or `risk.warnings` is non-empty, surface those to the user and ask for confirmation before proceeding with `execute_transfer`.

### 3. Never auto-execute without explicit user confirmation

Orbit is moving real money. Always confirm the route, cost, destination, and expected output with the user before calling `execute_transfer`.

```
Agent: "I found a route: 500 USDC from Base → Stellar via Wormhole.
        Cost: $1.80. You'll receive 498.20 USDC. Risk score: 87/100.
        Shall I proceed?"
User:  "Yes."
Agent: → calls execute_transfer
```

### 4. Handle the signing step explicitly

After `execute_transfer`, the user must sign and submit transactions in their wallet. The agent should:
1. Explain what the user needs to sign
2. Wait for the user to confirm they've submitted
3. Then call `check_transfer_status` to track progress

### 5. Use SSE for long-running transfers

For Wormhole transfers (2–10 minutes), instruct the user to connect to `GET /stream/status/:executionId` for live updates rather than repeatedly calling `check_transfer_status`.

---

## Prompt Templates

These prompts load Orbit's system context into Claude before a conversation:

### Bridge assistant (`orbit_bridge_assistant`)

Pre-loaded into Claude's context when the user opens an Orbit-focused conversation. Covers:
- Supported chains and assets
- Fee structures per protocol
- When to prefer Stellar vs EVM routes
- Security model (non-custodial)

### Risk advisor (`orbit_risk_advisor`)

Specialised prompt for risk analysis. Covers:
- Bridge incident history
- Liquidity health interpretation
- Large amount considerations (>$10k, >$100k thresholds)
- Refund and recovery procedures

---

## Example Conversations

### Simple bridge

```
User:  "I want to move 500 USDC from Base to my Stellar wallet"
Agent: → find_best_route(base, stellar, USDC, USDC, "500")
       "I found 3 routes. The recommended route is via Wormhole:
        - Cost: $1.80 total (gas + bridge fees)
        - Time: ~2 minutes
        - Safety score: 87/100 — no warnings
        - You'll receive 498.20 USDC on Stellar
        
        Shall I proceed with this route?"
User:  "Yes"
Agent: → execute_transfer(routeId, signerAddress)
       "To execute, please sign this transaction in MetaMask:
        [displays unsigned tx details]
        Once you've submitted, I'll track the transfer for you."
User:  "Done, I signed it"
Agent: → check_transfer_status(executionId)
       "Transfer is in progress — Wormhole Guardians are attesting.
        I'll update you when it arrives on Stellar (~90s remaining)."
```

### Risk check before large transfer

```
User:  "Is it safe to bridge $200k USDC from Ethereum to Stellar?"
Agent: → check_bridge_risk(ethereum, stellar, "200000", "USDC")
       "Risk assessment for $200k USDC via Wormhole:
        
        ⚠️ Moderate risk (76/100)
        - Wormhole had a major exploit in 2022 (fully reimbursed)
        - At this amount, request a liquidity check first
        - Recommendation: consider splitting into 4×$50k transfers
          to reduce exposure per transaction
        
        Would you like me to find routes for smaller amounts instead?"
```
