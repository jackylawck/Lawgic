// web-frontend/src/hooks/useMazeWorker.ts
import { useState, useRef, useCallback, useEffect } from 'react';
import { PuzzleEntity, TierKey } from '../generated';
import { StrategyPersona } from '../engines/mazeGenerator';
import { MazeWorkerMessage } from '../workers/maze.worker';

interface UseMazeWorkerReturn {
  generatePuzzle: (tier: TierKey, personaBias?: StrategyPersona, seed?: number) => Promise<PuzzleEntity>;
  isGenerating: boolean;
  progress: number;
  error: string | null;
  cancelGeneration: () => void;
}

export const useMazeWorker = (): UseMazeWorkerReturn => {
  const workerRef = useRef<Worker | null>(null);
  const activeRequestId = useRef<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const terminateCurrentWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    activeRequestId.current = null;
    setIsGenerating(false);
  }, []);

  useEffect(() => {
    return () => {
      terminateCurrentWorker();
    };
  }, [terminateCurrentWorker]);

  const generatePuzzle = useCallback(
    (tier: TierKey, personaBias?: StrategyPersona, seed?: number): Promise<PuzzleEntity> => {
      terminateCurrentWorker();

      return new Promise<PuzzleEntity>((resolve, reject) => {
        const reqId = `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        activeRequestId.current = reqId;

        setIsGenerating(true);
        setProgress(0);
        setError(null);

        // 依賴 Vite / Webpack 5 標準 Web Worker 語法
        const worker = new Worker(new URL('../workers/maze.worker.ts', import.meta.url), {
          type: 'module',
        });
        workerRef.current = worker;

        const timeoutTimer = setTimeout(() => {
          if (activeRequestId.current === reqId) {
            terminateCurrentWorker();
            const timeoutErr = 'Puzzle generation timed out (exceeded budget limit).';
            setError(timeoutErr);
            reject(new Error(timeoutErr));
          }
        }, 15000); // 15 秒硬保護

        worker.onmessage = (e: MessageEvent<MazeWorkerMessage>) => {
          const msg = e.data;
          if (!msg || msg.id !== reqId) return;

          if (msg.type === 'PROGRESS') {
            setProgress(Math.round(msg.progress * 100));
          } else if (msg.type === 'SUCCESS') {
            clearTimeout(timeoutTimer);
            terminateCurrentWorker();
            resolve(msg.puzzleEntity);
          } else if (msg.type === 'ERROR') {
            clearTimeout(timeoutTimer);
            terminateCurrentWorker();
            setError(msg.error);
            reject(new Error(msg.error));
          }
        };

        worker.onerror = (err) => {
          clearTimeout(timeoutTimer);
          terminateCurrentWorker();
          const genericErr = err.message || 'Worker thread execution error.';
          setError(genericErr);
          reject(new Error(genericErr));
        };

        worker.postMessage({
          type: 'GENERATE',
          id: reqId,
          tier,
          personaBias,
          seed,
        });
      });
    },
    [terminateCurrentWorker]
  );

  return {
    generatePuzzle,
    isGenerating,
    progress,
    error,
    cancelGeneration: terminateCurrentWorker,
  };
};
