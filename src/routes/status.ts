import type { Context } from 'hono';
import { Executor } from '@orbit-bridge/executor';

const executor = new Executor();

export async function statusHandler(c: Context) {
  const { id } = c.req.param();
  const state = executor.getState(id);

  if (!state) {
    return c.json({ error: 'Execution not found', code: 'NOT_FOUND', status: 404 }, 404);
  }

  return c.json({
    executionId: state.executionId,
    status:      state.status,
    steps:       state.steps,
    updatedAt:   state.updatedAt,
    completedAt: state.completedAt,
    error:       state.error,
  });
}
