// web-frontend/src/engines/sudokuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export class WebSudokuGenerator {
  /**
   * 生成具備 180° 旋轉對稱性、嚴格唯一解與動態認知測量指標的數獨
   */
  static generate(tier: TierKey): PuzzleEntity {
    // 依難度設定線索目標上限（成對挖洞，故偶數為主）
    const cluesConfig: Record<TierKey, { targetClues: number; maxPasses: number }> = {
      kids: { targetClues: 46, maxPasses: 20 },         // 兒童：提示豐富，單一邏輯
      intermediate: { targetClues: 36, maxPasses: 35 }, // 進階：適度分叉
      expert: { targetClues: 28, maxPasses: 50 },       // 專家：需深入候選數推導
      master: { targetClues: 24, maxPasses: 70 },       // 魔王：高階技巧，極限剪枝
    };

    const config = cluesConfig[tier] || cluesConfig.intermediate;
    const solution = this._generateCompleteBoard();
    const puzzle = solution.map((row) => [...row]);

    // 1. 建立 180° 中心旋轉對稱的坐標候選對 (r, c) 與 (8-r, 8-c)
    const symmetricPairs: [number, number, number, number][] = [];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 9; c++) {
        if (r === 4 && c > 4) break; // 避免中心行重疊
        symmetricPairs.push([r, c, 8 - r, 8 - c]);
      }
    }

    // Fisher-Yates 隨機洗牌對稱對
    for (let i = symmetricPairs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [symmetricPairs[i], symmetricPairs[j]] = [symmetricPairs[j], symmetricPairs[i]];
    }

    let currentClues = 81;

    // 2. 對稱挖洞演算法
    for (const [r1, c1, r2, c2] of symmetricPairs) {
      if (currentClues <= config.targetClues) break;

      const val1 = puzzle[r1][c1];
      const val2 = puzzle[r2][c2];

      // 嘗試同時挖空
      puzzle[r1][c1] = 0;
      puzzle[r2][c2] = 0;

      // 檢查是否維持嚴格唯一解
      if (this._countSolutions(puzzle) !== 1) {
        // 若破壞唯一解，還原盤面
        puzzle[r1][c1] = val1;
        puzzle[r2][c2] = val2;
      } else {
        currentClues -= (r1 === r2 && c1 === c2) ? 1 : 2;
      }
    }

    // 3. 動態心理測量特徵抽取 (動態計算認知負荷)
    const metricsAndLoad = this._evaluateCognitiveLoad(puzzle, tier);
    const id = `sudoku_${tier}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    return {
      id,
      category: ('logic' as any),
      engine_type: 'sudoku',
      tier,
      puzzle,
      solution,
      metrics: {
        clues_count: currentClues,
        decision_depth: 81 - currentClues,
        propagation_steps: metricsAndLoad.propagationSteps,
        candidate_entropy: metricsAndLoad.entropy,
      } as any,
      cognitiveLoad: metricsAndLoad.cognitiveLoad,
      checksum: `gen_sym_${id}`,
    };
  }

  /**
   * 隨機生成 9x9 完整合法終盤 (使用位元運算剪枝)
   */
  private static _generateCompleteBoard(): number[][] {
    const board: number[][] = Array.from({ length: 9 }, () => Array(9).fill(0));
    const rows = new Array(9).fill(0);
    const cols = new Array(9).fill(0);
    const boxes = new Array(9).fill(0);

    const fill = (r: number, c: number): boolean => {
      if (r === 9) return true;
      const nextR = c === 8 ? r + 1 : r;
      const nextC = c === 8 ? 0 : c + 1;
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

      const used = rows[r] | cols[c] | boxes[b];
      const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);

      for (const num of nums) {
        const mask = 1 << num;
        if (!(used & mask)) {
          board[r][c] = num;
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[b] |= mask;

          if (fill(nextR, nextC)) return true;

          board[r][c] = 0;
          rows[r] &= ~mask;
          cols[c] &= ~mask;
          boxes[b] &= ~mask;
        }
      }
      return false;
    };

    fill(0, 0);
    return board;
  }

  /**
   * 超快速位元運算唯一性計數器（解數量達 2 即提前截斷剪枝）
   */
  private static _countSolutions(board: number[][]): number {
    const rows = new Array(9).fill(0);
    const cols = new Array(9).fill(0);
    const boxes = new Array(9).fill(0);
    const emptyCells: [number, number][] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = board[r][c];
        if (val !== 0) {
          const mask = 1 << val;
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[Math.floor(r / 3) * 3 + Math.floor(c / 3)] |= mask;
        } else {
          emptyCells.push([r, c]);
        }
      }
    }

    let solutions = 0;

    const backtrack = (idx: number): void => {
      if (idx >= emptyCells.length) {
        solutions++;
        return;
      }

      const [r, c] = emptyCells[idx];
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      const used = rows[r] | cols[c] | boxes[b];

      for (let num = 1; num <= 9; num++) {
        const mask = 1 << num;
        if (!(used & mask)) {
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[b] |= mask;

          backtrack(idx + 1);

          rows[r] &= ~mask;
          cols[c] &= ~mask;
          boxes[b] &= ~mask;

          if (solutions >= 2) return; // 提前終止剪枝
        }
      }
    };

    backtrack(0);
    return solutions;
  }

  /**
   * 動態分析盤面候選數熵值與認知負荷向量
   */
  private static _evaluateCognitiveLoad(
    board: number[][],
    tier: TierKey
  ): {
    cognitiveLoad: { spatial: number; numeric: number; workingMemory: number; inhibition: number };
    propagationSteps: number;
    entropy: number;
  } {
    let emptyCount = 0;
    let totalCandidates = 0;
    let candidateCounts: number[] = [];

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          emptyCount++;
          let candidates = 0;
          for (let num = 1; num <= 9; num++) {
            if (this._isCellValid(board, r, c, num)) {
              candidates++;
            }
          }
          totalCandidates += candidates;
          candidateCounts.push(candidates);
        }
      }
    }

    const avgCandidates = emptyCount > 0 ? totalCandidates / emptyCount : 0;
    // 計算候選數分佈的方差熵（衡量盤面複雜度與歧義性）
    const variance =
      emptyCount > 0
        ? candidateCounts.reduce((acc, val) => acc + Math.pow(val - avgCandidates, 2), 0) / emptyCount
        : 0;

    // 動態映射至四維認知維度 (0.0 ~ 1.0)
    const workingMemory = Number(Math.min(0.98, Math.max(0.3, (avgCandidates - 1.8) / 3.2 + variance * 0.08)).toFixed(2));
    const inhibition = Number(Math.min(0.95, Math.max(0.35, 0.4 + variance * 0.12)).toFixed(2));
    const numeric = Number(Math.min(0.95, Math.max(0.25, 0.3 + (emptyCount / 81) * 0.6)).toFixed(2));
    const spatial = Number(Math.min(0.85, Math.max(0.2, 0.25 + (emptyCount / 81) * 0.4)).toFixed(2));

    return {
      cognitiveLoad: {
        spatial,
        numeric,
        workingMemory,
        inhibition,
      },
      propagationSteps: emptyCount * 3 + Math.round(variance * 10),
      entropy: Number(variance.toFixed(3)),
    };
  }

  private static _isCellValid(board: number[][], row: number, col: number, num: number): boolean {
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
}
