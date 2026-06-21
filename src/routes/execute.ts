import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Executor } from '@orbit-bridge/executor';

const schema = z.object({
  route:         z.object({ routeId: z.string() }).passthrough(),
  signerAddress: z.string(),
  slippage:      z.number().optional(),
});

const executor = new Executor();

export const executeHandler = [
  zValidator('json', schema),
  async (c: Context) => {
    const body = c.req.valid('json' as never) as z.infer<typeof schema>;

    const state = await executor.execute({
      route:             body.route as import('@orbit-bridge/executor').ExecutionState['fromChain'] extends never ? never : any,
      signerAddress:     body.signerAddress,
      slippageTolerance: body.slippage,
    });

    return c.json({
      executionId: state.executionId,
      status:      state.status,
      routeId:     state.routeId,
    }, 202);
  },
];
