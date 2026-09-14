// web-frontend/src/workers/maze.worker.ts
import { WebMazeGenerator } from '../engines/mazeGenerator';
import { TierKey } from '../generated';

export interface MazeWorkerRequest {
  id: string;
  tier: TierKey;
  seed?: number;
}

export interface MazeWorkerResponse {
  id: string;
  puzzleEntity: any;
  error?: string;
}

self.onmessage = (e: MessageEvent<MazeWorkerRequest>) => {
  const { id, tier, seed } = e.data;
  try {
    const puzzleEntity = WebMazeGenerator.generate(tier, undefined, seed);
    self.postMessage({ id, puzzleEntity } as MazeWorkerResponse);
  } catch (err: any) {
    self.postMessage({ id, puzzleEntity: null, error: err?.message || 'Worker execution failed' } as MazeWorkerResponse);
  }
};
