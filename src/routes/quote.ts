import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { RouteAggregator } from '@orbit-bridge/core';

const schema = z.object({
  fromChain:  z.string(),
  toChain:    z.string(),
  fromAsset:  z.string(),
  toAsset:    z.string(),
  amount:     z.string(),
  slippage:   z.number().min(0).max(50).optional(),
});

const aggregator = new RouteAggregator();

export const quoteHandler = [
  zValidator('json', schema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as z.infer<typeof schema>;

    const result = await aggregator.findRoutes({
      fromChain:          body.fromChain as import('@orbit-bridge/core').Chain,
      toChain:            body.toChain as import('@orbit-bridge/core').Chain,
      fromAsset:          body.fromAsset,
      toAsset:            body.toAsset,
      amount:             body.amount,
      slippageTolerance:  body.slippage,
    });

    return c.json(result);
  },
];
