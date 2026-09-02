// web-frontend/src/engines/sudokuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebSudokuGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    const cluesMap: Record<TierKey, number> = {
      kids: 46,
      intermediate: 36,
      expert: 28,
      master: 22,
    };

    const targetClues = cluesMap[tier] || 36;
    const solution = this._generateCompleteBoard();
    const puzzle = solution.map((row) => [...row]);

    const cells: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        cells.push([r, c]);
      }
    }

    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    let currentClues = 81;
    for (const [r, c] of cells) {
      if (currentClues <= targetClues) break;
      const backup = puzzle[r][c];
      puzzle[r][c] = 0;

      const testBoard = puzzle.map((row) => [...row]);
      if (this._countSolutions(testBoard) !== 1) {
        puzzle[r][c] = backup;
      } else {
        currentClues--;
      }
    }

    const id = `sudoku_${tier}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    return {
      id,
      category: ('logic' as any),
      engine_type: 'sudoku',
      tier,
      puzzle,
      solution,
      metrics: {
        decision_depth: 81 - currentClues,
        propagation_steps: 81,
      } as any,
      cognitiveLoad: {
        spatial: 0.3,
        numeric: tier === 'kids' ? 0.3 : tier === 'intermediate' ? 0.5 : tier === 'expert' ? 0.75 : 0.9,
        workingMemory: tier === 'kids' ? 0.4 : 0.8,
        inhibition: 0.6,
      },
      checksum: `gen_${id}`,
    };
  }

  private static _generateCompleteBoard(): number[][] {
    const board: number[][] = Array.from({ length: 9 }, () => Array(9).fill(0));
    this._solve(board);
    return board;
  }

  private static _solve(board: number[][]): boolean {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
          for (const num of numbers) {
            if (this._isValid(board, r, c, num)) {
              board[r][c] = num;
              if (this._solve(board)) return true;
              board[r][c] = 0;
            }
          }
          return false;
        }
      }
    }
    return true;
  }

  private static _isValid(board: number[][], row: number, col: number, num: number): boolean {
    for (let i = 0; i < 9; i++) {
      if (board[row][i] === num || board[i][col] === num) return false;
    }
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (board[boxRow + r][boxCol + c] === num) return false;
      }
    }
    return true;
  }

  private static _countSolutions(board: number[][], count = { total: 0 }): number {
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          for (let num = 1; num <= 9; num++) {
            if (this._isValid(board, r, c, num)) {
              board[r][c] = num;
              this._countSolutions(board, count);
              board[r][c] = 0;
              if (count.total >= 2) return count.total;
            }
          }
          return count.total;
        }
      }
    }
    count.total++;
    return count.total;
  }
}
