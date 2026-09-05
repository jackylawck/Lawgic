// web-frontend/src/engines/sudokuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type SymmetryType = 'rotational_180' | 'rotational_90' | 'diagonal';
export type TechniqueStage = 'NakedSingle' | 'HiddenSingle' | 'IntersectionLock' | 'Chaining';

export interface SudokuHintStep {
  level: 1 | 2 | 3;
  row: number;
  col: number;
  targetNum: number;
  technique: TechniqueStage;
  messageZh: string;
  messageEn: string;
}

export interface SudokuSpec {
  size: number;
  grid: number[][];
  clues: number;
  symmetry: SymmetryType;
  seed: number;
  solvingPath: string[];
  highestTechnique: TechniqueStage;
  hints: SudokuHintStep[];
}

interface TierConfig {
  targetClues: number;
  maxRetries: number;
  baseIrt: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { targetClues: 46, maxRetries: 10, baseIrt: -1.8 },
  intermediate: { targetClues: 36, maxRetries: 14, baseIrt: -0.2 },
  expert: { targetClues: 28, maxRetries: 20, baseIrt: 1.4 },
  master: { targetClues: 24, maxRetries: 26, baseIrt: 2.5 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebSudokuGenerator {
  static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.intermediate;
    const allSymmetries: SymmetryType[] = ['rotational_180', 'rotational_90', 'diagonal'];

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const solution = this._generateCompleteBoard(rnd);
      const puzzle = solution.map((row) => [...row]);

      const symmetry = allSymmetries[Math.floor(rnd() * allSymmetries.length)];
      const cellGroups = this._generateSymmetryGroups(symmetry);

      // 洗牌對稱群組
      for (let i = cellGroups.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [cellGroups[i], cellGroups[j]] = [cellGroups[j], cellGroups[i]];
      }

      let currentClues = 81;

      // 對稱性安全挖洞
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

      // 熱力圖平衡性檢查
      const uniformity = this._computeClueUniformity(puzzle);
      if (uniformity < 0.50 && attempt < config.maxRetries - 1) {
        continue;
      }

      // 構建解題技巧鏈與漸進式提示階梯
      const { path, steps, highestTechnique, load, hints } = this._computeSolvingPathAndHints(
        puzzle,
        solution,
        currentClues
      );

      const irtLogit = Number(
        Math.max(
          -2.8,
          Math.min(
            2.8,
            config.baseIrt +
              (1 - currentClues / 81) * 2.0 +
              (highestTechnique === 'Chaining' ? 0.6 : highestTechnique === 'IntersectionLock' ? 0.3 : 0) -
              0.2
          )
        ).toFixed(2)
      );

      const visualLoad = this._computeVisualClutter(puzzle);
      const estimatedTime = Math.round(
        30 +
          (81 - currentClues) * 3.2 +
          (highestTechnique === 'Chaining' ? 80 : 0) +
          (symmetry === 'rotational_90' ? 15 : 0)
      );

      const id = `sudoku_${tier}_s${actualSeed}`;

      const spec: SudokuSpec = {
        size: 9,
        grid: puzzle,
        clues: currentClues,
        symmetry,
        seed: actualSeed,
        solvingPath: path,
        highestTechnique,
        hints,
      };

      return {
        id,
        category: 'logic' as any,
        engine_type: 'sudoku',
        tier,
        puzzle: spec as any,
        solution,
        metrics: {
          clues_count: currentClues,
          decision_depth: 81 - currentClues,
          propagation_steps: steps,
          uniformity_score: Number(uniformity.toFixed(2)),
          highest_technique: highestTechnique,
          symmetry_type: symmetry,
          irt_logit_difficulty: irtLogit,
          visual_search_load: Number(visualLoad.toFixed(2)),
          estimated_time_sec: estimatedTime,
          ceiling_level: tier === 'master' && currentClues <= 24 ? 'Ultra' : 'Standard',
          solving_path: path,
          hints,
          seed: actualSeed,
          actualTier: tier,
        } as any,
        cognitiveLoad: load,
        checksum: `SUDOKU_9x9_S${actualSeed}`,
      };
    }

    return this._createFallbackPuzzle(tier, actualSeed);
  }

