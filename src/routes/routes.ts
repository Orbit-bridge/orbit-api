import type { Context } from 'hono';

export async function routesHandler(c: Context) {
  const { from, to, asset, amount } = c.req.query();

  if (!from || !to || !asset || !amount) {
    return c.json(
      { error: 'Missing required query params: from, to, asset, amount', code: 'BAD_REQUEST', status: 400 },
      400,
    );
  }

  // Convenience GET wrapper — delegates to POST /quote logic
  const { RouteAggregator } = await import('@orbit-bridge/core');
  const aggregator = new RouteAggregator();

  const result = await aggregator.findRoutes({
    fromChain:  from as import('@orbit-bridge/core').Chain,
    toChain:    to as import('@orbit-bridge/core').Chain,
    fromAsset:  asset,
    toAsset:    asset,
    amount,
  });

  return c.json(result);
}
