// web-frontend/src/engines/tentsVariants.ts
import { PuzzleEntity, TierKey } from '../generated';

export interface CellCoord {
  r: number;
  c: number;
}

export interface ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal';
  readonly displayNameZh: string;
  readonly displayNameEn: string;
  getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[];
  hasCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  getRequiredTentsPerTree(tree: CellCoord): number;
  generateWpfAnswerKey(solutionTents: CellCoord[], rows: number, cols: number): string;
}

/**
 * 經典正交帳篷規則：帳篷必須在樹木正交 4 鄰格，帳篷間 8 向（含對角）嚴禁相碰
 */
export class StandardTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'standard';
  readonly displayNameZh: string = '經典正交帳篷';
  readonly displayNameEn: string = 'Classic Orthogonal';

  private static readonly ORTH_DIRS: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];

  getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[] {
    const coords: CellCoord[] = [];
    for (const [dr, dc] of StandardTentsStrategy.ORTH_DIRS) {
      const nr = tree.r + dr;
      const nc = tree.c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        coords.push({ r: nr, c: nc });
      }
    }
    return coords;
  }

  hasCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 1) {
          return true;
        }
      }
    }
    return false;
  }

  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    return this.hasCollision(r, c, board, rows, cols);
  }

  getRequiredTentsPerTree(): number {
    return 1;
  }

  generateWpfAnswerKey(solutionTents: CellCoord[], rows: number, cols: number): string {
    let key = '';
    for (let r = 0; r < rows; r++) {
      const tentsInRow = solutionTents
        .filter((t) => t.r === r)
        .sort((a, b) => a.c - b.c);

      if (tentsInRow.length === 0) {
        key += '-';
      } else {
        const firstCol1Based = tentsInRow[0].c + 1;
        if (firstCol1Based <= 9) {
          key += String(firstCol1Based);
        } else if (firstCol1Based === 10) {
          key += '0';
        } else {
          key += String.fromCharCode(65 + (firstCol1Based - 11));
        }
      }
    }
    return key;
  }
}

/**
 * 全向對角帳篷變體：帳篷可置於樹木 8 鄰格；帳篷間僅允許對角接觸，正交嚴禁相碰
 */
export class DiagonalTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'diagonal';
  readonly displayNameZh: string = '全向對角帳篷';
  readonly displayNameEn: string = 'Diagonal Allowed';

  private static readonly ORTH_DIRS: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];

  getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[] {
    const coords: CellCoord[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = tree.r + dr;
        const nc = tree.c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          coords.push({ r: nr, c: nc });
        }
      }
    }
    return coords;
  }

  hasCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    for (const [dr, dc] of DiagonalTentsStrategy.ORTH_DIRS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc] === 1) {
        return true;
      }
    }
    return false;
  }

  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    return this.hasCollision(r, c, board, rows, cols);
  }

  getRequiredTentsPerTree(): number {
    return 1;
  }

  generateWpfAnswerKey(solutionTents: CellCoord[], rows: number, cols: number): string {
    return TentsStrategyFactory.get('standard').generateWpfAnswerKey(solutionTents, rows, cols);
  }
}

/**
 * 帳篷策略工廠單例
 */
export class TentsStrategyFactory {
  private static standard = new StandardTentsStrategy();
  private static diagonal = new DiagonalTentsStrategy();

  public static get(variant: 'standard' | 'diagonal' = 'standard'): ITentsRuleStrategy {
    return variant === 'diagonal' ? this.diagonal : this.standard;
  }
}

/**
 * 跨平台文字編解碼器 (相容 WPF/WPC 規格與自訂種子協議)
 */
export class TentsInterchangeCodec {
  public static exportToText(puzzle: PuzzleEntity): string {
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
    trees: CellCoord[];
    rowCounts: number[];
    colCounts: number[];
  } | null {
    try {
      const trimmed = text.trim();
      const parts = trimmed.split('|');
      if (parts.length < 6 || !parts[0].startsWith('TENTS')) return null;

      const [rStr, cStr] = parts[1].split('x');
      const rows = parseInt(rStr, 10);
      const cols = parseInt(cStr, 10);
      if (isNaN(rows) || isNaN(cols) || rows <= 0 || cols <= 0) return null;

      const variant = parts[2] === 'diagonal' ? 'diagonal' : 'standard';

      // 支援 V3 (含 tier 與 seed) 與舊版 V2
      let tier: TierKey = 'kids';
      let seed = 1000;
      let treePartIdx = 3;

      if (parts[0] === 'TENTS_V3') {
        tier = (parts[3] as TierKey) || 'kids';
        const seedPart = parts[4].replace(/^S=/, '');
        seed = parseInt(seedPart, 10) || 1000;
        treePartIdx = 5;
      }

      const treeSegment = parts[treePartIdx].replace(/^T=/, '');
      const trees: CellCoord[] = treeSegment.length > 0
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

const STORAGE_KEY = 'logicore_saved_tents_vault';

/**
 * 具有完整深度還原與容量配額防護的帳篷本地金庫
 */
export class LocalPuzzleLibrary {
  public static savePuzzle(puzzle: PuzzleEntity): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: PuzzleEntity[] = raw ? JSON.parse(raw) : [];

      const spec = puzzle.puzzle as any;
      const compactSnapshot: PuzzleEntity = {
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
          hintCascades: spec.hintCascades || [],
          solvingSteps: spec.solvingSteps || [],
          variant: spec.variant || 'standard',
          seed: spec.seed,
          tier: puzzle.tier,
        } as any,
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

  public static getSavedPuzzles(): PuzzleEntity[] {
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
      const list: PuzzleEntity[] = JSON.parse(raw);
      const filtered = list.filter((p) => p.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      return true;
    } catch {
      return false;
    }
  }
}
