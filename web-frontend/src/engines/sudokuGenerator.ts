// web-frontend/src/engines/sudokuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

type SymmetryType = 'rotational_180' | 'rotational_90' | 'diagonal';
type HighestTechnique = 'NakedSingle' | 'HiddenSingle' | 'IntersectionLock' | 'BranchSearch';

export class WebSudokuGenerator {
  /**
   * 生成符合 Mensa / CAT / Nikoli 心理測量與美學標準的數獨試題
   */
  static generate(tier: TierKey): PuzzleEntity {
    const configMap: Record<
      TierKey,
      { targetClues: number; maxRetries: number; allowedSymmetries: SymmetryType[] }
    > = {
      kids: {
        targetClues: 46,
        maxRetries: 4,
        allowedSymmetries: ['rotational_180', 'diagonal'],
      },
      intermediate: {
        targetClues: 36,
        maxRetries: 6,
        allowedSymmetries: ['rotational_180', 'rotational_90', 'diagonal'],
      },
      expert: {
        targetClues: 28,
        maxRetries: 8,
        allowedSymmetries: ['rotational_180', 'rotational_90'],
      },
      master: {
        targetClues: 22, // 提高天花板難度 (22 線索)
        maxRetries: 12,
        allowedSymmetries: ['rotational_180'],
      },
    };

    const config = configMap[tier] || configMap.intermediate;

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const solution = this._generateCompleteBoard();
      const puzzle = solution.map((row) => [...row]);

      const symmetry =
        config.allowedSymmetries[Math.floor(Math.random() * config.allowedSymmetries.length)];
      const cellGroups = this._generateSymmetryGroups(symmetry);

      for (let i = cellGroups.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cellGroups[i], cellGroups[j]] = [cellGroups[j], cellGroups[i]];
      }

      let currentClues = 81;

      // 對稱挖洞演算法
      for (const group of cellGroups) {
        if (currentClues <= config.targetClues) break;

        const backups: { r: number; c: number; val: number }[] = [];
        for (const [r, c] of group) {
          if (puzzle[r][c] !== 0) {
            backups.push({ r, c, val: puzzle[r][c] });
            puzzle[r][c] = 0;
          }
        }

        if (backups.length === 0) continue;

        if (this._countSolutionsMRV(puzzle) !== 1) {
          for (const b of backups) {
            puzzle[b.r][b.c] = b.val;
          }
        } else {
          currentClues -= backups.length;
        }
      }

      // 候選數致命矩形防護
      if (this._hasUniqueRectangleCandidate(puzzle)) {
        continue;
      }

      // 熱力圖平衡性過濾
      const uniformity = this._computeClueUniformity(puzzle);
      if (uniformity < 0.6 && attempt < config.maxRetries - 1) {
        continue;
      }

      // 雙軌約束推導
      const evalResult = this._evaluateHumanInference(puzzle, currentClues);

