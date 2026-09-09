// ============================================================================
// LogicCore Tents WPC Industrial Master Engine & Variants
// File: web-frontend/src/engines/tentsVariants.ts
// Standards: WPC / Mensa Tier Certified (Aligned with tentsGenerator v3.0)
// ============================================================================

import { TentCoord, WebTentsGenerator } from './tentsGenerator';

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master' | 'legendary' | 'ultimate';

// ----------------------------------------------------------------------------
// 1. 規則策略與工廠（標準正交 vs 對角變體）
// ----------------------------------------------------------------------------

export interface ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal';
  readonly displayNameZh: string;
  readonly displayNameEn: string;
  getAvailableCampNeighbors(tree: TentCoord, rows: number, cols: number): TentCoord[];
  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  getRequiredTentsPerTree(): number;
  generateWpfAnswerKey(solutionTents: TentCoord[], rows: number, cols: number): string;
}

export class StandardTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'standard';
  readonly displayNameZh: string = '經典正交帳篷';
  readonly displayNameEn: string = 'Classic Orthogonal';

  private static readonly ORTH_DIRS: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];

  getAvailableCampNeighbors(tree: TentCoord, rows: number, cols: number): TentCoord[] {
    const coords: TentCoord[] = [];
    for (const [dr, dc] of StandardTentsStrategy.ORTH_DIRS) {
      const nr = tree.r + dr;
      const nc = tree.c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        coords.push({ r: nr, c: nc });
      }
    }
    return coords;
  }

  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    // 經典八向不相碰（包含對角線相碰即視為違規）
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          if (board[nr][nc] === 1) return true;
        }
      }
    }
    return false;
  }

  getRequiredTentsPerTree(): number {
    return 1;
  }

  generateWpfAnswerKey(solutionTents: TentCoord[], rows: number, cols: number): string {
    return WebTentsGenerator.computeWpfAnswerKey(rows, cols, solutionTents);
  }
}

export class DiagonalTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'diagonal';
  readonly displayNameZh: string = '全向對角帳篷';
  readonly displayNameEn: string = 'Diagonal Allowed';

  private static readonly ORTH_DIRS: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];
  private static readonly EIGHT_DIRS: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  getAvailableCampNeighbors(tree: TentCoord, rows: number, cols: number): TentCoord[] {
    const coords: TentCoord[] = [];
    for (const [dr, dc] of DiagonalTentsStrategy.EIGHT_DIRS) {
      const nr = tree.r + dr;
      const nc = tree.c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        coords.push({ r: nr, c: nc });
      }
    }
    return coords;
  }

  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    // 對角變體規則：帳篷之間僅在正交四向互斥，對角允許接觸
    for (const [dr, dc] of DiagonalTentsStrategy.ORTH_DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        if (board[nr][nc] === 1) return true;
      }
    }
    return false;
  }

  getRequiredTentsPerTree(): number {
    return 1;
  }

  generateWpfAnswerKey(solutionTents: TentCoord[], rows: number, cols: number): string {
    return WebTentsGenerator.computeWpfAnswerKey(rows, cols, solutionTents);
  }
}

export class TentsStrategyFactory {
  private static standard = new StandardTentsStrategy();
  private static diagonal = new DiagonalTentsStrategy();

  public static get(variant: 'standard' | 'diagonal' = 'standard'): ITentsRuleStrategy {
    return variant === 'diagonal' ? this.diagonal : this.standard;
  }
}

// ----------------------------------------------------------------------------
// 2. 賽事規格題目編解碼器 (Interchange Codec)
// ----------------------------------------------------------------------------

export class TentsInterchangeCodec {
  public static exportToText(puzzle: any): string {
    const spec = (puzzle.puzzle || puzzle) as any;
    const variant = spec.variant || 'standard';
    const rows = spec.rows || 0;
    const cols = spec.cols || 0;
    const seed = spec.seed ?? 1000;
    const tier = puzzle.tier || 'kids';

    const treeStr = (spec.trees || [])
      .map((t: any) => (Array.isArray(t) ? `${t[0]},${t[1]}` : `${t.r},${t.c}`))
      .join(';');
    const rowStr = (spec.rowCounts || spec.rowClues || []).join(',');
    const colStr = (spec.colCounts || spec.colClues || []).join(',');

    return `TENTS_V3|${rows}x${cols}|${variant}|${tier}|S=${seed}|T=${treeStr}|R=${rowStr}|C=${colStr}`;
  }

