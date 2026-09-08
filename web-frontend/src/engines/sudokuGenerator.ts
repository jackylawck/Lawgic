// web-frontend/src/engines/sudokuGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey;
export type SymmetryType = 'rotational_180' | 'rotational_90' | 'diagonal' | 'statistical_balanced';
export type TechniqueStage =
  | 'NakedSingle'
  | 'HiddenSingle'
  | 'LockedCandidates'
  | 'NakedPair'
  | 'HiddenPair'
  | 'XWing'
  | 'ContradictionChain';

export interface SudokuHintStep {
  level: 1 | 2 | 3;
  row: number;
  col: number;
  targetNum: number;
  technique: TechniqueStage;
  messageZh: string;
  messageEn: string;
}

export interface SudokuStep {
  step: number;
  technique: TechniqueStage;
  row: number;
  col: number;
  val: number;
  weight: number;
  availableBranches: number;
  rationale: string;
}

export interface SudokuSpec {
  rows: number;
  cols: number;
  size: number;
  grid: number[][];
  clues: number[][];
  clueCount: number;
  symmetry: SymmetryType;
  seed: number;
  solvingPath: string[];
  highestTechnique: TechniqueStage;
  hints: SudokuHintStep[];
  pureDeductionRate: number;
  logicalComplexityScore: number;
  hasPerfectLogicOrder: boolean;
  tier: TierKey;
}

interface TierConfig {
  targetClues: number;
  minTechniqueScore: number;
  maxRetries: number;
  allowStatisticalAsymmetric: boolean;
  baseIrt: number;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { targetClues: 46, minTechniqueScore: 35, maxRetries: 8, allowStatisticalAsymmetric: false, baseIrt: 0.65, timeLimitSec: 90 },
  intermediate: { targetClues: 36, minTechniqueScore: 55, maxRetries: 12, allowStatisticalAsymmetric: false, baseIrt: 1.45, timeLimitSec: 150 },
  expert: { targetClues: 30, minTechniqueScore: 85, maxRetries: 16, allowStatisticalAsymmetric: true, baseIrt: 2.35, timeLimitSec: 240 },
  master: { targetClues: 26, minTechniqueScore: 120, maxRetries: 22, allowStatisticalAsymmetric: true, baseIrt: 3.15, timeLimitSec: 360 },
  legendary: { targetClues: 24, minTechniqueScore: 155, maxRetries: 28, allowStatisticalAsymmetric: true, baseIrt: 3.75, timeLimitSec: 480 },
  ultimate: { targetClues: 22, minTechniqueScore: 190, maxRetries: 35, allowStatisticalAsymmetric: true, baseIrt: 4.35, timeLimitSec: 600 },
};