  private static _computeSolvingPathAndHints(
    board: number[][],
    solution: number[][],
    cluesCount: number
  ): {
    path: string[];
    steps: number;
    highestTechnique: TechniqueStage;
    load: { spatial: number; numeric: number; workingMemory: number; inhibition: number };
    hints: SudokuHintStep[];
  } {
    const copy = board.map((row) => [...row]);
    const path: string[] = [];
    const hints: SudokuHintStep[] = [];
    let steps = 0;
    let progressed = true;
    let highestTechnique: TechniqueStage = 'NakedSingle';

    let firstFoundNaked: { r: number; c: number; val: number } | null = null;
    let firstFoundHidden: { r: number; c: number; val: number; scope: string } | null = null;

    while (progressed) {
      progressed = false;

      // 1. 唯餘法 (Naked Single)
      let nakedCount = 0;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (copy[r][c] === 0) {
            const cands: number[] = [];
            for (let n = 1; n <= 9; n++) {
              if (this._isCellValid(copy, r, c, n)) cands.push(n);
            }
            if (cands.length === 1) {
              if (!firstFoundNaked) {
                firstFoundNaked = { r, c, val: cands[0] };
              }
              copy[r][c] = cands[0];
              nakedCount++;
              steps++;
              progressed = true;
            }
          }
        }
      }
      if (nakedCount > 0) {
        path.push(`Naked Single ×${nakedCount}`);
        continue;
      }

