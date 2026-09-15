import { WebSlitherlinkGenerator, SlitherlinkExecutionContext } from '../engines/slitherlinkGenerator';
import { WebNonogramGenerator, NonogramExecutionContext } from '../engines/nonogramGenerator';
import type { TierKey, PuzzleEntity } from '../generated';

export type TaskPayload =
  | { engine: 'slitherlink'; tier: TierKey; seed?: number; timeoutMs?: number }
  | { engine: 'nonogram'; tier: TierKey; seed?: number; timeoutMs?: number };

export interface TaskRequest {
  taskId: string;
  payload: TaskPayload;
}

export interface TaskResponse {
  taskId: string;
  ok: boolean;
  data?: PuzzleEntity;
  error?: string;
}

self.onmessage = async (e: MessageEvent<TaskRequest>) => {
  const { taskId, payload } = e.data;
  const timeoutMs = payload.timeoutMs ?? 2500;

  try {
    let result: PuzzleEntity;

    switch (payload.engine) {
      case 'slitherlink': {
        const ctx = new SlitherlinkExecutionContext(512, timeoutMs);
        result = WebSlitherlinkGenerator.generate(payload.tier, payload.seed, ctx);
        break;
      }

      case 'nonogram': {
        const ctx = new NonogramExecutionContext(20, timeoutMs);
        result = WebNonogramGenerator.generate(payload.tier, payload.seed, ctx);
        break;
      }

      default:
        throw new Error(`Unsupported engine type: ${(payload as any).engine}`);
    }

    const response: TaskResponse = {
      taskId,
      ok: true,
      data: result,
    };
    self.postMessage(response);
  } catch (err: any) {
    const response: TaskResponse = {
      taskId,
      ok: false,
      error: err?.message || String(err),
    };
    self.postMessage(response);
  }
};