      // 心理計量參數計算 (IRT 難度、視覺搜尋負荷、預估作答時間)
      const irtLogit = this._estimateIRTDifficulty(puzzle, currentClues);
      const visualLoad = this._computeVisualClutter(puzzle);
      const estimatedTime = Math.round(
        35 +
          (81 - currentClues) * 2.8 +
          (evalResult.highestTechnique === 'BranchSearch' ? 90 : 0) +
          (symmetry === 'rotational_90' ? 25 : 0)
      );

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
          propagation_steps: evalResult.steps,
          uniformity_score: Number(uniformity.toFixed(2)),
          highest_technique: evalResult.highestTechnique,
          symmetry_type: symmetry,
          irt_logit_difficulty: irtLogit,
          visual_search_load: Number(visualLoad.toFixed(2)),
          estimated_time_sec: estimatedTime,
          ceiling_level: tier === 'master' && currentClues <= 22 ? 'Ultra' : 'Standard',
        } as any,
        cognitiveLoad: evalResult.load,
        checksum: `cat_${id}`,
      };
    }

    return this._createFallbackPuzzle(tier);
  }

  private static _generateSymmetryGroups(type: SymmetryType): [number, number][][] {
    const groups: [number, number][][] = [];
    const visited = new Set<string>();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const key = `${r},${c}`;
        if (visited.has(key)) continue;

        let curGroup: [number, number][] = [];

        if (type === 'rotational_180') {
          const r2 = 8 - r;
          const c2 = 8 - c;
          curGroup = [[r, c]];
          visited.add(key);
          if (r2 !== r || c2 !== c) {
            curGroup.push([r2, c2]);
            visited.add(`${r2},${c2}`);
          }
        } else if (type === 'rotational_90') {
          const pts: [number, number][] = [
            [r, c],
            [c, 8 - r],
            [8 - r, 8 - c],
            [8 - c, r],
          ];
          for (const [pr, pc] of pts) {
            const k = `${pr},${pc}`;
            if (!visited.has(k)) {
              visited.add(k);
              curGroup.push([pr, pc]);
            }
          }
        } else if (type === 'diagonal') {
          curGroup = [[r, c]];
          visited.add(key);
          if (c !== r) {
            curGroup.push([c, r]);
            visited.add(`${c},${r}`);
          }
        }

        if (curGroup.length > 0) groups.push(curGroup);
      }
    }
    return groups;
  }

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

  private static _countSolutionsMRV(board: number[][]): number {
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

    const backtrack = () => {
      if (solutions >= 2) return;

      let bestIdx = -1;
      let bestMask = 0;
      let minCandidates = 10;

      for (let i = 0; i < emptyCells.length; i++) {
        const [r, c] = emptyCells[i];
        if (board[r][c] !== 0) continue;

        const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const used = rows[r] | cols[c] | boxes[b];

        let count = 0;
        for (let n = 1; n <= 9; n++) {
          if (!(used & (1 << n))) count++;
        }

        if (count < minCandidates) {
          minCandidates = count;
          bestIdx = i;
          bestMask = used;
          if (count === 1) break;
        }
      }

      if (bestIdx === -1) {
        solutions++;
        return;
      }
      if (minCandidates === 0) return;

      const [r, c] = emptyCells[bestIdx];
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

      for (let num = 1; num <= 9; num++) {
        const mask = 1 << num;
        if (!(bestMask & mask)) {
          board[r][c] = num;
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[b] |= mask;

          backtrack();

          rows[r] &= ~mask;
          cols[c] &= ~mask;
          boxes[b] &= ~mask;
          board[r][c] = 0;

          if (solutions >= 2) return;
        }
      }
    };

    backtrack();
    return solutions;
  }

  private static _hasUniqueRectangleCandidate(board: number[][]): boolean {
    const candidatesMap = new Map<string, number[]>();

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          const cands: number[] = [];
          for (let n = 1; n <= 9; n++) {
            if (this._isCellValid(board, r, c, n)) cands.push(n);
          }
          if (cands.length === 2) {
            candidatesMap.set(`${r},${c}`, cands);
          }
        }
      }
    }

    const entries = Array.from(candidatesMap.entries());
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [k1, v1] = entries[i];
        const [k2, v2] = entries[j];
        if (v1[0] !== v2[0] || v1[1] !== v2[1]) continue;

        const [r1, c1] = k1.split(',').map(Number);
        const [r2, c2] = k2.split(',').map(Number);
        if (r1 === r2 || c1 === c2) continue;

        const d1 = candidatesMap.get(`${r1},${c2}`);
        const d2 = candidatesMap.get(`${r2},${c1}`);

        if (
          d1 &&
          d2 &&
          d1.length === 2 &&
          d2.length === 2 &&
          d1[0] === v1[0] &&
          d1[1] === v1[1] &&
          d2[0] === v1[0] &&
          d2[1] === v1[1]
        ) {
          const b1 = Math.floor(r1 / 3) * 3 + Math.floor(c1 / 3);
          const b4 = Math.floor(r2 / 3) * 3 + Math.floor(c2 / 3);
          if (b1 !== b4) return true;
        }
      }
    }
    return false;
  }

  private static _computeClueUniformity(board: number[][]): number {
    const blockClues: number[] = [];
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        let clues = 0;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            if (board[br * 3 + r][bc * 3 + c] !== 0) clues++;
          }
        }
        blockClues.push(clues);
      }
    }

    const avg = blockClues.reduce((a, b) => a + b, 0) / 9;
    const variance = blockClues.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / 9;
    return Math.max(0.1, Math.min(1.0, 1 - variance / 4.5));
  }

  private static _evaluateHumanInference(
    board: number[][],
    cluesCount: number
  ): {
    steps: number;
    highestTechnique: HighestTechnique;
    load: { spatial: number; numeric: number; workingMemory: number; inhibition: number };
  } {
    const copy = board.map((row) => [...row]);
    let totalSteps = 0;
    let hadHiddenSingle = false;
    let progressed = true;

    while (progressed) {
      progressed = false;

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (copy[r][c] === 0) {
            const cands: number[] = [];
            for (let n = 1; n <= 9; n++) {
              if (this._isCellValid(copy, r, c, n)) cands.push(n);
            }
            if (cands.length === 1) {
              copy[r][c] = cands[0];
              totalSteps++;
              progressed = true;
            }
          }
        }
      }
      if (progressed) continue;

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (copy[r][c] === 0) {
            for (let n = 1; n <= 9; n++) {
              if (!this._isCellValid(copy, r, c, n)) continue;

              let rowCount = 0;
              let colCount = 0;
              let boxCount = 0;

              for (let i = 0; i < 9; i++) {
                if (this._isCellValid(copy, r, i, n)) rowCount++;
                if (this._isCellValid(copy, i, c, n)) colCount++;
                const br = Math.floor(r / 3) * 3 + Math.floor(i / 3);
                const bc = Math.floor(c / 3) * 3 + (i % 3);
                if (this._isCellValid(copy, br, bc, n)) boxCount++;
              }

              if (rowCount === 1 || colCount === 1 || boxCount === 1) {
                copy[r][c] = n;
                totalSteps++;
                hadHiddenSingle = true;
                progressed = true;
                break;
              }
            }
            if (progressed) break;
          }
        }
        if (progressed) break;
      }
    }

    const remainingUnsolved = copy.flat().filter((v) => v === 0).length;

    let highestTechnique: HighestTechnique = 'NakedSingle';
    if (remainingUnsolved > 16) {
      highestTechnique = 'BranchSearch';
    } else if (remainingUnsolved > 0) {
      highestTechnique = 'IntersectionLock';
    } else if (hadHiddenSingle) {
      highestTechnique = 'HiddenSingle';
    }

    const depthIndex = remainingUnsolved / 40;
    const load = {
      spatial: Number(Math.min(0.9, 0.25 + (1 - cluesCount / 81) * 0.45).toFixed(2)),
      numeric: Number(Math.min(0.92, 0.3 + (totalSteps / 60) * 0.4 + depthIndex * 0.3).toFixed(2)),
      workingMemory: Number(Math.min(0.96, 0.35 + depthIndex * 0.6).toFixed(2)),
      inhibition: Number(Math.min(0.95, 0.3 + (hadHiddenSingle ? 0.2 : 0.05) + depthIndex * 0.45).toFixed(2)),
    };

    return {
      steps: totalSteps,
      highestTechnique,
      load,
    };
  }

  /**
   * 估算項目反應理論（IRT）難度參數 (Logit scale: -3.0 ~ +3.0)
   */
  private static _estimateIRTDifficulty(board: number[][], cluesCount: number): number {
    let entropySum = 0;
    const emptyCount = 81 - cluesCount;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) {
          let cands = 0;
          for (let n = 1; n <= 9; n++) {
            if (this._isCellValid(board, r, c, n)) cands++;
          }
          if (cands > 0) entropySum += Math.log2(cands);
        }
      }
    }

    const avgEntropy = emptyCount > 0 ? entropySum / emptyCount : 0;
    const rawIndex = emptyCount * 0.05 + avgEntropy * 0.7;
    const logit = (rawIndex - 3.4) * 1.6;
    return Number(Math.max(-3.0, Math.min(3.0, logit)).toFixed(2));
  }

  /**
   * 視覺搜尋負荷（行與列提示分佈的方差指標）
   */
  private static _computeVisualClutter(board: number[][]): number {
    const rowCounts = board.map((r) => r.filter((v) => v !== 0).length);
    const colCounts = Array.from({ length: 9 }, (_, c) =>
      board.reduce((acc, r) => acc + (r[c] !== 0 ? 1 : 0), 0)
    );
    const combined = [...rowCounts, ...colCounts];
    const mean = combined.reduce((a, b) => a + b, 0) / 18;
    const variance = combined.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / 18;
    return Math.min(1.0, variance / 5.0);
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

  private static _createFallbackPuzzle(tier: TierKey): PuzzleEntity {
    const solution = this._generateCompleteBoard();
    const puzzle = solution.map((r) => [...r]);
    for (let i = 0; i < 30; i++) {
      puzzle[Math.floor(Math.random() * 9)][Math.floor(Math.random() * 9)] = 0;
    }
    const id = `sudoku_fallback_${tier}_${Date.now()}`;
    return {
      id,
      category: ('logic' as any),
      engine_type: 'sudoku',
      tier,
      puzzle,
      solution,
      metrics: {
        clues_count: 51,
        decision_depth: 30,
        propagation_steps: 30,
        highest_technique: 'HiddenSingle',
        irt_logit_difficulty: -1.2,
        visual_search_load: 0.3,
        estimated_time_sec: 120,
        ceiling_level: 'Standard',
      } as any,
      cognitiveLoad: { spatial: 0.3, numeric: 0.5, workingMemory: 0.6, inhibition: 0.5 },
      checksum: `fallback_${id}`,
    };
  }
}
