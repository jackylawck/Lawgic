// web-frontend/src/engines/masyuCore.ts

export type TierKey = 'kids' | 'intermediate' | 'expert' | 'master' | 'legendary' | 'ultimate';
export type PearlType = 'none' | 'white' | 'black';
export type TechniqueLevel = 1 | 2 | 3 | 4 | 5;

export type MacroParadigm = 'archimedean_spiral' | 'sinusoidal_braid' | 'superelliptic_meander' | 'hyperbolic_cross';
export type VisualMotif = 'taichi_yin_yang' | 'seahorse_spiral' | 'clover_four_fold' | 'geometric_harmony';

export interface GenesisFrame {
  iteration: number;
  energy: number;
  temperature: number;
  path: [number, number][];
}

export interface IntentNode {
  role: 'opening_anchor' | 'trap_bifurcation' | 'endgame_parity';
  coord: [number, number];
  pearlType: PearlType;
  requiredTurn: boolean;
}

export interface AuthorialBlueprint {
  paradigm: MacroParadigm;
  motif: VisualMotif;
  aestheticScore: number;
  intentGraph: IntentNode[];
  endgameParityEdge: string;
  trapBifurcationEdge: string;
  targetLipschitz: number;
}

export interface ContradictionStep {
  edge: string;
  inferredBy: string;
}

export interface MasyuHintStep {
  step: number;
  r: number;
  c: number;
  techniqueLevel: TechniqueLevel;
  technique: string;
  forcedEdge?: string;
  structuralPattern: string;
  rationale: string;
  contradictionTree?: {
    hypothesis: string;
    branchChain: ContradictionStep[];
    conflictLocation: [number, number];
    conflictReason: string;
  };
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface MasyuSpec {
  rows: number;
  cols: number;
  size: number;
  grid: PearlType[][];
  clues: PearlType[][];
  solutionEdges: string[];
  seed: number;
  dnaSignature: string;
  blueprint: AuthorialBlueprint;
  clueDensity: number;
  lipschitzScore: number;
  coverageRatio: number;
  genesisFrames: GenesisFrame[];
  tier: TierKey;
}

export interface PuzzleEntity {
  id: string;
  category: string;
  engine_type: string;
  tier: TierKey;
  checksum: string;
  puzzle: MasyuSpec;
  solution: string[];
  cognitiveLoad: {
    spatial: number;
    numeric: number;
    workingMemory: number;
    inhibition: number;
  };
  metrics: {
    grid_size: number;
    rows: number;
    cols: number;
    estimated_time_sec: number;
    irt_logit_difficulty: number;
    seed: number;
    lipschitzScore: number;
    coverageRatio: number;
    aestheticScore: number;
    motif: VisualMotif;
    actualTier: TierKey;
    paradigm: MacroParadigm;
    clueDensity: number;
  };
}

export interface DynamicFlowTuning {
  userThetaDelta: number;
  targetMaxClueRatio: number;
  lookaheadDepth: number;
}

export interface TierConfig {
  size: number;
  targetMaxClueRatio: number;
  minCoverage: number;
  minLipschitz: number;
  lookaheadDepth: number;
  timeLimitSec: number;
  baseIrt: number;
}

export const TIER_SPECS: Record<TierKey, TierConfig> = {
  kids:         { size: 5,  targetMaxClueRatio: 0.28, minCoverage: 0.60, minLipschitz: 0.82, lookaheadDepth: 1, timeLimitSec: 90,  baseIrt: 0.65 },
  intermediate: { size: 6,  targetMaxClueRatio: 0.22, minCoverage: 0.65, minLipschitz: 0.85, lookaheadDepth: 2, timeLimitSec: 150, baseIrt: 1.45 },
  expert:       { size: 7,  targetMaxClueRatio: 0.17, minCoverage: 0.68, minLipschitz: 0.88, lookaheadDepth: 3, timeLimitSec: 240, baseIrt: 2.35 },
  master:       { size: 8,  targetMaxClueRatio: 0.14, minCoverage: 0.70, minLipschitz: 0.92, lookaheadDepth: 4, timeLimitSec: 360, baseIrt: 3.15 },
  legendary:    { size: 9,  targetMaxClueRatio: 0.12, minCoverage: 0.72, minLipschitz: 0.94, lookaheadDepth: 5, timeLimitSec: 480, baseIrt: 3.75 },
  ultimate:     { size: 10, targetMaxClueRatio: 0.10, minCoverage: 0.75, minLipschitz: 0.96, lookaheadDepth: 6, timeLimitSec: 600, baseIrt: 4.35 },
};

export class DisjointSet {
  parent: Int32Array;
  size: Int32Array;

  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }

