// web-frontend/src/workers/maze.worker.ts
import { WebMazeGenerator, StrategyPersona } from '../engines/mazeGenerator';
import { TierKey, PuzzleEntity } from '../generated';

export type MazeWorkerAction =
  | { type: 'GENERATE'; id: string; tier: TierKey; personaBias?: StrategyPersona; seed?: number }
  | { type: 'ABORT'; id: string };

export type MazeWorkerMessage =
  | { type: 'PROGRESS'; id: string; progress: number }
  | { type: 'SUCCESS'; id: string; puzzleEntity: PuzzleEntity }
  | { type: 'ERROR'; id: string; error: string };

self.onmessage = (e: MessageEvent<MazeWorkerAction>) => {
  const data = e.data;
  if (!data || data.type !== 'GENERATE') return;

  const { id, tier, personaBias, seed } = data;

  try {
    const puzzleEntity = WebMazeGenerator.generate(
      tier,
      personaBias,
      seed,
      (progress: number) => {
        self.postMessage({ type: 'PROGRESS', id, progress } as MazeWorkerMessage);
      }
    );

    self.postMessage({ type: 'SUCCESS', id, puzzleEntity } as MazeWorkerMessage);
  } catch (err: any) {
    self.postMessage({
      type: 'ERROR',
      id,
      error: err?.message || 'Maze generation failed unexpectedly.',
    } as MazeWorkerMessage);
  }
};
