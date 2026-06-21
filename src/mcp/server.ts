import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { RouteAggregator } from '@orbit-bridge/core';
import { Executor } from '@orbit-bridge/executor';

const aggregator = new RouteAggregator();
const executor   = new Executor();

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name:    'orbit',
    version: '0.1.0',
  });

  // ── find_best_route ──────────────────────────────────────────────────────────
  server.tool(
    'find_best_route',
    'Find the best cross-chain routes for transferring an asset. Returns ranked options with cost, time, and risk scores.',
    {
      fromChain: z.string().describe('Source chain (e.g. base, ethereum, stellar)'),
      toChain:   z.string().describe('Destination chain'),
      fromAsset: z.string().describe('Asset to send (e.g. USDC)'),
      toAsset:   z.string().describe('Asset to receive (can be same as fromAsset)'),
      amount:    z.string().describe('Amount to transfer as a string (e.g. "500")'),
    },
    async ({ fromChain, toChain, fromAsset, toAsset, amount }) => {
      const result = await aggregator.findRoutes({
        fromChain:  fromChain as any,
        toChain:    toChain as any,
        fromAsset,
        toAsset,
        amount,
      });

      const top = result.routes.slice(0, 3);
      const summary = top.map((r, i) => (
        `Route ${i + 1} [${r.tags.join(', ') || 'option'}]\n` +
        `  Protocol: ${r.steps.map((s) => s.protocol).join(' → ')}\n` +
        `  Cost: $${r.estimatedCost.totalUSD}  Time: ${Math.ceil(r.estimatedTimeSeconds / 60)}m  Risk: ${r.risk.overallScore}/100\n` +
        `  You receive: ${r.toAmount} ${toAsset}\n` +
        (r.risk.warnings.length ? `  ⚠ ${r.risk.warnings[0]}\n` : '')
      )).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Found ${result.routes.length} routes for ${amount} ${fromAsset} from ${fromChain} → ${toChain}\n\n${summary}\n\nrequestId: ${result.requestId}`,
        }],
      };
    },
  );

  // ── estimate_bridge_cost ─────────────────────────────────────────────────────
  server.tool(
    'estimate_bridge_cost',
    'Estimate the total cost (gas + bridge fees + slippage) for a specific bridge route.',
    {
      fromChain: z.string(),
      toChain:   z.string(),
      fromAsset: z.string(),
      toAsset:   z.string(),
      amount:    z.string(),
    },
    async ({ fromChain, toChain, fromAsset, toAsset, amount }) => {
      const result = await aggregator.findRoutes({
        fromChain: fromChain as any,
        toChain:   toChain as any,
        fromAsset,
        toAsset,
        amount,
      });

      const cheapest = result.routes.find((r) => r.tags.includes('cheapest')) ?? result.routes[0];
      if (!cheapest) {
        return { content: [{ type: 'text', text: 'No routes found for this pair.' }] };
      }

      const { gasFeeUSD, bridgeFeeUSD, slippagePercent, totalUSD } = cheapest.estimatedCost;
      return {
        content: [{
          type: 'text',
          text: `Cost estimate for ${amount} ${fromAsset} (${fromChain} → ${toChain})\n` +
                `  Gas:          $${gasFeeUSD}\n` +
                `  Bridge fee:   $${bridgeFeeUSD}\n` +
                `  Slippage:     ${slippagePercent}%\n` +
                `  Total cost:   $${totalUSD}\n` +
                `  You receive:  ${cheapest.toAmount} ${toAsset}`,
        }],
      };
    },
  );

  // ── check_bridge_risk ────────────────────────────────────────────────────────
  server.tool(
    'check_bridge_risk',
    'Check the safety and risk score of a bridge route before executing.',
    {
      fromChain: z.string(),
      toChain:   z.string(),
      protocol:  z.string().optional().describe('Specific bridge protocol to check (optional)'),
      amount:    z.string(),
      asset:     z.string(),
    },
    async ({ fromChain, toChain, protocol, amount, asset }) => {
      const result = await aggregator.findRoutes({
        fromChain: fromChain as any,
        toChain:   toChain as any,
        fromAsset: asset,
        toAsset:   asset,
        amount,
        preferredProtocols: protocol ? [protocol as any] : undefined,
      });

      const safest = result.routes.find((r) => r.tags.includes('safest')) ?? result.routes[0];
      if (!safest) {
        return { content: [{ type: 'text', text: 'No routes found.' }] };
      }

      const r = safest.risk;
      const rating = r.overallScore >= 85 ? '✅ Safe' : r.overallScore >= 70 ? '⚠️ Moderate' : '🚨 High Risk';

      return {
        content: [{
          type: 'text',
          text: `Risk assessment: ${rating} (${r.overallScore}/100)\n\n` +
                `  Bridge safety:        ${r.bridgeSafetyScore}/100\n` +
                `  Liquidity:            ${r.liquidityScore}/100\n` +
                `  Protocol reliability: ${r.protocolReliabilityScore}/100\n` +
                `  Failure probability:  ${(r.failureProbability * 100).toFixed(2)}%\n` +
                (r.warnings.length ? `\nWarnings:\n${r.warnings.map((w) => `  • ${w}`).join('\n')}` : '\nNo warnings.'),
        }],
      };
    },
  );

  // ── execute_transfer ─────────────────────────────────────────────────────────
  server.tool(
    'execute_transfer',
    'Execute a cross-chain asset transfer using a previously found route.',
    {
      routeId:       z.string().describe('routeId from find_best_route response'),
      signerAddress: z.string().describe('Wallet address that will sign the transaction'),
    },
    async ({ routeId, signerAddress }) => {
      // In production, the full Route object is retrieved from a quote cache keyed by routeId.
      // For now return a clear instruction to use the API endpoint instead.
      return {
        content: [{
          type: 'text',
          text: `To execute route ${routeId}, call:\n\nPOST /execute\n{\n  "routeId": "${routeId}",\n  "signerAddress": "${signerAddress}"\n}\n\nThis will return an executionId you can track with check_transfer_status.`,
        }],
      };
    },
  );

  // ── check_transfer_status ────────────────────────────────────────────────────
  server.tool(
    'check_transfer_status',
    'Check the live status of a cross-chain transfer by execution ID.',
    {
      executionId: z.string().describe('executionId returned by execute_transfer'),
    },
    async ({ executionId }) => {
      const state = executor.getState(executionId);
      if (!state) {
        return { content: [{ type: 'text', text: `No execution found for id: ${executionId}` }] };
      }

      const stepLines = state.steps.map((s) =>
        `  Step ${s.stepId}: ${s.status}${s.srcTxHash ? ` (tx: ${s.srcTxHash.slice(0, 10)}...)` : ''}`,
      ).join('\n');

      return {
        content: [{
          type: 'text',
          text: `Transfer status: ${state.status.toUpperCase()}\n` +
                `Route: ${state.fromChain} → ${state.toChain}\n` +
                `Asset: ${state.fromAmount} ${state.fromAsset}\n\n` +
                `Steps:\n${stepLines}` +
                (state.error ? `\n\nError: ${state.error}` : ''),
        }],
      };
    },
  );

  return server;
}

export async function startMcpStdio(): Promise<void> {
  const server    = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Orbit MCP server running on stdio');
}
