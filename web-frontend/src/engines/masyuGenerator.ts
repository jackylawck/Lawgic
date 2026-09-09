// web-frontend/src/engines/masyuGenerator.ts
import { MasyuCoreEngine, PuzzleEntity, TierKey } from './masyuCore';

export * from './masyuCore';

export async function generateMasyuSignature(payload: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
    } catch {
      // 降級處理
    }
  }
  return 'MASYU-' + Math.random().toString(36).substring(2, 10).toUpperCase();
}

export class WebMasyuGenerator {
  public static makeEdgeKey(r1: number, c1: number, r2: number, c2: number): string {
    return MasyuCoreEngine.makeEdgeKey(r1, c1, r2, c2);
  }

  public static inBounds(r: number, c: number, size: number): boolean {
    return MasyuCoreEngine.inBounds(r, c, size);
  }

  public static validateSolution(grid: import('./masyuCore').PearlType[][], edges: Set<string>, size: number): boolean {
    return MasyuCoreEngine.validateSolution(grid, edges, size);
  }

  public static getWpcHint(grid: import('./masyuCore').PearlType[][], edges: Set<string>, size: number) {
    return MasyuCoreEngine.getWpcHint(grid, edges, size);
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    return MasyuCoreEngine.produceSinglePuzzle(tier, inputSeed);
  }
}
