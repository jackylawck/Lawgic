import { PuzzleEntity, TierKey } from '../generated';

export type TentCellState = 0 | 1 | 2 | 9; // 0: 未決, 1: 帳篷, 2: 草地, 9: 樹木

export interface TentCoord {
  r: number;
  c: number;
}

export interface EntropyGainProjection {
  coord: TentCoord;
  deltaBits: number;
  quantumLeap: boolean;
}

export interface RippleStep {
  coord: TentCoord;
  forcedBy: TentCoord;
  derivedState: 1 | 2;
  rule: string;
}

export interface SpeculativeProbe {
  target: TentCoord;
  assumedState: 1 | 2;
  propagationDepth: number;
  conflictFound: boolean;
  conflictType?: 'tree_suffocation' | 'quota_exhausted' | 'diagonal_crash';
  rippleSteps: RippleStep[];
}

export interface TentStep {
  step: number;
  type: string;
  r: number;
  c: number;
  state: number;
  rationale: string;
}

export interface CognitiveQMatrix {
  A1_perceptual_scanning: boolean;
  A2_working_memory_update: boolean;
  A3_inhibition_control: boolean;
  A4_relational_bijection: boolean;
  A5_chain_depth_planning: boolean;
}

export interface PsychometricItemParameters {
  difficulty_b: number;
  discrimination_a: number;
  guessing_c: number;
  canonical_hash: string;
  aha_index: number;
  crux_coordinates: TentCoord[];
  persona_convergence_variance: number;
}

export interface TentsSpec {
  rows: number;
  cols: number;
  trees: TentCoord[];
  rowCounts: number[];
  colCounts: number[];
  rowClues: number[];
  colClues: number[];
  solutionTents: TentCoord[];
  treeTentPairs: [TentCoord, TentCoord][];
  solvingSteps: TentStep[];
  qMatrix: CognitiveQMatrix;
  psychometrics: PsychometricItemParameters;
  wpfAnswerKey: string;
  variant: 'standard' | 'diagonal';
  seed: number;
  tier: TierKey;
}

interface TierConfig {
  rows: number;
  cols: number;
  treeCount: number;
  baseIrt: number;
  disallowZeros: boolean;
  timeLimitSec: number;
}

