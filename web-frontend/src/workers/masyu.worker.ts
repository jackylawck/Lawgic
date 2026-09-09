// web-frontend/src/workers/masyu.worker.ts
import { MasyuCoreEngine, TierKey, PuzzleEntity, DynamicFlowTuning } from '../engines/masyuCore';

interface WorkerRequest {
  action: 'produce_single' | 'produce_batch';
  tier: TierKey;
  batchSize?: number;
  seed?: number;
  flowTuning?: DynamicFlowTuning;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { action, tier, batchSize = 1, seed, flowTuning } = e.data;

  if (action === 'produce_single') {
    const puzzle = MasyuCoreEngine.produceSinglePuzzle(tier, seed, flowTuning);
    self.postMessage({ status: 'ok', type: 'single', puzzle });
  } else if (action === 'produce_batch') {
    const puzzles: PuzzleEntity[] = [];
    let currentSeed = seed !== undefined ? seed : Math.floor(Math.random() * 0x7fffffff);
    for (let i = 0; i < batchSize; i++) {
      const p = MasyuCoreEngine.produceSinglePuzzle(tier, currentSeed, flowTuning);
      puzzles.push(p);
      currentSeed = (currentSeed + 7919) >>> 0;
    }
    self.postMessage({ status: 'ok', type: 'batch', tier, puzzles });
  }
};
