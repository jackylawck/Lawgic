// web-frontend/src/engines/tentsVariants.ts
import { PuzzleEntity } from '../generated';

export interface CellCoord {
  r: number;
  c: number;
}

export interface ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal';
  readonly displayNameZh: string;
  readonly displayNameEn: string;
  getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[];
  // 兼顧舊版呼叫 hasCollision 與新版 hasTentCollision
  hasCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  hasTentCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  getRequiredTentsPerTree(tree: CellCoord): number;
  generateWpfAnswerKey(solutionTents: CellCoord[], rows: number, cols: number): string;
}

/**
 * 經典正交帳篷規則：帳篷必須在樹木上下左右 4 格，帳篷間 8 向（包含對角）互不接觸
 */
export class StandardTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'standard';
  readonly displayNameZh: string = '經典正交帳篷';
  readonly displayNameEn: string = 'Classic Orthogonal';

  getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[] {
    return [
      [-1, 0], [1, 0], [0, -1], [0, 1]
    ]
      .map(([dr, dc]) => ({ r: tree.r + dr, c: tree.c + dc }))
      .filter((p) => p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols);
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

  /**
   * WPF 標準答案鍵：每行第一頂帳篷所在的 1-based 欄號；第 10 欄記為 '0'，若整行無帳篷記為 '-'
   */
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
 * 全向對角帳篷變體：帳篷可置於樹木 8 鄰格；但帳篷與帳篷之間僅允許對角接觸，正交嚴禁相碰
 */
export class DiagonalTentsStrategy implements ITentsRuleStrategy {
  readonly variantName: 'standard' | 'diagonal' = 'diagonal';
  readonly displayNameZh: string = '全向對角帳篷';
  readonly displayNameEn: string = 'Diagonal Allowed';

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
    const orthogonalDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, dc] of orthogonalDirs) {
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
    return new StandardTentsStrategy().generateWpfAnswerKey(solutionTents, rows, cols);
  }
}

/**
 * 健壯的謎題跨平台傳輸文字編解碼器 (URL-Safe / WPF Competition Format)
 */
export class TentsInterchangeCodec {
  public static exportToText(puzzle: PuzzleEntity): string {
    const spec = (puzzle.puzzle || puzzle) as any;
    const variant = spec.variant || 'standard';
    const rows = spec.rows || 0;
    const cols = spec.cols || 0;

    const treeStr = (spec.trees || [])
      .map((t: any) => (Array.isArray(t) ? `${t[0]},${t[1]}` : `${t.r},${t.c}`))
      .join(';');
    const rowStr = (spec.rowCounts || spec.rowClues || []).join(',');
    const colStr = (spec.colCounts || spec.colClues || []).join(',');

    return `TENTS_V2|${rows}x${cols}|${variant}|T=${treeStr}|R=${rowStr}|C=${colStr}`;
  }

  public static importFromText(text: string): {
    rows: number;
    cols: number;
    variant: 'standard' | 'diagonal';
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

      const treeSegment = parts[3].replace(/^T=/, '');
      const trees: CellCoord[] = treeSegment.length > 0
        ? treeSegment.split(';').map((pair) => {
            const [r, c] = pair.split(',').map((n) => parseInt(n, 10));
            return { r, c };
          })
        : [];

      const rowSegment = parts[4].replace(/^R=/, '');
      const rowCounts = rowSegment.length > 0
        ? rowSegment.split(',').map((n) => parseInt(n, 10))
        : [];

      const colSegment = parts[5].replace(/^C=/, '');
      const colCounts = colSegment.length > 0
        ? colSegment.split(',').map((n) => parseInt(n, 10))
        : [];

      if (rowCounts.length !== rows || colCounts.length !== cols) return null;

      return { rows, cols, variant, trees, rowCounts, colCounts };
    } catch {
      return null;
    }
  }
}

const STORAGE_KEY = 'logicore_saved_puzzles_v2';

/**
 * 具備容量防護與自動精簡的本地題庫管理器
 */
export class LocalPuzzleLibrary {
  public static savePuzzle(puzzle: PuzzleEntity): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: any[] = raw ? JSON.parse(raw) : [];

      // 補回 cognitiveLoad 解決 TS2741，並補齊相容欄位
      const compactSnapshot: PuzzleEntity = {
        id: puzzle.id,
        category: puzzle.category,
        engine_type: puzzle.engine_type,
        tier: puzzle.tier,
        checksum: puzzle.checksum,
        puzzle: {
          rows: (puzzle.puzzle as any).rows,
          cols: (puzzle.puzzle as any).cols,
          trees: (puzzle.puzzle as any).trees,
          rowCounts: (puzzle.puzzle as any).rowCounts,
          colCounts: (puzzle.puzzle as any).colCounts,
          rowClues: (puzzle.puzzle as any).rowClues || (puzzle.puzzle as any).rowCounts,
          colClues: (puzzle.puzzle as any).colClues || (puzzle.puzzle as any).colCounts,
          variant: (puzzle.puzzle as any).variant || 'standard',
          seed: (puzzle.puzzle as any).seed,
        } as any,
        solution: puzzle.solution,
        metrics: puzzle.metrics,
        cognitiveLoad: puzzle.cognitiveLoad || {
          spatial: 0.8,
          numeric: 0.5,
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

      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 40)));
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
