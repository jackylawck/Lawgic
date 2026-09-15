import { useState, useRef, useEffect, useCallback } from 'react';
import type { TierKey, PuzzleEntity } from '../generated';
import type { TaskRequest, TaskResponse } from '../workers/puzzleTaskRunner.worker';

interface ResolverMapEntry {
  resolve: (p: PuzzleEntity) => void;
  reject: (e: Error) => void;
}

export function usePuzzleGenerator() {
  const [loading, setLoading] = useState<boolean>(false);
  const workerRef = useRef<Worker | null>(null);
  const taskMapRef = useRef<Map<string, ResolverMapEntry>>(new Map());
  const activeTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/puzzleTaskRunner.worker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<TaskResponse>) => {
      const { taskId, ok, data, error } = e.data;
      const resolver = taskMapRef.current.get(taskId);

      if (resolver) {
        taskMapRef.current.delete(taskId);
        if (ok && data) {
          resolver.resolve(data);
        } else {
          resolver.reject(new Error(error || 'UNKNOWN_TASK_ERROR'));
        }
      }

      if (activeTaskIdRef.current === taskId) {
        setLoading(false);
      }
    };

    worker.onerror = (errEvent) => {
      const currentActive = activeTaskIdRef.current;
      if (currentActive) {
        const resolver = taskMapRef.current.get(currentActive);
        if (resolver) {
          taskMapRef.current.delete(currentActive);
          resolver.reject(new Error(`Worker fatal runtime failure: ${errEvent.message}`));
        }
      }
      setLoading(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      taskMapRef.current.clear();
      activeTaskIdRef.current = null;
    };
  }, []);

  const generatePuzzle = useCallback(
    (engine: 'slitherlink' | 'nonogram', tier: TierKey, seed?: number, timeoutMs: number = 2500): Promise<PuzzleEntity> => {
      return new Promise<PuzzleEntity>((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('ENGINE_WORKER_UNINITIALIZED'));
          return;
        }

        setLoading(true);
        const taskId = `${engine}_${tier}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        activeTaskIdRef.current = taskId;

        taskMapRef.current.set(taskId, {
          resolve: (data: PuzzleEntity) => {
            // 任務過期過濾機制：僅當完成任務為當前活動請求時才通知 UI
            if (activeTaskIdRef.current === taskId) {
              resolve(data);
            }
          },
          reject: (err: Error) => {
            if (activeTaskIdRef.current === taskId) {
              reject(err);
            }
          },
        });

        const req: TaskRequest = {
          taskId,
          payload: { engine, tier, seed, timeoutMs },
        };

        workerRef.current.postMessage(req);
      });
    },
    []
  );

  return { generatePuzzle, loading };
}