  public static importFromText(text: string): {
    rows: number;
    cols: number;
    variant: 'standard' | 'diagonal';
    tier: TierKey;
    seed: number;
    trees: TentCoord[];
    rowCounts: number[];
    colCounts: number[];
  } | null {
    try {
      const trimmed = text.trim();
      const parts = trimmed.split('|');
      if (parts.length < 4 || !parts[0].startsWith('TENTS')) return null;

      const [rStr, cStr] = parts[1].split('x');
      const rows = parseInt(rStr, 10);
      const cols = parseInt(cStr, 10);
      if (isNaN(rows) || isNaN(cols) || rows <= 0 || cols <= 0) return null;

      const variant = parts[2] === 'diagonal' ? 'diagonal' : 'standard';

      const isV3 = parts[0] === 'TENTS_V3';
      let tier: TierKey = 'kids';
      let seed = 1000;
      let treePartIdx = 3;

      if (isV3 && parts.length >= 6) {
        tier = (parts[3] as TierKey) || 'kids';
        const seedPart = parts[4].replace(/^S=/, '');
        seed = parseInt(seedPart, 10) || 1000;
        treePartIdx = 5;
      }

      if (parts.length <= treePartIdx + 2) return null;

      const treeSegment = parts[treePartIdx].replace(/^T=/, '');
      const trees: TentCoord[] = treeSegment.length > 0
        ? treeSegment.split(';').map((pair) => {
            const [r, c] = pair.split(',').map((n) => parseInt(n, 10));
            return { r, c };
          })
        : [];

      const rowSegment = parts[treePartIdx + 1].replace(/^R=/, '');
      const rowCounts = rowSegment.length > 0
        ? rowSegment.split(',').map((n) => parseInt(n, 10))
        : [];

      const colSegment = parts[treePartIdx + 2].replace(/^C=/, '');
      const colCounts = colSegment.length > 0
        ? colSegment.split(',').map((n) => parseInt(n, 10))
        : [];

      if (rowCounts.length !== rows || colCounts.length !== cols) return null;

      return { rows, cols, variant, tier, seed, trees, rowCounts, colCounts };
    } catch {
      return null;
    }
  }
}

// ----------------------------------------------------------------------------
// 3. 賽事金庫與題目本地存儲庫 (Local Vault)
// ----------------------------------------------------------------------------

const STORAGE_KEY = 'logicore_saved_tents_vault';

export class LocalPuzzleLibrary {
  public static savePuzzle(puzzle: any): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: any[] = raw ? JSON.parse(raw) : [];
      const spec = (puzzle.puzzle || puzzle) as any;

      const compactSnapshot: any = {
        id: puzzle.id,
        category: 'spatial_logic',
        engine_type: 'tents',
        tier: puzzle.tier,
        checksum: puzzle.checksum,
        puzzle: {
          rows: spec.rows,
          cols: spec.cols,
          trees: spec.trees,
          rowCounts: spec.rowCounts,
          colCounts: spec.colCounts,
          rowClues: spec.rowClues || spec.rowCounts,
          colClues: spec.colClues || spec.colCounts,
          solutionTents: spec.solutionTents,
          treeTentPairs: spec.treeTentPairs,
          solvingSteps: spec.solvingSteps || [],
          variant: spec.variant || 'standard',
          seed: spec.seed,
          tier: puzzle.tier,
          wpfAnswerKey: spec.wpfAnswerKey,
        },
        solution: puzzle.solution,
        metrics: puzzle.metrics,
        cognitiveLoad: puzzle.cognitiveLoad || {
          spatial: 0.8,
          numeric: 0.4,
          workingMemory: 0.6,
          inhibition: 0.8,
        },
      };

      const existingIndex = list.findIndex((p) => p.id === puzzle.id);
      if (existingIndex !== -1) {
        list[existingIndex] = compactSnapshot;
      } else {
        list.unshift(compactSnapshot);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
      return true;
    } catch (e) {
      console.warn('LocalStorage quota exceeded or unavailable:', e);
      return false;
    }
  }

  public static getSavedPuzzles(): any[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public static removePuzzle(id: string): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const list: any[] = JSON.parse(raw);
      const filtered = list.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch {
      return false;
    }
  }
}
