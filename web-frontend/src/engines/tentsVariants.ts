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
  hasCollision(r: number, c: number, board: number[][], rows: number, cols: number): boolean;
  getRequiredTentsPerTree(tree: CellCoord): number;
  generateWpfAnswerKey(board: number[][], rows: number, cols: number): string;
}

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

  getRequiredTentsPerTree(): number {
    return 1;
  }

  generateWpfAnswerKey(board: number[][], rows: number, cols: number): string {
    let key = '';
    for (let r = 0; r < rows; r++) {
      let firstCol = -1;
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 1) {
          firstCol = c + 1;
          break;
        }
      }
      key += firstCol === -1 ? '0' : String(firstCol % 10);
    }
    return key;
  }
}

export class DiagonalTentsStrategy extends StandardTentsStrategy {
  override readonly variantName: 'standard' | 'diagonal' = 'diagonal';
  override readonly displayNameZh: string = '全向對角帳篷';
  override readonly displayNameEn: string = 'Diagonal Allowed';

  override getAvailableCampNeighbors(tree: CellCoord, rows: number, cols: number): CellCoord[] {
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
}

export class TentsInterchangeCodec {
  public static exportToText(puzzle: PuzzleEntity): string {
    const spec = (puzzle.puzzle || puzzle) as any;
    const variant = spec.variant || 'standard';
    const treeStr = (spec.trees || [])
      .map((t: any) => (Array.isArray(t) ? `${t[0]},${t[1]}` : `${t.r},${t.c}`))
      .join(';');
    const rowStr = (spec.rowCounts || spec.rowClues || []).join(',');
    const colStr = (spec.colCounts || spec.colClues || []).join(',');
    return `TENTS:${spec.rows}x${spec.cols}:${variant}:T[${treeStr}]:R[${rowStr}]:C[${colStr}]`;
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
      const parts = text.trim().split(':');
      if (parts[0] !== 'TENTS') return null;
      const [rows, cols] = parts[1].split('x').map(Number);
      const variant = (parts[2] === 'diagonal' ? 'diagonal' : 'standard') as 'standard' | 'diagonal';

      const treeMatch = parts[3].match(/T\[(.*)\]/);
      const rowMatch = parts[4].match(/R\[(.*)\]/);
      const colMatch = parts[5].match(/C\[(.*)\]/);

      if (!treeMatch || !rowMatch || !colMatch) return null;

      const trees: CellCoord[] = treeMatch[1]
        ? treeMatch[1].split(';').map((pair) => {
            const [r, c] = pair.split(',').map(Number);
            return { r, c };
          })
        : [];

      const rowCounts = rowMatch[1].split(',').map(Number);
      const colCounts = colMatch[1].split(',').map(Number);

      return { rows, cols, variant, trees, rowCounts, colCounts };
    } catch {
      return null;
    }
  }
}

const STORAGE_KEY = 'lawgic_saved_puzzles_v1';

export class LocalPuzzleLibrary {
  public static savePuzzle(puzzle: PuzzleEntity): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list: PuzzleEntity[] = raw ? JSON.parse(raw) : [];
      if (!list.some((p) => p.id === puzzle.id)) {
        list.unshift(puzzle);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 50)));
      }
      return true;
    } catch {
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
}