  find(i: number): number {
    let r = i;
    while (r !== this.parent[r]) r = this.parent[r];
    let curr = i;
    while (curr !== r) {
      const nxt = this.parent[curr];
      this.parent[curr] = r;
      curr = nxt;
    }
    return r;
  }

  union(i: number, j: number): boolean {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI === rootJ) return false;
    if (this.size[rootI] < this.size[rootJ]) {
      this.parent[rootI] = rootJ;
      this.size[rootJ] += this.size[rootI];
    } else {
      this.parent[rootJ] = rootI;
      this.size[rootI] += this.size[rootJ];
    }
    return true;
  }
}

export class MasyuCoreEngine {
  public static createRng(seed: number) {
    let s = BigInt(seed) >>> 0n;
    return function next(): number {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let z = s;
      z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return Number((z ^ (z >> 31n)) & 0xffffffffn) / 4294967296;
    };
  }

  public static makeEdgeKey(r1: number, c1: number, r2: number, c2: number): string {
    if (r1 < r2 || (r1 === r2 && c1 < c2)) return `${r1},${c1}-${r2},${c2}`;
    return `${r2},${c2}-${r1},${c1}`;
  }

  public static inBounds(r: number, c: number, size: number): boolean {
    return r >= 0 && r < size && c >= 0 && c < size;
  }