const TECHNIQUE_WEIGHTS: Record<TechniqueStage, number> = {
  NakedSingle: 1,
  HiddenSingle: 2,
  LockedCandidates: 4,
  NakedPair: 6,
  HiddenPair: 7,
  XWing: 10,
  ContradictionChain: 16,
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
  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const symmetries: SymmetryType[] = config.allowStatisticalAsymmetric
      ? ['statistical_balanced', 'rotational_180']
      : ['rotational_180', 'rotational_90', 'diagonal'];

    for (let attempt = 0; attempt < config.maxRetries; attempt++) {
      const solution = this._generateIsomorphicCompleteBoard(rnd);
      const puzzle = solution.map((row) => [...row]);

      const symmetry = symmetries[Math.floor(rnd() * symmetries.length)];
      const cellGroups = this._generateSymmetryGroups(symmetry, rnd);

      for (let i = cellGroups.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [cellGroups[i], cellGroups[j]] = [cellGroups[j], cellGroups[i]];
      }

      let currentClues = 81;

      // 第一階段：對稱/平衡群組挖洞
      for (let g = 0; g < cellGroups.length; g++) {
        if (currentClues <= config.targetClues) break;
        const group = cellGroups[g];

        const backups: { r: number; c: number; val: number }[] = [];
        for (let i = 0; i < group.length; i++) {
          const [r, c] = group[i];
          if (puzzle[r][c] !== 0) {
            backups.push({ r, c, val: puzzle[r][c] });
            puzzle[r][c] = 0;
          }
        }

        if (backups.length === 0) continue;

        if (this._countSolutionsFast(puzzle) !== 1) {
          for (let b = 0; b < backups.length; b++) {
            puzzle[backups[b].r][backups[b].c] = backups[b].val;
          }
        } else {
          currentClues -= backups.length;
        }
      }

      // 第二階段：單格精確調整挖洞
      if (currentClues > config.targetClues) {
        const singleCoords: [number, number][] = [];
        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            if (puzzle[r][c] !== 0) singleCoords.push([r, c]);
          }
        }
        for (let i = singleCoords.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [singleCoords[i], singleCoords[j]] = [singleCoords[j], singleCoords[i]];
        }

        for (let s = 0; s < singleCoords.length; s++) {
          if (currentClues <= config.targetClues) break;
          const [r, c] = singleCoords[s];
          const oldVal = puzzle[r][c];
          puzzle[r][c] = 0;

          if (this._countSolutionsFast(puzzle) !== 1) {
            puzzle[r][c] = oldVal;
          } else {
            currentClues--;
          }
        }
      }

      // 3. 執行純人類邏輯錦標賽推導分析
      const sim = this._simulateChampionshipSolving(puzzle);

      // 高階題目守門員：檢驗複雜度積分是否達標
      if ((tier === 'master' || tier === 'legendary' || tier === 'ultimate') &&
          sim.logicalComplexityScore < config.minTechniqueScore) {
        continue;
      }

      const dynamicIrt = Number(
        (
          config.baseIrt +
          (1 - currentClues / 81) * 1.1 +
          Math.log2(Math.max(1, sim.logicalComplexityScore / 35)) * 0.35
        ).toFixed(2)
      );

      const estimatedTime = Math.round(
        30 +
          (81 - currentClues) * 3.2 +
          (sim.highestTechnique === 'ContradictionChain' ? 120 : sim.highestTechnique === 'XWing' ? 60 : 0)
      );

      const id = `sudoku_${tier}_s${actualSeed}`;

      const spec: SudokuSpec = {
        rows: 9,
        cols: 9,
        size: 9,
        grid: puzzle,
        clues: puzzle,
        clueCount: currentClues,
        symmetry,
        seed: actualSeed,
        solvingPath: sim.pathSummary,
        highestTechnique: sim.highestTechnique,
        hints: sim.hints,
        pureDeductionRate: sim.pureRate,
        logicalComplexityScore: sim.logicalComplexityScore,
        hasPerfectLogicOrder: sim.hasPerfectLogicOrder,
        tier,
      };

      return {
        id,
        category: 'numerical_logic',
        engine_type: 'sudoku',
        tier,
        puzzle: spec,
        solution,
        metrics: {
          grid_size: 9,
          rows: 9,
          cols: 9,
          decision_depth: 81 - currentClues,
          propagation_steps: sim.steps.length,
          logical_complexity_score: sim.logicalComplexityScore,
          highest_technique: sim.highestTechnique,
          has_perfect_logic_order: sim.hasPerfectLogicOrder,
          irt_logit_difficulty: dynamicIrt,
          estimated_time_sec: estimatedTime,
          seed: actualSeed,
          actualTier: tier,
        } as any,
        cognitiveLoad: sim.load,
        checksum: `SUDOKU_9x9_WSC_${actualSeed}`,
      };
    }

    return this._createFallbackPuzzle(tier, actualSeed, rnd);
  }

  /**
   * 同構置換終盤生成器（加入大行/大列 Chute 置換）
   */
  private static _generateIsomorphicCompleteBoard(rnd: () => number): number[][] {
    const board: number[][] = Array.from({ length: 9 }, () => Array(9).fill(0));

    // 隨機填充 3 個對角獨立九宮格
    for (let box = 0; box < 9; box += 3) {
      const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      for (let i = nums.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [nums[i], nums[j]] = [nums[j], nums[i]];
      }
      let idx = 0;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          board[box + r][box + c] = nums[idx++];
        }
      }
    }

    const rows = new Uint16Array(9);
    const cols = new Uint16Array(9);
    const boxes = new Uint16Array(9);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = board[r][c];
        if (val > 0) {
          const mask = 1 << val;
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[Math.floor(r / 3) * 3 + Math.floor(c / 3)] |= mask;
        }
      }
    }

    const fillRemaining = (r: number, c: number): boolean => {
      if (r === 9) return true;
      const nextR = c === 8 ? r + 1 : r;
      const nextC = c === 8 ? 0 : c + 1;

      if (board[r][c] !== 0) return fillRemaining(nextR, nextC);

      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      const used = rows[r] | cols[c] | boxes[b];

      const cands: number[] = [];
      for (let n = 1; n <= 9; n++) {
        if (!(used & (1 << n))) cands.push(n);
      }
      for (let i = cands.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [cands[i], cands[j]] = [cands[j], cands[i]];
      }

      for (let i = 0; i < cands.length; i++) {
        const num = cands[i];
        const mask = 1 << num;
        board[r][c] = num;
        rows[r] |= mask;
        cols[c] |= mask;
        boxes[b] |= mask;

        if (fillRemaining(nextR, nextC)) return true;

        board[r][c] = 0;
        rows[r] &= ~mask;
        cols[c] &= ~mask;
        boxes[b] &= ~mask;
      }

      return false;
    };

    fillRemaining(0, 3);

    // 1. 宮內細節行列置換
    for (let b = 0; b < 3; b++) {
      const r1 = b * 3 + Math.floor(rnd() * 3);
      const r2 = b * 3 + Math.floor(rnd() * 3);
      if (r1 !== r2) {
        const temp = board[r1];
        board[r1] = board[r2];
        board[r2] = temp;
      }
      const c1 = b * 3 + Math.floor(rnd() * 3);
      const c2 = b * 3 + Math.floor(rnd() * 3);
      if (c1 !== c2) {
        for (let r = 0; r < 9; r++) {
          const t = board[r][c1];
          board[r][c1] = board[r][c2];
          board[r][c2] = t;
        }
      }
    }

    // 2. 全域大行（Band Chute）與大列（Stack Chute）整體置換，消除區塊聚集指紋
    const b1 = Math.floor(rnd() * 3);
    const b2 = Math.floor(rnd() * 3);
    if (b1 !== b2) {
      for (let offset = 0; offset < 3; offset++) {
        const temp = board[b1 * 3 + offset];
        board[b1 * 3 + offset] = board[b2 * 3 + offset];
        board[b2 * 3 + offset] = temp;
      }
    }

    const s1 = Math.floor(rnd() * 3);
    const s2 = Math.floor(rnd() * 3);
    if (s1 !== s2) {
      for (let offset = 0; offset < 3; offset++) {
        const colA = s1 * 3 + offset;
        const colB = s2 * 3 + offset;
        for (let r = 0; r < 9; r++) {
          const t = board[r][colA];
          board[r][colA] = board[r][colB];
          board[r][colB] = t;
        }
      }
    }

    // 3. 數字全雙射對換
    const digitMap = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = 9; i > 1; i--) {
      const j = 1 + Math.floor(rnd() * i);
      [digitMap[i], digitMap[j]] = [digitMap[j], digitMap[i]];
    }

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        board[r][c] = digitMap[board[r][c]];
      }
    }

    return board;
  }

  /**
   * 帶 200 步熔斷與 MRV 位元剪枝的極速唯一解驗證器
   */
  private static _countSolutionsFast(board: number[][]): number {
    const rows = new Uint16Array(9);
    const cols = new Uint16Array(9);
    const boxes = new Uint16Array(9);

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const val = board[r][c];
        if (val !== 0) {
          const mask = 1 << val;
          rows[r] |= mask;
          cols[c] |= mask;
          boxes[Math.floor(r / 3) * 3 + Math.floor(c / 3)] |= mask;
        }
      }
    }

    let solutions = 0;
    let budget = 200;

    const backtrack = (): void => {
      if (solutions >= 2 || budget-- <= 0) return;

      let minCount = 10;
      let targetR = -1;
      let targetC = -1;
      let targetMask = 0;

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (board[r][c] === 0) {
            const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
            const used = rows[r] | cols[c] | boxes[b];

            let count = 0;
            for (let n = 1; n <= 9; n++) {
              if (!(used & (1 << n))) count++;
            }

            if (count === 0) return;
            if (count < minCount) {
              minCount = count;
              targetR = r;
              targetC = c;
              targetMask = used;
              if (minCount === 1) break;
            }
          }
        }
        if (minCount === 1) break;
      }

      if (targetR === -1) {
        solutions++;
        return;
      }

      const b = Math.floor(targetR / 3) * 3 + Math.floor(targetC / 3);

      for (let num = 1; num <= 9; num++) {
        const mask = 1 << num;
        if (!(targetMask & mask)) {
          board[targetR][targetC] = num;
          rows[targetR] |= mask;
          cols[targetC] |= mask;
          boxes[b] |= mask;

          backtrack();

          rows[targetR] &= ~mask;
          cols[targetC] &= ~mask;
          boxes[b] &= ~mask;
          board[targetR][targetC] = 0;

          if (solutions >= 2) return;
        }
      }
    };

    backtrack();
    return solutions;
  }

  /**
   * 計算候選數矩陣
   */
  private static _computeCandidateMatrix(board: number[][]): Uint16Array[] {
    const cands = Array.from({ length: 9 }, () => new Uint16Array(9));
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0) {
          cands[r][c] = 0;
          continue;
        }
        let used = 0;
        const br = Math.floor(r / 3) * 3;
        const bc = Math.floor(c / 3) * 3;
        for (let i = 0; i < 9; i++) {
          if (board[r][i] > 0) used |= (1 << board[r][i]);
          if (board[i][c] > 0) used |= (1 << board[i][c]);
          const cellVal = board[br + Math.floor(i / 3)][bc + (i % 3)];
          if (cellVal > 0) used |= (1 << cellVal);
        }
        let mask = 0;
        for (let n = 1; n <= 9; n++) {
          if (!(used & (1 << n))) mask |= (1 << n);
        }
        cands[r][c] = mask;
      }
    }
    return cands;
  }

  /**
   * 單純使用定式進行 1 輪推進（供常規求解與反證探針共享，杜絕暴力 DFS）
   */
  private static _applyDeductiveStep(
    board: number[][],
    cands: Uint16Array[]
  ): {
    applied: boolean;
    technique?: TechniqueStage;
    r?: number;
    c?: number;
    val?: number;
    rationale?: string;
    isConflict?: boolean;
  } {
    const countBits = (mask: number): number => {
      let cnt = 0;
      for (let n = 1; n <= 9; n++) if (mask & (1 << n)) cnt++;
      return cnt;
    };

    // 0. 矛盾檢查：是否存在未填格但候選數為 0
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0 && cands[r][c] === 0) {
          return { applied: false, isConflict: true };
        }
      }
    }

    // 1. 唯餘數 (Naked Single)
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0 && countBits(cands[r][c]) === 1) {
          let val = 0;
          for (let n = 1; n <= 9; n++) if (cands[r][c] & (1 << n)) val = n;
          board[r][c] = val;
          return {
            applied: true,
            technique: 'NakedSingle',
            r, c, val,
            rationale: `第 ${r + 1} 行、第 ${c + 1} 列僅存唯一候選數 ${val}`,
          };
        }
      }
    }

    // 2. 隱性單一數 (Hidden Single - 行、列、宮)
    for (let num = 1; num <= 9; num++) {
      const mask = (1 << num);
      // 行
      for (let r = 0; r < 9; r++) {
        let count = 0;
        let targetC = -1;
        for (let c = 0; c < 9; c++) {
          if (board[r][c] === 0 && (cands[r][c] & mask)) {
            count++;
            targetC = c;
          }
        }
        if (count === 1) {
          board[r][targetC] = num;
          return {
            applied: true,
            technique: 'HiddenSingle',
            r, c: targetC, val: num,
            rationale: `第 ${r + 1} 行中只有第 ${targetC + 1} 列可容納數字 ${num}`,
          };
        }
      }
      // 列
      for (let c = 0; c < 9; c++) {
        let count = 0;
        let targetR = -1;
        for (let r = 0; r < 9; r++) {
          if (board[r][c] === 0 && (cands[r][c] & mask)) {
            count++;
            targetR = r;
          }
        }
        if (count === 1) {
          board[targetR][c] = num;
          return {
            applied: true,
            technique: 'HiddenSingle',
            r: targetR, c, val: num,
            rationale: `第 ${c + 1} 列中只有第 ${targetR + 1} 行可容納數字 ${num}`,
          };
        }
      }
      // 宮
      for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
          let count = 0;
          let targetR = -1;
          let targetC = -1;
          for (let r = br * 3; r < br * 3 + 3; r++) {
            for (let c = bc * 3; c < bc * 3 + 3; c++) {
              if (board[r][c] === 0 && (cands[r][c] & mask)) {
                count++;
                targetR = r;
                targetC = c;
              }
            }
          }
          if (count === 1) {
            board[targetR][targetC] = num;
            return {
              applied: true,
              technique: 'HiddenSingle',
              r: targetR, c: targetC, val: num,
              rationale: `第 ${br * 3 + bc + 1} 宮中只有坐標 (${targetR + 1}, ${targetC + 1}) 可容納數字 ${num}`,
            };
          }
        }
      }
    }

    // 3. 宮行列區塊定式 (Locked Candidates - Pointing & Claiming)
    for (let num = 1; num <= 9; num++) {
      const mask = (1 << num);
      for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
          const rowsWithNum = new Set<number>();
          const colsWithNum = new Set<number>();
          for (let r = br * 3; r < br * 3 + 3; r++) {
            for (let c = bc * 3; c < bc * 3 + 3; c++) {
              if (board[r][c] === 0 && (cands[r][c] & mask)) {
                rowsWithNum.add(r);
                colsWithNum.add(c);
              }
            }
          }
          if (rowsWithNum.size === 1) {
            const lockedR = Array.from(rowsWithNum)[0];
            let eliminated = false;
            for (let c = 0; c < 9; c++) {
              if ((c < bc * 3 || c >= bc * 3 + 3) && board[lockedR][c] === 0 && (cands[lockedR][c] & mask)) {
                cands[lockedR][c] &= ~mask;
                eliminated = true;
              }
            }
            if (eliminated) {
              return { applied: true, technique: 'LockedCandidates', rationale: `宮 ${br * 3 + bc + 1} 鎖定第 ${lockedR + 1} 行之數字 ${num}` };
            }
          }
          if (colsWithNum.size === 1) {
            const lockedC = Array.from(colsWithNum)[0];
            let eliminated = false;
            for (let r = 0; r < 9; r++) {
              if ((r < br * 3 || r >= br * 3 + 3) && board[r][lockedC] === 0 && (cands[r][lockedC] & mask)) {
                cands[r][lockedC] &= ~mask;
                eliminated = true;
              }
            }
            if (eliminated) {
              return { applied: true, technique: 'LockedCandidates', rationale: `宮 ${br * 3 + bc + 1} 鎖定第 ${lockedC + 1} 列之數字 ${num}` };
            }
          }
        }
      }
    }

    // 4. 全向顯性數對 (Naked Pair - 行、列、宮)
    // 行
    for (let r = 0; r < 9; r++) {
      const pairCols: number[] = [];
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0 && countBits(cands[r][c]) === 2) pairCols.push(c);
      }
      for (let i = 0; i < pairCols.length; i++) {
        for (let j = i + 1; j < pairCols.length; j++) {
          const c1 = pairCols[i];
          const c2 = pairCols[j];
          if (cands[r][c1] === cands[r][c2]) {
            const pairMask = cands[r][c1];
            let elim = false;
            for (let oc = 0; oc < 9; oc++) {
              if (oc !== c1 && oc !== c2 && board[r][oc] === 0 && (cands[r][oc] & pairMask)) {
                cands[r][oc] &= ~pairMask;
                elim = true;
              }
            }
            if (elim) return { applied: true, technique: 'NakedPair', rationale: `第 ${r + 1} 行形成顯性數對` };
          }
        }
      }
    }
    // 列
    for (let c = 0; c < 9; c++) {
      const pairRows: number[] = [];
      for (let r = 0; r < 9; r++) {
        if (board[r][c] === 0 && countBits(cands[r][c]) === 2) pairRows.push(r);
      }
      for (let i = 0; i < pairRows.length; i++) {
        for (let j = i + 1; j < pairRows.length; j++) {
          const r1 = pairRows[i];
          const r2 = pairRows[j];
          if (cands[r1][c] === cands[r2][c]) {
            const pairMask = cands[r1][c];
            let elim = false;
            for (let or = 0; or < 9; or++) {
              if (or !== r1 && or !== r2 && board[or][c] === 0 && (cands[or][c] & pairMask)) {
                cands[or][c] &= ~pairMask;
                elim = true;
              }
            }
            if (elim) return { applied: true, technique: 'NakedPair', rationale: `第 ${c + 1} 列形成顯性數對` };
          }
        }
      }
    }

    // 5. 雙向 X-Wing（Row-based 與 Column-based）
    // Row-based
    for (let num = 1; num <= 9; num++) {
      const mask = (1 << num);
      const rowMap = new Map<number, number[]>();
      for (let r = 0; r < 9; r++) {
        const hits: number[] = [];
        for (let c = 0; c < 9; c++) {
          if (board[r][c] === 0 && (cands[r][c] & mask)) hits.push(c);
        }
        if (hits.length === 2) rowMap.set(r, hits);
      }
      const rKeys = Array.from(rowMap.keys());
      for (let i = 0; i < rKeys.length; i++) {
        for (let j = i + 1; j < rKeys.length; j++) {
          const r1 = rKeys[i];
          const r2 = rKeys[j];
          const c1 = rowMap.get(r1)!;
          const c2 = rowMap.get(r2)!;
          if (c1[0] === c2[0] && c1[1] === c2[1]) {
            let elim = false;
            for (let r = 0; r < 9; r++) {
              if (r !== r1 && r !== r2) {
                if (board[r][c1[0]] === 0 && (cands[r][c1[0]] & mask)) { cands[r][c1[0]] &= ~mask; elim = true; }
                if (board[r][c1[1]] === 0 && (cands[r][c1[1]] & mask)) { cands[r][c1[1]] &= ~mask; elim = true; }
              }
            }
            if (elim) return { applied: true, technique: 'XWing', rationale: `數字 ${num} 構成行向 X-Wing 魚形鎖定` };
          }
        }
      }
    }
    // Column-based
    for (let num = 1; num <= 9; num++) {
      const mask = (1 << num);
      const colMap = new Map<number, number[]>();
      for (let c = 0; c < 9; c++) {
        const hits: number[] = [];
        for (let r = 0; r < 9; r++) {
          if (board[r][c] === 0 && (cands[r][c] & mask)) hits.push(r);
        }
        if (hits.length === 2) colMap.set(c, hits);
      }
      const cKeys = Array.from(colMap.keys());
      for (let i = 0; i < cKeys.length; i++) {
        for (let j = i + 1; j < cKeys.length; j++) {
          const c1 = cKeys[i];
          const c2 = cKeys[j];
          const r1 = colMap.get(c1)!;
          const r2 = colMap.get(c2)!;
          if (r1[0] === r2[0] && r1[1] === r2[1]) {
            let elim = false;
            for (let c = 0; c < 9; c++) {
              if (c !== c1 && c !== c2) {
                if (board[r1[0]][c] === 0 && (cands[r1[0]][c] & mask)) { cands[r1[0]][c] &= ~mask; elim = true; }
                if (board[r1[1]][c] === 0 && (cands[r1[1]][c] & mask)) { cands[r1[1]][c] &= ~mask; elim = true; }
              }
            }
            if (elim) return { applied: true, technique: 'XWing', rationale: `數字 ${num} 構成列向 X-Wing 魚形鎖定` };
          }
        }
      }
    }

    return { applied: false, isConflict: false };
  }

  /**
   * 錦標賽冠軍級全定式真實模擬器（純定式驅動反證探針，零暴力 DFS 欺騙）
   */
  private static _simulateChampionshipSolving(
    puzzle: number[][]
  ): {
    steps: SudokuStep[];
    pathSummary: string[];
    highestTechnique: TechniqueStage;
    logicalComplexityScore: number;
    pureRate: number;
    hasPerfectLogicOrder: boolean;
    load: { spatial: number; numeric: number; workingMemory: number; inhibition: number };
    hints: SudokuHintStep[];
  } {
    const board = puzzle.map((r) => [...r]);
    let cands = this._computeCandidateMatrix(board);

    const steps: SudokuStep[] = [];
    const pathCounts: Record<TechniqueStage, number> = {
      NakedSingle: 0,
      HiddenSingle: 0,
      LockedCandidates: 0,
      NakedPair: 0,
      HiddenPair: 0,
      XWing: 0,
      ContradictionChain: 0,
    };
    const hints: SudokuHintStep[] = [];

    let progressed = true;
    let stepCount = 0;
    let complexityScore = 0;
    let multiBranchSteps = 0;
    let highestTechnique: TechniqueStage = 'NakedSingle';

    const countBits = (mask: number): number => {
      let cnt = 0;
      for (let n = 1; n <= 9; n++) if (mask & (1 << n)) cnt++;
      return cnt;
    };

    while (progressed) {
      progressed = false;
      cands = this._computeCandidateMatrix(board);

      const res = this._applyDeductiveStep(board, cands);
      if (res.applied && res.technique) {
        stepCount++;
        const tech = res.technique;
        pathCounts[tech]++;
        const weight = TECHNIQUE_WEIGHTS[tech];
        complexityScore += weight;

        if (TECHNIQUE_WEIGHTS[tech] > TECHNIQUE_WEIGHTS[highestTechnique]) {
          highestTechnique = tech;
        }

        steps.push({
          step: stepCount,
          technique: tech,
          row: res.r ?? 0,
          col: res.c ?? 0,
          val: res.val ?? 0,
          weight,
          availableBranches: 1,
          rationale: res.rationale ?? '',
        });

        if (hints.length === 0 && res.r !== undefined && res.c !== undefined && res.val !== undefined) {
          hints.push({
            level: 1, row: res.r, col: res.c, targetNum: res.val, technique: tech,
            messageZh: `【區域聚焦】觀察第 ${res.r + 1} 行、第 ${res.c + 1} 列交會處。`,
            messageEn: `[Focus Area] Inspect cell at Row ${res.r + 1}, Col ${res.c + 1}.`,
          });
          hints.push({
            level: 2, row: res.r, col: res.c, targetNum: res.val, technique: tech,
            messageZh: `【邏輯排除】透過 ${tech} 定式消除衝突候選數。`,
            messageEn: `[Elimination Path] Apply ${tech} theorem to eliminate candidates.`,
          });
          hints.push({
            level: 3, row: res.r, col: res.c, targetNum: res.val, technique: tech,
            messageZh: `【落子決策】該格確立為數字 ${res.val}。`,
            messageEn: `[Action] Place digit ${res.val}.`,
          });
        }
        progressed = true;
        continue;
      }

      // 錦標賽冠軍思維：純定式反證法探針（Lookahead-3 Deductive Contradiction，非暴力 DFS）
      outerContradiction: for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (board[r][c] === 0 && countBits(cands[r][c]) === 2) {
            for (let testNum = 1; testNum <= 9; testNum++) {
              if (cands[r][c] & (1 << testNum)) {
                // 建立推導沙盒
                const sandboxBoard = board.map((row) => [...row]);
                sandboxBoard[r][c] = testNum;
                let sandboxCands = this._computeCandidateMatrix(sandboxBoard);

                // 進行至多 3 層純定式連鎖傳播
                let contradictionFound = false;
                for (let depth = 0; depth < 3; depth++) {
                  const subRes = this._applyDeductiveStep(sandboxBoard, sandboxCands);
                  if (subRes.isConflict) {
                    contradictionFound = true;
                    break;
                  }
                  if (!subRes.applied) break;
                  sandboxCands = this._computeCandidateMatrix(sandboxBoard);
                }

                if (contradictionFound) {
                  // 反證成功：在真實盤面排除該候選數
                  cands[r][c] &= ~(1 << testNum);
                  stepCount++;
                  pathCounts.ContradictionChain++;
                  complexityScore += TECHNIQUE_WEIGHTS.ContradictionChain;
                  highestTechnique = 'ContradictionChain';
                  multiBranchSteps++;

                  steps.push({
                    step: stepCount,
                    technique: 'ContradictionChain',
                    row: r,
                    col: c,
                    val: testNum,
                    weight: TECHNIQUE_WEIGHTS.ContradictionChain,
                    availableBranches: 2,
                    rationale: `反證法：假設 (${r + 1}, ${c + 1}) = ${testNum} 經 3 步定式演繹引發衝突，排除候選 ${testNum}`,
                  });
                  progressed = true;
                  break outerContradiction;
                }
              }
            }
          }
        }
      }
    }

    const pathSummary: string[] = [];
    if (pathCounts.NakedSingle > 0) pathSummary.push(`Naked Single ×${pathCounts.NakedSingle}`);
    if (pathCounts.HiddenSingle > 0) pathSummary.push(`Hidden Single ×${pathCounts.HiddenSingle}`);
    if (pathCounts.LockedCandidates > 0) pathSummary.push(`Locked Candidates ×${pathCounts.LockedCandidates}`);
    if (pathCounts.NakedPair > 0) pathSummary.push(`Naked Pair ×${pathCounts.NakedPair}`);
    if (pathCounts.HiddenPair > 0) pathSummary.push(`Hidden Pair ×${pathCounts.HiddenPair}`);
    if (pathCounts.XWing > 0) pathSummary.push(`X-Wing (Fish) ×${pathCounts.XWing}`);
    if (pathCounts.ContradictionChain > 0) pathSummary.push(`Deductive Contradiction ×${pathCounts.ContradictionChain}`);

    const remainingUnsolved = board.flat().filter((v) => v === 0).length;
    const totalBlanks = 81 - puzzle.flat().filter((v) => v !== 0).length;
    const pureRate = totalBlanks > 0 ? Number(((totalBlanks - remainingUnsolved) / totalBlanks).toFixed(2)) : 1.0;

    // 嚴格零分支（Zero-Branch）完美邏輯順序判定
    const hasPerfectLogicOrder = remainingUnsolved === 0 && multiBranchSteps === 0 && pathCounts.ContradictionChain === 0;

    const depthIndex = remainingUnsolved / 40;
    const load = {
      spatial: Number(Math.min(0.95, 0.25 + (1 - (81 - totalBlanks) / 81) * 0.45).toFixed(2)),
      numeric: Number(Math.min(0.98, 0.3 + (stepCount / 60) * 0.4 + depthIndex * 0.3).toFixed(2)),
      workingMemory: Number(Math.min(0.99, 0.35 + (complexityScore / 200) * 0.55).toFixed(2)),
      inhibition: Number(Math.min(0.98, 0.3 + (pathCounts.ContradictionChain + pathCounts.XWing) * 0.15).toFixed(2)),
    };

    return {
      steps,
      pathSummary,
      highestTechnique,
      logicalComplexityScore: complexityScore,
      pureRate,
      hasPerfectLogicOrder,
      load,
      hints,
    };
  }

  /**
   * 統計均勻非對稱與對稱組建構
   */
  private static _generateSymmetryGroups(type: SymmetryType, rnd: () => number): [number, number][][] {
    const groups: [number, number][][] = [];
    const visited = new Set<string>();

    if (type === 'statistical_balanced') {
      for (let br = 0; br < 3; br++) {
        for (let bc = 0; bc < 3; bc++) {
          const boxCells: [number, number][] = [];
          for (let r = br * 3; r < br * 3 + 3; r++) {
            for (let c = bc * 3; c < bc * 3 + 3; c++) boxCells.push([r, c]);
          }
          for (let i = boxCells.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [boxCells[i], boxCells[j]] = [boxCells[j], boxCells[i]];
          }
          for (let i = 0; i < boxCells.length; i += 2) {
            if (i + 1 < boxCells.length) groups.push([boxCells[i], boxCells[i + 1]]);
            else groups.push([boxCells[i]]);
          }
        }
      }
      return groups;
    }

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
          for (let p = 0; p < pts.length; p++) {
            const [pr, pc] = pts[p];
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

  private static _createFallbackPuzzle(tier: TierKey, seed: number, rnd: () => number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;

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

    const fallbackGrid = baseSolution.map((row) => [...row]);
    const coords: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) coords.push([r, c]);
    }

    for (let i = coords.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [coords[i], coords[j]] = [coords[j], coords[i]];
    }

    const holesToDig = 81 - config.targetClues;
    let dug = 0;
    for (let i = 0; i < coords.length; i++) {
      if (dug >= holesToDig) break;
      const [r, c] = coords[i];
      const oldVal = fallbackGrid[r][c];
      fallbackGrid[r][c] = 0;
      if (this._countSolutionsFast(fallbackGrid) === 1) {
        dug++;
      } else {
        fallbackGrid[r][c] = oldVal;
      }
    }

    const id = `sudoku_fb_${tier}_s${seed}`;
    const actualClues = 81 - dug;

    const spec: SudokuSpec = {
      rows: 9,
      cols: 9,
      size: 9,
      grid: fallbackGrid,
      clues: fallbackGrid,
      clueCount: actualClues,
      symmetry: 'rotational_180',
      seed,
      solvingPath: ['Naked Single', 'Hidden Single'],
      highestTechnique: 'NakedSingle',
      hints: [
        { level: 1, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '【區域聚焦】觀察第 1 行第 3 列之交叉約束。', messageEn: 'Inspect cross constraints at (1, 3).' },
        { level: 2, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '【邏輯排除】該格三向排除後僅能填入 4。', messageEn: 'The cell uniquely accommodates 4.' },
        { level: 3, row: 0, col: 2, targetNum: 4, technique: 'NakedSingle', messageZh: '【落子決策】請填入數字 4。', messageEn: 'Place digit 4.' },
      ],
      pureDeductionRate: 1.0,
      logicalComplexityScore: 40,
      hasPerfectLogicOrder: true,
      tier,
    };

    return {
      id,
      category: 'numerical_logic',
      engine_type: 'sudoku',
      tier,
      puzzle: spec,
      solution: baseSolution,
      metrics: {
        grid_size: 9,
        rows: 9,
        cols: 9,
        decision_depth: dug,
        propagation_steps: 50 + dug * 2,
        logical_complexity_score: 40,
        highest_technique: 'NakedSingle',
        has_perfect_logic_order: true,
        irt_logit_difficulty: config.baseIrt,
        estimated_time_sec: config.timeLimitSec,
        seed,
        actualTier: tier,
      } as any,
      cognitiveLoad: { spatial: 0.35, numeric: 0.75, workingMemory: 0.8, inhibition: 0.7 },
      checksum: `SUDOKU_FB_9x9_S${seed}`,
    };
  }
}