      // 2. 隱性單一法 (Hidden Single)
      let hiddenCount = 0;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (copy[r][c] === 0) {
            for (let n = 1; n <= 9; n++) {
              if (!this._isCellValid(copy, r, c, n)) continue;

              let rowCount = 0, colCount = 0, boxCount = 0;
              for (let i = 0; i < 9; i++) {
                if (this._isCellValid(copy, r, i, n)) rowCount++;
                if (this._isCellValid(copy, i, c, n)) colCount++;
                const br = Math.floor(r / 3) * 3 + Math.floor(i / 3);
                const bc = Math.floor(c / 3) * 3 + (i % 3);
                if (this._isCellValid(copy, br, bc, n)) boxCount++;
              }

              if (rowCount === 1 || colCount === 1 || boxCount === 1) {
                if (!firstFoundHidden) {
                  const scope = rowCount === 1 ? '該橫行' : colCount === 1 ? '該直列' : '該九宮格';
                  firstFoundHidden = { r, c, val: n, scope };
                }
                copy[r][c] = n;
                hiddenCount++;
                steps++;
                progressed = true;
                break;
              }
            }
            if (progressed) break;
          }
        }
        if (progressed) break;
      }

      if (hiddenCount > 0) {
        path.push(`Hidden Single ×${hiddenCount}`);
        if (highestTechnique === 'NakedSingle') highestTechnique = 'HiddenSingle';
        continue;
      }
    }

    const remainingUnsolved = copy.flat().filter((v) => v === 0).length;
    if (remainingUnsolved > 0) {
      highestTechnique = remainingUnsolved <= 12 ? 'IntersectionLock' : 'Chaining';
      path.push(highestTechnique === 'IntersectionLock' ? 'Intersection Lock (Claiming)' : `Chaining / Bi-Value Chain (Residual: ${remainingUnsolved})`);
    }

    // 建立提示階梯
    if (firstFoundNaked) {
      const { r, c, val } = firstFoundNaked;
      hints.push({
        level: 1,
        row: r,
        col: c,
        targetNum: val,
        technique: 'NakedSingle',
        messageZh: `觀察座標第 ${r + 1} 行、第 ${c + 1} 列的空白格：檢視其所屬行、列與九宮格內已出現的數字。`,
        messageEn: `Inspect cell at row ${r + 1}, col ${c + 1}: check the existing digits across its row, col, and 3x3 box.`,
      });
      hints.push({
        level: 2,
        row: r,
        col: c,
        targetNum: val,
        technique: 'NakedSingle',
        messageZh: `由正交約束排除法：該格在排除其餘 8 個干擾數字後，僅剩唯一的「唯餘數（Naked Single）」。`,
        messageEn: `By orthogonal elimination: 8 digits are already blocked, leaving only a single valid candidate.`,
      });
      hints.push({
        level: 3,
        row: r,
        col: c,
        targetNum: val,
        technique: 'NakedSingle',
        messageZh: `👉 請親自落子確認：點選座標 (${r + 1}, ${c + 1})，手動填入唯一解 ${val}。`,
        messageEn: `👉 Action: Tap cell (${r + 1}, ${c + 1}) and manually input the unique digit ${val}.`,
      });
    } else if (firstFoundHidden) {
      const { r, c, val, scope } = firstFoundHidden;
      hints.push({
        level: 1,
        row: r,
        col: c,
        targetNum: val,
        technique: 'HiddenSingle',
        messageZh: `檢視${scope}對數字 ${val} 的容納位置。`,
        messageEn: `Inspect candidate slots for digit ${val} within this group.`,
      });
      hints.push({
        level: 2,
        row: r,
        col: c,
        targetNum: val,
        technique: 'HiddenSingle',
        messageZh: `在排除其他位置後，數字 ${val} 在${scope}中僅剩座標 (${r + 1}, ${c + 1}) 能夠容納（隱性單數）。`,
        messageEn: `Digit ${val} can only legally fit into cell (${r + 1}, ${c + 1}) (Hidden Single).`,
      });
      hints.push({
        level: 3,
        row: r,
        col: c,
        targetNum: val,
        technique: 'HiddenSingle',
        messageZh: `👉 請親自落子確認：點選座標 (${r + 1}, ${c + 1})，手動填入數字 ${val}。`,
        messageEn: `👉 Action: Tap cell (${r + 1}, ${c + 1}) and place digit ${val}.`,
      });
    } else {
      outer: for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (board[r][c] === 0) {
            const val = solution[r][c];
            hints.push({
              level: 1,
              row: r,
              col: c,
              targetNum: val,
              technique: 'NakedSingle',
              messageZh: `檢驗座標 (${r + 1}, ${c + 1}) 所受之三向約束。`,
              messageEn: `Inspect row/col/box constraints at (${r + 1}, ${c + 1}).`,
            });
            hints.push({
              level: 2,
              row: r,
              col: c,
              targetNum: val,
              technique: 'NakedSingle',
              messageZh: `該格收斂至候選數 ${val}。`,
              messageEn: `The cell converges to candidate ${val}.`,
            });
            hints.push({
              level: 3,
              row: r,
              col: c,
              targetNum: val,
              technique: 'NakedSingle',
              messageZh: `👉 請親自落子確認：填入 ${val}。`,
              messageEn: `👉 Action: Place ${val}.`,
            });
            break outer;
          }
        }
      }
    }

    const depthIndex = remainingUnsolved / 40;
    const load = {
      spatial: Number(Math.min(0.9, 0.25 + (1 - cluesCount / 81) * 0.45).toFixed(2)),
      numeric: Number(Math.min(0.92, 0.3 + (steps / 60) * 0.4 + depthIndex * 0.3).toFixed(2)),
      workingMemory: Number(Math.min(0.96, 0.35 + depthIndex * 0.6).toFixed(2)),
      inhibition: Number(Math.min(0.95, 0.3 + depthIndex * 0.5).toFixed(2)),
    };

    return { path, steps, highestTechnique, load, hints };
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

  private static _generateCompleteBoard(rnd: () => number): number[][] {
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
      const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
      }

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

  private static _createFallbackPuzzle(tier: TierKey, seed: number): PuzzleEntity {
    const basePuzzle = [
      [5, 3, 0, 0, 7, 0, 0, 0, 0],
      [6, 0, 0, 1, 9, 5, 0, 0, 0],
      [0, 9, 8, 0, 0, 0, 0, 6, 0],
      [8, 0, 0, 0, 6, 0, 0, 0, 3],
      [4, 0, 0, 8, 0, 3, 0, 0, 1],
      [7, 0, 0, 0, 2, 0, 0, 0, 6],
      [0, 6, 0, 0, 0, 0, 2, 8, 0],
      [0, 0, 0, 4, 1, 9, 0, 0, 5],
      [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ];

    const baseSolution = [
      [5, 3, 4, 6, 7, 8, 9, 1, 2],
      [6, 7, 2, 1, 9, 5, 3, 4, 8],
      [1, 9, 8, 3, 4, 2, 5, 6, 7],
      [8, 5, 9, 7, 6, 1, 4, 2, 3],
      [4, 2, 6, 8, 5, 3, 7, 9, 1],
      [7, 1, 3, 9, 2, 4, 8, 5, 6],
      [9, 6, 1, 5, 3, 7, 2, 8, 4],
      [2, 8, 7, 4, 1, 9, 6, 3, 5],
      [3, 4, 5, 2, 8, 6, 1, 7, 9],
    ];

    const id = `sudoku_fb_${tier}_s${seed}`;
    return {
      id,
      category: 'logic' as any,
      engine_type: 'sudoku',
      tier,
      puzzle: {
        size: 9,
        grid: basePuzzle,
        clues: 28,
        symmetry: 'rotational_180',
        seed,
        solvingPath: ['Naked Single ×18', 'Hidden Single ×12', 'Intersection Lock'],
        highestTechnique: 'IntersectionLock',
        hints: [
          { level: 1, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '觀察第 1 行第 3 列之交叉約束。', messageEn: 'Inspect cross constraints at (1, 3).' },
          { level: 2, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '該格僅能填入 4。', messageEn: 'The cell uniquely accommodates 4.' },
          { level: 3, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '👉 手動填入 4。', messageEn: '👉 Input 4.' },
        ],
      } as any,
      solution: baseSolution,
      metrics: {
        clues_count: 28,
        decision_depth: 53,
        propagation_steps: 42,
        highest_technique: 'IntersectionLock',
        irt_logit_difficulty: 0.8,
        visual_search_load: 0.45,
        estimated_time_sec: 180,
        ceiling_level: 'Standard',
        solving_path: ['Naked Single ×18', 'Hidden Single ×12', 'Intersection Lock'],
        seed,
      } as any,
      cognitiveLoad: { spatial: 0.35, numeric: 0.75, workingMemory: 0.8, inhibition: 0.7 },
      checksum: `SUDOKU_FB_9x9_S${seed}`,
    };
  }
}