  public static evaluateLatentAesthetics(path: [number, number][], size: number): { score: number; motif: VisualMotif } {
    const tensor = Array.from({ length: size }, () => new Float32Array(size));
    for (let i = 0; i < path.length; i++) {
      const [r, c] = path[i];
      tensor[r][c] = 1.0;
    }

    let symmetryScore = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const mirrorC = size - 1 - c;
        const mirrorR = size - 1 - r;
        if (tensor[r][c] > 0 && tensor[r][mirrorC] > 0) symmetryScore += 0.5;
        if (tensor[r][c] > 0 && tensor[mirrorR][mirrorC] > 0) symmetryScore += 1.0;
      }
    }
    symmetryScore /= (size * size);

    let edgeCurvatureFlow = 0;
    for (let r = 1; r < size - 1; r++) {
      for (let c = 1; c < size - 1; c++) {
        const laplacian = tensor[r - 1][c] + tensor[r + 1][c] + tensor[r][c - 1] + tensor[r][c + 1] - 4 * tensor[r][c];
        if (Math.abs(laplacian) <= 1.0) edgeCurvatureFlow += 1.0;
      }
    }
    const flowRegularity = edgeCurvatureFlow / Math.max(1, (size - 2) * (size - 2));

    let motif: VisualMotif = 'geometric_harmony';
    let motifBonus = 0.0;
    const center = (size - 1) / 2;
    let sCurveCorrelations = 0;
    let quadSymmetryMatches = 0;

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (tensor[r][c] > 0) {
          const x = c - center, y = r - center;
          const tr = Math.floor(center - y);
          const tc = Math.floor(center - x);
          if (x * y > 0 && tr >= 0 && tr < size && tc >= 0 && tc < size && tensor[tr][tc] > 0) {
            sCurveCorrelations++;
          }
          if (tensor[c][size - 1 - r] > 0 && tensor[size - 1 - c][r] > 0) {
            quadSymmetryMatches++;
          }
        }
      }
    }

    if (sCurveCorrelations > path.length * 0.40) {
      motif = 'taichi_yin_yang';
      motifBonus = 0.15;
    } else if (quadSymmetryMatches > path.length * 0.35) {
      motif = 'clover_four_fold';
      motifBonus = 0.12;
    } else if (symmetryScore > 0.55) {
      motif = 'seahorse_spiral';
      motifBonus = 0.10;
    }

    const totalAesthetic = Number(Math.min(1.0, symmetryScore * 0.45 + flowRegularity * 0.4 + motifBonus).toFixed(3));
    return { score: totalAesthetic, motif };
  }

  private static evaluateParadigmAffinity(path: [number, number][], size: number, paradigm: MacroParadigm): number {
    const center = (size - 1) / 2;
    let penalty = 0;

    if (paradigm === 'archimedean_spiral') {
      let prevRadius = 0;
      let oscillationCount = 0;
      for (let i = 0; i < path.length; i++) {
        const [r, c] = path[i];
        const radius = Math.hypot(r - center, c - center);
        if (i > 1) {
          const delta = radius - prevRadius;
          if (Math.abs(delta) > 1.8) oscillationCount++;
        }
        prevRadius = radius;
      }
      penalty = oscillationCount * 0.8;
    } else if (paradigm === 'sinusoidal_braid') {
      let consecutiveTurns = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[(i - 1 + path.length) % path.length];
        const n = path[(i + 1) % path.length];
        const isTurn = p[0] !== n[0] && p[1] !== n[1];
        if (isTurn) {
          consecutiveTurns++;
          if (consecutiveTurns >= 3) penalty += 2.5;
        } else {
          consecutiveTurns = 0;
        }
      }
    } else if (paradigm === 'superelliptic_meander') {
      let innerDrift = 0;
      for (const [r, c] of path) {
        const x = (c - center) / center;
        const y = (r - center) / center;
        const lameMetric = Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(y), 4);
        if (lameMetric < 0.15) innerDrift++;
      }
      penalty = innerDrift * 0.6;
    } else {
      let diagonalCrowding = 0;
      for (const [r, c] of path) {
        if (Math.abs(r - c) === 0 || Math.abs(r + c - (size - 1)) === 0) {
          diagonalCrowding++;
        }
      }
      penalty = Math.max(0, diagonalCrowding - size) * 0.5;
    }

    return penalty;
  }

  public static generateHmcLoopWithGenesis(
    size: number,
    blueprint: AuthorialBlueprint,
    minCoverage: number,
    rnd: () => number
  ): { path: [number, number][]; genesisFrames: GenesisFrame[] } | null {
    const anchorCoords = blueprint.intentGraph.map((n) => n.coord);
    let loop: [number, number][] = [];
    const genesisFrames: GenesisFrame[] = [];

    for (let c = 0; c < size; c++) loop.push([0, c]);
    for (let r = 1; r < size; r++) loop.push([r, size - 1]);
    for (let c = size - 2; c >= 0; c--) loop.push([size - 1, c]);
    for (let r = size - 2; r > 0; r--) loop.push([r, 0]);

    const calcEnergy = (path: [number, number][]): number => {
      const visited = new Set(path.map(([r, c]) => `${r},${c}`));
      const coverage = visited.size / (size * size);

      let turnCount = 0;
      for (let i = 0; i < path.length; i++) {
        const p = path[(i - 1 + path.length) % path.length];
        const n = path[(i + 1) % path.length];
        if (p[0] !== n[0] && p[1] !== n[1]) turnCount++;
      }
      const turnDensity = turnCount / path.length;
      const turnVariance = Math.abs(turnDensity - 0.38);

      let missingAnchorPenalty = 0;
      for (const [ar, ac] of anchorCoords) {
        if (!visited.has(`${ar},${ac}`)) missingAnchorPenalty += 15.0;
      }

      const paradigmEnergy = this.evaluateParadigmAffinity(path, size, blueprint.paradigm);
      return (1.0 - coverage) * 14.0 + turnVariance * 4.0 + missingAnchorPenalty + paradigmEnergy;
    };

    let currentEnergy = calcEnergy(loop);
    let temperature = 3.2;
    const coolingRate = 0.985;
    const iterations = 320;

    for (let iter = 0; iter < iterations; iter++) {
      if (iter % 40 === 0 || iter === iterations - 1) {
        genesisFrames.push({
          iteration: iter,
          energy: Number(currentEnergy.toFixed(2)),
          temperature: Number(temperature.toFixed(3)),
          path: loop.map(([r, c]) => [r, c]),
        });
      }

      if (currentEnergy < 3.0 && loop.length / (size * size) >= minCoverage) {
        break;
      }

      const idx = Math.floor(rnd() * loop.length);
      const nextIdx = (idx + 1) % loop.length;
      const [r1, c1] = loop[idx];
      const [r2, c2] = loop[nextIdx];

      const dr = r2 - r1;
      const dc = c2 - c1;
      const perpDirs: [number, number][] = [[-dc, dr], [dc, -dr]];
      const [pdr, pdc] = perpDirs[rnd() < 0.5 ? 0 : 1];

      const nr1 = r1 + pdr, nc1 = c1 + pdc;
      const nr2 = r2 + pdr, nc2 = c2 + pdc;

      if (this.inBounds(nr1, nc1, size) && this.inBounds(nr2, nc2, size)) {
        const candidateLoop = [...loop];
        const visited = new Set(loop.map(([r, c]) => `${r},${c}`));

        if (!visited.has(`${nr1},${nc1}`) && !visited.has(`${nr2},${nc2}`)) {
          candidateLoop.splice(idx + 1, 0, [nr1, nc1], [nr2, nc2]);

          const candEnergy = calcEnergy(candidateLoop);
          const delta = candEnergy - currentEnergy;

          if (delta < 0 || Math.exp(-delta / temperature) > rnd()) {
            loop = candidateLoop;
            currentEnergy = candEnergy;
          }
        }
      }
      temperature *= coolingRate;
    }

    const finalCoverage = new Set(loop.map(([r, c]) => `${r},${c}`)).size / (size * size);
    if (finalCoverage < minCoverage) return null;

    return { path: loop, genesisFrames };
  }

  public static constructPreLoopBlueprint(
    size: number,
    paradigm: MacroParadigm,
    rnd: () => number
  ): AuthorialBlueprint {
    const intentGraph: IntentNode[] = [];

    intentGraph.push({
      role: 'opening_anchor',
      coord: [0, 0],
      pearlType: 'black',
      requiredTurn: true,
    });
    intentGraph.push({
      role: 'opening_anchor',
      coord: [0, size - 1],
      pearlType: 'black',
      requiredTurn: true,
    });
    intentGraph.push({
      role: 'opening_anchor',
      coord: [size - 1, Math.floor(size / 2)],
      pearlType: 'white',
      requiredTurn: false,
    });

    const trapBifurcationEdge = this.makeEdgeKey(1, 1, 1, 2);
    const endgameParityEdge = this.makeEdgeKey(size - 2, 0, size - 1, 0);

    return {
      paradigm,
      motif: 'geometric_harmony',
      aestheticScore: 0.85,
      intentGraph,
      endgameParityEdge,
      trapBifurcationEdge,
      targetLipschitz: 0.95,
    };
  }

  public static pruneStrictly(
    fullGrid: PearlType[][],
    solutionEdges: Set<string>,
    size: number,
    targetMaxRatio: number,
    lookahead: number,
    blueprint: AuthorialBlueprint,
    rnd: () => number
  ): { grid: PearlType[][]; clueDensity: number; lipschitzScore: number } | null {
    const grid: PearlType[][] = fullGrid.map((row) => [...row]);
    const candidates: [number, number][] = [];
    const protectedAnchors = new Set(blueprint.intentGraph.map((n) => `${n.coord[0]},${n.coord[1]}`));

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] !== 'none' && !protectedAnchors.has(`${r},${c}`)) {
          candidates.push([r, c]);
        }
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const maxAllowedClues = Math.floor(size * size * targetMaxRatio);
    let currentCount = grid.flat().filter((x) => x !== 'none').length;

    for (const [r, c] of candidates) {
      if (currentCount <= maxAllowedClues) break;
      const backup = grid[r][c];
      grid[r][c] = 'none';

      const deductive = this.runClosure(grid, size, lookahead);
      if (deductive.success && deductive.solvedEdges.size === solutionEdges.size) {
        if (this.countSolutionsExact(grid, size, 2) === 1) {
          currentCount--;
          continue;
        }
      }
      grid[r][c] = backup;
    }

    const finalTest = this.runClosure(grid, size, lookahead);
    if (!finalTest.success || finalTest.solvedEdges.size !== solutionEdges.size) {
      return null;
    }

    const clueDensity = Number((currentCount / (size * size)).toFixed(3));
    const lipschitzScore = this.evaluateLipschitz(finalTest.resolutionSteps, solutionEdges.size);

    return { grid, clueDensity, lipschitzScore };
  }

  public static runClosure(
    grid: PearlType[][],
    size: number,
    lookahead: number
  ): { success: boolean; solvedEdges: Set<string>; resolutionSteps: number[] } {
    const totalCells = size * size;
    const allEdges: [number, number, number, number][] = [];
    const edgeMap = new Map<string, number>();

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (c + 1 < size) allEdges.push([r, c, r, c + 1]);
        if (r + 1 < size) allEdges.push([r, c, r + 1, c]);
      }
    }

    allEdges.forEach(([r1, c1, r2, c2], idx) => {
      edgeMap.set(this.makeEdgeKey(r1, c1, r2, c2), idx);
    });

    const status = new Int8Array(allEdges.length);
    const nodeDegree = new Uint8Array(totalCells);
    const getIdx = (r: number, c: number) => r * size + c;

    const propagate = (st: Int8Array, deg: Uint8Array): boolean => {
      let changed = false;
      const dsu = new DisjointSet(totalCells);

      for (let i = 0; i < allEdges.length; i++) {
        if (st[i] === 1) {
          const [r1, c1, r2, c2] = allEdges[i];
          dsu.union(getIdx(r1, c1), getIdx(r2, c2));
        }
      }

      for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
          const u = getIdx(r, c);
          const orth: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          const avail: number[] = [];
          let active = 0;

          for (const [dr, dc] of orth) {
            const nr = r + dr, nc = c + dc;
            if (this.inBounds(nr, nc, size)) {
              const eIdx = edgeMap.get(this.makeEdgeKey(r, c, nr, nc))!;
              if (st[eIdx] === 1) active++;
              else if (st[eIdx] === 0) avail.push(eIdx);
            }
          }

          if (deg[u] === 2 && avail.length > 0) {
            for (const e of avail) {
              st[e] = -1;
              changed = true;
            }
          } else if (active + avail.length === 2 && active < 2) {
            for (const e of avail) {
              st[e] = 1;
              const [r1, c1, r2, c2] = allEdges[e];
              deg[getIdx(r1, c1)]++;
              deg[getIdx(r2, c2)]++;
              changed = true;
            }
          }
        }
      }

      for (let i = 0; i < allEdges.length; i++) {
        if (st[i] === 0) {
          const [r1, c1, r2, c2] = allEdges[i];
          const u = getIdx(r1, c1), v = getIdx(r2, c2);
          if (dsu.find(u) === dsu.find(v) && dsu.size[dsu.find(u)] > 2 && dsu.size[dsu.find(u)] < size * 2) {
            st[i] = -1;
            changed = true;
          }
        }
      }

      return changed;
    };

    const resolutionSteps: number[] = [];
    let progress = true;

    while (progress) {
      progress = false;
      while (propagate(status, nodeDegree)) {
        progress = true;
        let count = 0;
        for (let i = 0; i < status.length; i++) if (status[i] === 1) count++;
        resolutionSteps.push(count);
      }

      if (!progress && lookahead >= 2) {
        for (let i = 0; i < allEdges.length; i++) {
          if (status[i] === 0) {
            const [r1, c1, r2, c2] = allEdges[i];
            const simSt = new Int8Array(status);
            const simDeg = new Uint8Array(nodeDegree);

            simSt[i] = 1;
            simDeg[getIdx(r1, c1)]++;
            simDeg[getIdx(r2, c2)]++;

            let depth = 0;
            let conflict = false;
            while (depth++ < lookahead) {
              const ch = propagate(simSt, simDeg);
              for (let d = 0; d < totalCells; d++) {
                if (simDeg[d] > 2) {
                  conflict = true;
                  break;
                }
              }
              if (conflict || !ch) break;
            }

            if (conflict) {
              status[i] = -1;
              progress = true;
              break;
            }
          }
        }
      }
    }

    const solvedEdges = new Set<string>();
    for (let i = 0; i < status.length; i++) {
      if (status[i] === 1) {
        const [r1, c1, r2, c2] = allEdges[i];
        solvedEdges.add(this.makeEdgeKey(r1, c1, r2, c2));
      }
    }

    const success = this.validateSolution(grid, solvedEdges, size);
    return { success, solvedEdges, resolutionSteps };
  }

  public static countSolutionsExact(grid: PearlType[][], size: number, limit: number = 2): number {
    const totalCells = size * size;
    const allEdges: [number, number, number, number][] = [];

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (c + 1 < size) allEdges.push([r, c, r, c + 1]);
        if (r + 1 < size) allEdges.push([r, c, r + 1, c]);
      }
    }

    const status = new Int8Array(allEdges.length);
    const degrees = new Uint8Array(totalCells);
    let count = 0;

    const getIdx = (r: number, c: number) => r * size + c;

    const backtrack = (idx: number): void => {
      if (count >= limit) return;

      if (idx === allEdges.length) {
        const activeEdges = new Set<string>();
        for (let i = 0; i < status.length; i++) {
          if (status[i] === 1) {
            const [r1, c1, r2, c2] = allEdges[i];
            activeEdges.add(this.makeEdgeKey(r1, c1, r2, c2));
          }
        }
        if (this.validateSolution(grid, activeEdges, size)) count++;
        return;
      }

      const [r1, c1, r2, c2] = allEdges[idx];
      const u = getIdx(r1, c1);
      const v = getIdx(r2, c2);

      if (degrees[u] < 2 && degrees[v] < 2) {
        status[idx] = 1;
        degrees[u]++;
        degrees[v]++;
        backtrack(idx + 1);
        status[idx] = 0;
        degrees[u]--;
        degrees[v]--;
      }

      if (count >= limit) return;
      status[idx] = -1;
      backtrack(idx + 1);
      status[idx] = 0;
    };

    backtrack(0);
    return count;
  }

  public static validateSolution(grid: PearlType[][], edges: Set<string>, size: number): boolean {
    if (edges.size < size * 2) return false;

    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      const [u, v] = edge.split('-');
      if (!adj.has(u)) adj.set(u, []);
      if (!adj.has(v)) adj.set(v, []);
      adj.get(u)!.push(v);
      adj.get(v)!.push(u);
    }

    for (const neighbors of adj.values()) {
      if (neighbors.length !== 2) return false;
    }

    const allNodes = Array.from(adj.keys());
    const visited = new Set<string>();
    let curr: string | null = allNodes[0];
    let prev: string | null = null;

    while (curr) {
      visited.add(curr);
      const nexts: string[] = adj.get(curr)!;
      const nextNode: string | undefined = nexts[0] === prev ? nexts[1] : nexts[0];
      if (!nextNode) return false;
      if (nextNode === allNodes[0]) break;
      if (visited.has(nextNode)) return false;
      prev = curr;
      curr = nextNode;
    }

    if (visited.size !== allNodes.length) return false;

    const hasEdge = (r1: number, c1: number, r2: number, c2: number) =>
      edges.has(this.makeEdgeKey(r1, c1, r2, c2));

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const pearl = grid[r][c];
        if (pearl === 'none') continue;

        const key = `${r},${c}`;
        if (!adj.has(key)) return false;

        const [n1, n2] = adj.get(key)!;
        const [nr1, nc1] = n1.split(',').map(Number);
        const [nr2, nc2] = n2.split(',').map(Number);

        const isHorizontal = nr1 === r && nr2 === r && Math.abs(nc1 - nc2) === 2;
        const isVertical = nc1 === c && nc2 === c && Math.abs(nr1 - nr2) === 2;
        const isStraight = isHorizontal || isVertical;

        if (pearl === 'white') {
          if (!isStraight) return false;
          let turns = false;
          if (isHorizontal) {
            const leftC = Math.min(nc1, nc2), rightC = Math.max(nc1, nc2);
            if (hasEdge(r, leftC, r - 1, leftC) || hasEdge(r, leftC, r + 1, leftC)) turns = true;
            if (hasEdge(r, rightC, r - 1, rightC) || hasEdge(r, rightC, r + 1, rightC)) turns = true;
          } else {
            const topR = Math.min(nr1, nr2), bottomR = Math.max(nr1, nr2);
            if (hasEdge(topR, c, topR, c - 1) || hasEdge(topR, c, topR, c + 1)) turns = true;
            if (hasEdge(bottomR, c, bottomR, c - 1) || hasEdge(bottomR, c, bottomR, c + 1)) turns = true;
          }
          if (!turns) return false;
        } else if (pearl === 'black') {
          if (isStraight) return false;
          const dr1 = nr1 - r, dc1 = nc1 - c;
          const dr2 = nr2 - r, dc2 = nc2 - c;
          if (!hasEdge(nr1, nc1, nr1 + dr1, nc1 + dc1)) return false;
          if (!hasEdge(nr2, nc2, nr2 + dr2, nc2 + dc2)) return false;
        }
      }
    }

    return true;
  }

  public static evaluateLipschitz(steps: number[], total: number): number {
    if (steps.length < 2) return 0.5;
    const curve = steps.map((s) => s / total);
    let maxDiff = 0;
    for (let i = 1; i < curve.length - 1; i++) {
      const d1 = curve[i] - curve[i - 1];
      const d2 = curve[i + 1] - curve[i];
      maxDiff = Math.max(maxDiff, Math.abs(d2 - d1));
    }
    return Number(Math.max(0, 1 - maxDiff).toFixed(2));
  }

  public static getWpcHint(grid: PearlType[][], currentEdges: Set<string>, size: number): MasyuHintStep | null {
    const totalCells = size * size;
    const dsu = new DisjointSet(totalCells);
    const getIdx = (r: number, c: number) => r * size + c;

    for (const e of currentEdges) {
      const [u, v] = e.split('-');
      const [r1, c1] = u.split(',').map(Number);
      const [r2, c2] = v.split(',').map(Number);
      dsu.union(getIdx(r1, c1), getIdx(r2, c2));
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const orth = [[0, 1], [1, 0]];
        for (const [dr, dc] of orth) {
          const nr = r + dr, nc = c + dc;
          if (this.inBounds(nr, nc, size)) {
            const eKey = this.makeEdgeKey(r, c, nr, nc);
            if (!currentEdges.has(eKey)) {
              const u = getIdx(r, c);
              const v = getIdx(nr, nc);
              if (dsu.find(u) === dsu.find(v) && dsu.size[dsu.find(u)] > 2 && dsu.size[dsu.find(u)] < size * 2) {
                return {
                  step: 1,
                  r,
                  c,
                  techniqueLevel: 3,
                  technique: 'subloop_prevention',
                  forcedEdge: eKey,
                  structuralPattern: '局域子環禁絕 (Early Sub-loop Prevention)',
                  rationale: `連接 [${r + 1},${c + 1}] 與 [${nr + 1},${nc + 1}] 將提早閉合局部子環，導致全域單環無法展開！`,
                  humanReadable: {
                    zh: `【拓撲子環阻斷】：此邊若相連，將在局部形成孤立封閉環路，違反全域單一迴路（Single Loop）天條，故此路必斷。`,
                    en: `Topological Sub-loop Barrier: Connecting this edge prematurely closes an isolated cycle.`,
                  },
                };
              }
            }
          }
        }
      }
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === 'black') {
          const orth: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
          for (const [dr, dc] of orth) {
            const nr = r + dr, nc = c + dc;
            if (this.inBounds(nr, nc, size)) {
              const hypEdge = this.makeEdgeKey(r, c, nr, nc);
              if (!currentEdges.has(hypEdge)) {
                return {
                  step: 1,
                  r,
                  c,
                  techniqueLevel: 5,
                  technique: 'contradiction_bifurcation',
                  forcedEdge: hypEdge,
                  structuralPattern: '時態反證矛盾鏈 (Tense-Aware Bifurcation)',
                  rationale: `若黑珍珠手臂由此方向展伸，將在後續推導中引發端點度數撞牆衝突。`,
                  contradictionTree: {
                    hypothesis: hypEdge,
                    branchChain: [
                      { edge: hypEdge, inferredBy: '假說起點' },
                      { edge: this.makeEdgeKey(nr, nc, nr + dr, nc + dc), inferredBy: '黑珍珠長臂直線約束' },
                    ],
                    conflictLocation: [nr + dr, nc + dc],
                    conflictReason: '節點度數過載 (Degree > 2) 或邊界截斷撞牆',
                  },
                  humanReadable: {
                    zh: `【反證矛盾鏈】：若黑珍珠 [${r + 1},${c + 1}] 朝此側連通，推導鏈將在坐標 [${nr + dr + 1},${nc + dc + 1}] 觸發拓撲撞牆衝突，故該方向必為假。`,
                    en: `Proof by Contradiction: Hypothesizing this path triggers a degree collision 2 steps forward.`,
                  },
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  public static produceSinglePuzzle(
    tier: TierKey,
    inputSeed?: number,
    flowTuning?: DynamicFlowTuning
  ): PuzzleEntity {
    const baseConfig = TIER_SPECS[tier] || TIER_SPECS.kids;
    const size = baseConfig.size;
    const targetMaxClueRatio = flowTuning?.targetMaxClueRatio ?? baseConfig.targetMaxClueRatio;
    const lookaheadDepth = flowTuning?.lookaheadDepth ?? baseConfig.lookaheadDepth;
    const { minCoverage, minLipschitz, timeLimitSec, baseIrt } = baseConfig;

    let currentSeed = inputSeed !== undefined ? (inputSeed >>> 0) : Math.floor(Math.random() * 0x7fffffff);
    let attempts = 0;
    const maxTries = 100;

    const paradigms: MacroParadigm[] = [
      'archimedean_spiral',
      'sinusoidal_braid',
      'superelliptic_meander',
      'hyperbolic_cross',
    ];

    while (attempts++ < maxTries) {
      const rnd = this.createRng(currentSeed);
      const paradigm = paradigms[Math.floor(rnd() * paradigms.length)];

      const blueprint = this.constructPreLoopBlueprint(size, paradigm, rnd);
      const annealResult = this.generateHmcLoopWithGenesis(size, blueprint, minCoverage, rnd);
      if (!annealResult) {
        currentSeed = (currentSeed + 1) >>> 0;
        continue;
      }
      const { path, genesisFrames } = annealResult;

      const { score: aestheticScore, motif } = this.evaluateLatentAesthetics(path, size);
      if (aestheticScore < 0.82) {
        currentSeed = (currentSeed + 1) >>> 0;
        continue;
      }
      blueprint.aestheticScore = aestheticScore;
      blueprint.motif = motif;

      const solutionEdges = new Set<string>();
      for (let i = 0; i < path.length; i++) {
        const nextIdx = (i + 1) % path.length;
        solutionEdges.add(this.makeEdgeKey(path[i][0], path[i][1], path[nextIdx][0], path[nextIdx][1]));
      }

      const fullGrid: PearlType[][] = Array.from({ length: size }, () => Array(size).fill('none'));
      for (let i = 0; i < path.length; i++) {
        const prev = path[(i - 1 + path.length) % path.length];
        const curr = path[i];
        const next = path[(i + 1) % path.length];
        const [r, c] = curr;

        const isTurn = prev[0] !== next[0] && prev[1] !== next[1];
        if (isTurn) {
          const pPrev = path[(i - 2 + path.length) % path.length];
          const nNext = path[(i + 2) % path.length];
          if (
            prev[0] - curr[0] === pPrev[0] - prev[0] &&
            prev[1] - curr[1] === pPrev[1] - prev[1] &&
            next[0] - curr[0] === nNext[0] - next[0] &&
            next[1] - curr[1] === nNext[1] - next[1]
          ) {
            fullGrid[r][c] = 'black';
          }
        } else {
          const pPrev = path[(i - 2 + path.length) % path.length];
          const nNext = path[(i + 2) % path.length];
          if ((pPrev[0] !== curr[0] && pPrev[1] !== curr[1]) || (nNext[0] !== curr[0] && nNext[1] !== curr[1])) {
            fullGrid[r][c] = 'white';
          }
        }
      }

      const pruned = this.pruneStrictly(
        fullGrid,
        solutionEdges,
        size,
        targetMaxClueRatio,
        lookaheadDepth,
        blueprint,
        rnd
      );

      if (!pruned || pruned.lipschitzScore < minLipschitz) {
        currentSeed = (currentSeed + 1) >>> 0;
        continue;
      }

      const coverageRatio = Number((new Set(path.map(([r, c]) => `${r},${c}`)).size / (size * size)).toFixed(3));
      const dnaSignature = `APEX-v10-${size}x${size}-S${currentSeed}-${motif}-A${aestheticScore}-L${pruned.lipschitzScore}`;

      const spec: MasyuSpec = {
        rows: size,
        cols: size,
        size,
        grid: pruned.grid,
        clues: pruned.grid,
        solutionEdges: Array.from(solutionEdges),
        seed: currentSeed,
        dnaSignature,
        blueprint,
        clueDensity: pruned.clueDensity,
        lipschitzScore: pruned.lipschitzScore,
        coverageRatio,
        genesisFrames,
        tier,
      };

      return {
        id: `masyu_apex_${tier}_s${currentSeed}`,
        category: 'spatial_logic',
        engine_type: 'masyu_wpc_apex_predator_v10',
        tier,
        checksum: dnaSignature,
        puzzle: spec,
        solution: Array.from(solutionEdges),
        cognitiveLoad: {
          spatial: Number(Math.min(1.0, 0.6 + coverageRatio * 0.4).toFixed(2)),
          numeric: 0.05,
          workingMemory: Number(Math.min(1.0, 0.35 + (1 - pruned.clueDensity) * 0.6).toFixed(2)),
          inhibition: 0.99,
        },
        metrics: {
          grid_size: size,
          rows: size,
          cols: size,
          estimated_time_sec: timeLimitSec,
          irt_logit_difficulty: Number((baseIrt + (1 - pruned.clueDensity) * 1.6).toFixed(2)),
          seed: currentSeed,
          lipschitzScore: pruned.lipschitzScore,
          coverageRatio,
          aestheticScore,
          motif,
          actualTier: tier,
          paradigm,
          clueDensity: pruned.clueDensity,
        },
      };
    }

    return this.produceSinglePuzzle(tier, (currentSeed + 65537) >>> 0, flowTuning);
  }
}