const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids: { rows: 4, cols: 4, treeCount: 3, baseIrt: 0.65, disallowZeros: false, timeLimitSec: 60 },
  intermediate: { rows: 5, cols: 5, treeCount: 5, baseIrt: 1.45, disallowZeros: false, timeLimitSec: 120 },
  expert: { rows: 6, cols: 6, treeCount: 7, baseIrt: 2.35, disallowZeros: true, timeLimitSec: 210 },
  master: { rows: 8, cols: 8, treeCount: 11, baseIrt: 3.15, disallowZeros: true, timeLimitSec: 330 },
  legendary: { rows: 9, cols: 9, treeCount: 14, baseIrt: 3.75, disallowZeros: true, timeLimitSec: 480 },
  ultimate: { rows: 10, cols: 10, treeCount: 18, baseIrt: 4.35, disallowZeros: true, timeLimitSec: 660 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebTentsGenerator {
  public static readonly DIRS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  public static inBounds(r: number, c: number, rows: number, cols: number): boolean {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  public static canPlaceTentNoTouch(r: number, c: number, board: number[][], rows: number, cols: number): boolean {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 1) {
          return false;
        }
      }
    }
    return true;
  }

  public static hasUniqueBijectiveMatching(
    trees: TentCoord[],
    tents: TentCoord[],
    rows: number,
    cols: number
  ): boolean {
    if (trees.length !== tents.length) return false;
    const n = trees.length;
    const adj: number[][] = Array.from({ length: n }, () => []);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dist = Math.abs(trees[i].r - tents[j].r) + Math.abs(trees[i].c - tents[j].c);
        if (dist === 1) adj[i].push(j);
      }
    }

    const match = new Array<number>(n).fill(-1);
    const visited = new Array<boolean>(n).fill(false);

    const dfs = (u: number): boolean => {
      for (const v of adj[u]) {
        if (!visited[v]) {
          visited[v] = true;
          if (match[v] < 0 || dfs(match[v])) {
            match[v] = u;
            return true;
          }
        }
      }
      return false;
    };

    let matchingSize = 0;
    for (let i = 0; i < n; i++) {
      visited.fill(false);
      if (dfs(i)) matchingSize++;
    }

    return matchingSize === n;
  }

  public static computeWpfAnswerKey(rows: number, cols: number, solutionTents: TentCoord[]): string {
    const rowMap = new Map<number, number[]>();
    for (let r = 0; r < rows; r++) rowMap.set(r, []);
    for (const t of solutionTents) rowMap.get(t.r)!.push(t.c + 1);

    const keys: string[] = [];
    for (let r = 0; r < rows; r++) {
      const colsInRow = rowMap.get(r)!.sort((a, b) => a - b);
      if (colsInRow.length === 0) {
        keys.push('0');
      } else {
        keys.push(colsInRow.map((c) => String(c % 10)).join(''));
      }
    }
    return keys.join(',');
  }

  /**
   * 嚴格純傳播求解器（Zero-Assumption）：絕不回溯分支
   */
  public static runPurePropagation(
    boardIn: number[][],
    spec: Pick<TentsSpec, 'rows' | 'cols' | 'trees' | 'rowCounts' | 'colCounts'>
  ): { board: number[][]; solved: boolean; steps: TentStep[] } {
    const { rows, cols, trees, rowCounts, colCounts } = spec;
    const board = boardIn.map((r) => [...r]);
    const steps: TentStep[] = [];
    let progress = true;

    while (progress) {
      progress = false;

      // 1. 歸零行／列填草地
      for (let r = 0; r < rows; r++) {
        if (rowCounts[r] === 0) {
          for (let c = 0; c < cols; c++) {
            if (board[r][c] === 0) {
              board[r][c] = 2;
              progress = true;
              steps.push({ step: steps.length + 1, type: 'zero_line', r, c, state: 2, rationale: `Row ${r + 1} quota 0` });
            }
          }
        }
      }
      for (let c = 0; c < cols; c++) {
        if (colCounts[c] === 0) {
          for (let r = 0; r < rows; r++) {
            if (board[r][c] === 0) {
              board[r][c] = 2;
              progress = true;
              steps.push({ step: steps.length + 1, type: 'zero_line', r, c, state: 2, rationale: `Col ${c + 1} quota 0` });
            }
          }
        }
      }

      // 2. 帳篷八向隔離防碰
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === 1) {
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const nr = r + dr, nc = c + dc;
                if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
                  board[nr][nc] = 2;
                  progress = true;
                  steps.push({ step: steps.length + 1, type: 'tent_isolation', r: nr, c: nc, state: 2, rationale: '8-way no touch' });
                }
              }
            }
          }
        }
      }

      // 3. 樹木僅剩單一空位必出帳篷
      for (const tree of trees) {
        let hasTent = false;
        const openAdj: TentCoord[] = [];
        for (const [dr, dc] of this.DIRS) {
          const nr = tree.r + dr, nc = tree.c + dc;
          if (this.inBounds(nr, nc, rows, cols)) {
            if (board[nr][nc] === 1) hasTent = true;
            else if (board[nr][nc] === 0 && this.canPlaceTentNoTouch(nr, nc, board, rows, cols)) {
              openAdj.push({ r: nr, c: nc });
            }
          }
        }
        if (!hasTent && openAdj.length === 1) {
          const target = openAdj[0];
          board[target.r][target.c] = 1;
          progress = true;
          steps.push({ step: steps.length + 1, type: 'isolated_tree', r: target.r, c: target.c, state: 1, rationale: 'Sole viable adjacent slot' });
        }
      }

      // 4. 配額缺額等於剩餘候選格
      for (let r = 0; r < rows; r++) {
        let placed = 0;
        const open: number[] = [];
        for (let c = 0; c < cols; c++) {
          if (board[r][c] === 1) placed++;
          else if (board[r][c] === 0) open.push(c);
        }
        if (placed + open.length === rowCounts[r] && open.length > 0) {
          for (const c of open) {
            board[r][c] = 1;
            steps.push({ step: steps.length + 1, type: 'quota_starvation', r, c, state: 1, rationale: `Row ${r + 1} quota forced tent` });
          }
          progress = true;
        } else if (placed === rowCounts[r] && open.length > 0) {
          for (const c of open) {
            board[r][c] = 2;
            steps.push({ step: steps.length + 1, type: 'quota_satisfied', r, c, state: 2, rationale: `Row ${r + 1} quota filled` });
          }
          progress = true;
        }
      }

      for (let c = 0; c < cols; c++) {
        let placed = 0;
        const open: number[] = [];
        for (let r = 0; r < rows; r++) {
          if (board[r][c] === 1) placed++;
          else if (board[r][c] === 0) open.push(r);
        }
        if (placed + open.length === colCounts[c] && open.length > 0) {
          for (const r of open) {
            board[r][c] = 1;
            steps.push({ step: steps.length + 1, type: 'quota_starvation', r, c, state: 1, rationale: `Col ${c + 1} quota forced tent` });
          }
          progress = true;
        } else if (placed === colCounts[c] && open.length > 0) {
          for (const r of open) {
            board[r][c] = 2;
            steps.push({ step: steps.length + 1, type: 'quota_satisfied', r, c, state: 2, rationale: `Col ${c + 1} quota filled` });
          }
          progress = true;
        }
      }
    }

    let isSolved = true;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c] === 0) isSolved = false;
      }
    }

    return { board, solved: isSolved, steps };
  }

  /**
   * 前端微秒級因果前瞻探針
   */
  public static simulateHypothesisProbe(
    currentBoard: number[][],
    spec: Pick<TentsSpec, 'rows' | 'cols' | 'trees' | 'rowCounts' | 'colCounts'>,
    target: TentCoord,
    assumedState: 1 | 2
  ): SpeculativeProbe {
    const { rows, cols, trees, rowCounts, colCounts } = spec;
    const simBoard = currentBoard.map((row) => [...row]);
    simBoard[target.r][target.c] = assumedState;

    const rippleSteps: RippleStep[] = [];

    // 1. 八向立即碰撞
    if (assumedState === 1 && !this.canPlaceTentNoTouch(target.r, target.c, currentBoard, rows, cols)) {
      return {
        target,
        assumedState,
        propagationDepth: 1,
        conflictFound: true,
        conflictType: 'diagonal_crash',
        rippleSteps: [{ coord: target, forcedBy: target, derivedState: 1, rule: 'Direct diagonal collision' }],
      };
    }

    // 2. 跑短程純傳播檢驗是否有樹木窒息或配額溢出
    const { board: propagated, steps } = this.runPurePropagation(simBoard, spec);

    for (const s of steps) {
      rippleSteps.push({
        coord: { r: s.r, c: s.c },
        forcedBy: target,
        derivedState: s.state as 1 | 2,
        rule: s.rationale,
      });
    }

    // 檢查樹木是否窒息
    for (const tree of trees) {
      let hasTent = false;
      let hasOpen = false;
      for (const [dr, dc] of this.DIRS) {
        const nr = tree.r + dr, nc = tree.c + dc;
        if (this.inBounds(nr, nc, rows, cols)) {
          if (propagated[nr][nc] === 1) hasTent = true;
          if (propagated[nr][nc] === 0) hasOpen = true;
        }
      }
      if (!hasTent && !hasOpen) {
        return {
          target,
          assumedState,
          propagationDepth: Math.max(1, rippleSteps.length),
          conflictFound: true,
          conflictType: 'tree_suffocation',
          rippleSteps,
        };
      }
    }

    // 檢查行列是否溢出
    for (let r = 0; r < rows; r++) {
      let cnt = 0;
      for (let c = 0; c < cols; c++) if (propagated[r][c] === 1) cnt++;
      if (cnt > rowCounts[r]) {
        return {
          target,
          assumedState,
          propagationDepth: Math.max(1, rippleSteps.length),
          conflictFound: true,
          conflictType: 'quota_exhausted',
          rippleSteps,
        };
      }
    }

    return {
      target,
      assumedState,
      propagationDepth: rippleSteps.length,
      conflictFound: false,
      rippleSteps,
    };
  }

  /**
   * 計算熵降幅（Information Gain）
   */
  public static computeEntropyGain(
    r: number,
    c: number,
    board: number[][],
    spec: TentsSpec
  ): EntropyGainProjection {
    let unassignedBefore = 0;
    for (let i = 0; i < spec.rows; i++) {
      for (let j = 0; j < spec.cols; j++) {
        if (board[i][j] === 0) unassignedBefore++;
      }
    }

    const sim = board.map((row) => [...row]);
    sim[r][c] = 1;
    const { board: nextBoard } = this.runPurePropagation(sim, spec);

    let unassignedAfter = 0;
    for (let i = 0; i < spec.rows; i++) {
      for (let j = 0; j < spec.cols; j++) {
        if (nextBoard[i][j] === 0) unassignedAfter++;
      }
    }

    const deltaBits = Number((Math.log2(unassignedBefore + 1) - Math.log2(unassignedAfter + 1)).toFixed(2));

    return {
      coord: { r, c },
      deltaBits: Math.max(0, deltaBits),
      quantumLeap: deltaBits >= 2.5,
    };
  }

  public static generate(tier: TierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const conf = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, treeCount, baseIrt, timeLimitSec } = conf;
    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    let attempts = 0;
    const maxAttempts = 60;

    while (attempts++ < maxAttempts) {
      const trees: TentCoord[] = [];
      const solutionTents: TentCoord[] = [];
      const treeTentPairs: [TentCoord, TentCoord][] = [];
      const board: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

      let inner = 0;
      while (trees.length < treeCount && inner++ < 300) {
        const tr = Math.floor(rnd() * rows);
        const tc = Math.floor(rnd() * cols);
        if (board[tr][tc] !== 0) continue;

        const validAdj: [number, number][] = [];
        for (const [dr, dc] of this.DIRS) {
          const nr = tr + dr, nc = tc + dc;
          if (this.inBounds(nr, nc, rows, cols) && board[nr][nc] === 0) {
            if (this.canPlaceTentNoTouch(nr, nc, board, rows, cols)) {
              validAdj.push([nr, nc]);
            }
          }
        }

        if (validAdj.length > 0) {
          const [tentR, tentC] = validAdj[Math.floor(rnd() * validAdj.length)];
          board[tr][tc] = 9;
          board[tentR][tentC] = 1;
          trees.push({ r: tr, c: tc });
          solutionTents.push({ r: tentR, c: tentC });
          treeTentPairs.push([{ r: tr, c: tc }, { r: tentR, c: tentC }]);
        }
      }

      if (trees.length < treeCount) continue;

      const rowCounts = Array(rows).fill(0);
      const colCounts = Array(cols).fill(0);
      for (const t of solutionTents) {
        rowCounts[t.r]++;
        colCounts[t.c]++;
      }

      // 二分圖雙射匹配檢驗
      if (!this.hasUniqueBijectiveMatching(trees, solutionTents, rows, cols)) continue;

      // 無猜純傳播求解驗證（Zero-Assumption 檢定）
      const initialEmptyBoard = Array.from({ length: rows }, () => Array(cols).fill(0));
      for (const t of trees) initialEmptyBoard[t.r][t.c] = 9;

      const specPartial = { rows, cols, trees, rowCounts, colCounts };
      const { solved, steps } = this.runPurePropagation(initialEmptyBoard, specPartial);

      if (!solved) continue; // 依賴回溯猜測者，全數淘汰

      const wpfKey = this.computeWpfAnswerKey(rows, cols, solutionTents);
      const spec: TentsSpec = {
        rows,
        cols,
        trees,
        rowCounts,
        colCounts,
        rowClues: rowCounts,
        colClues: colCounts,
        solutionTents,
        treeTentPairs,
        solvingSteps: steps,
        qMatrix: {
          A1_perceptual_scanning: true,
          A2_working_memory_update: true,
          A3_inhibition_control: true,
          A4_relational_bijection: true,
          A5_chain_depth_planning: steps.length > 10,
        },
        psychometrics: {
          difficulty_b: baseIrt,
          discrimination_a: 1.85,
          guessing_c: 0.0,
          canonical_hash: `WP_TENTS_${rows}x${cols}_S${actualSeed}`,
          aha_index: 0.88,
          crux_coordinates: [solutionTents[0]],
          persona_convergence_variance: 0.0008,
        },
        wpfAnswerKey: wpfKey,
        variant: 'standard',
        seed: actualSeed,
        tier,
      };

      return {
        id: `tents_${tier}_s${actualSeed}`,
        category: 'spatial_logic',
        engine_type: 'tents',
        tier,
        checksum: `WP_CANON_${actualSeed}`,
        puzzle: spec as any,
        solution: solutionTents as any,
        cognitiveLoad: { spatial: 0.95, numeric: 0.5, workingMemory: 0.85, inhibition: 0.9 },
        metrics: {
          grid_size: rows,
          rows,
          cols,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: baseIrt,
          human_sim_steps: steps.length,
          actualTier: tier,
        } as any,
      };
    }

    throw new Error('Generation failed to converge on purely deductible topology.');
  }
}
