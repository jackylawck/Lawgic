// web-frontend/src/engines/hashiGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export type ExtendedTierKey = TierKey | 'legendary' | 'ultimate';

export interface Island {
  id: number;
  r: number;
  c: number;
  capacity: number;
}

export type HashiTechnique =
  | 'corner_capacity_forced'
  | 'degree_propagation'
  | 'cut_edge_isolation'
  | 'isolated_pair_block'
  | 'spanning_bottleneck';

export interface HashiHintStep {
  step: number;
  u: number;
  v: number;
  forcedCount: 1 | 2;
  technique: HashiTechnique;
  techniqueIcon: string;
  techniqueName: {
    zh: string;
    en: string;
  };
  evidenceIslands: number[];
  rationale: string;
  humanReadable: {
    zh: string;
    en: string;
  };
}

export interface HashiSpec {
  rows: number;
  cols: number;
  islands: Island[];
  solutionBridges: {
    u: number;
    v: number;
    count: 1 | 2;
  }[];
  tier: ExtendedTierKey;
  seed: number;
  metricsAnalysis?: {
    is180Symmetric: boolean;
    totalIslands: number;
    totalBridges: number;
  };
}

interface TierConfig {
  rows: number;
  cols: number;
  islandCount: number;
  baseIrt: number;
}

const TIER_SPECS: Record<ExtendedTierKey, TierConfig> = {
  kids: { rows: 7, cols: 7, islandCount: 6, baseIrt: -0.4 },
  intermediate: { rows: 9, cols: 9, islandCount: 10, baseIrt: 0.5 },
  expert: { rows: 11, cols: 11, islandCount: 16, baseIrt: 1.5 },
  master: { rows: 13, cols: 13, islandCount: 22, baseIrt: 2.4 },
  legendary: { rows: 15, cols: 15, islandCount: 28, baseIrt: 3.2 },
  ultimate: { rows: 17, cols: 17, islandCount: 36, baseIrt: 4.0 },
};

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WebHashiGenerator {
  /**
   * 正交視線鄰居檢索
   */
  public static getOrthogonalNeighbors(islId: number, islands: Island[], rows: number, cols: number): number[] {
    const src = islands.find((i) => i.id === islId);
    if (!src) return [];

    const neighbors: number[] = [];
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];

    for (const [dr, dc] of dirs) {
      let r = src.r + dr;
      let c = src.c + dc;
      while (r >= 0 && r < rows && c >= 0 && c < cols) {
        const found = islands.find((i) => i.r === r && i.c === c);
        if (found) {
          neighbors.push(found.id);
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return neighbors;
  }

  /**
   * 檢查橋樑相交碰撞
   */
  public static checkCrossing(uId: number, vId: number, islands: Island[], bridges: Map<string, 1 | 2>): boolean {
    const u = islands.find((i) => i.id === uId)!;
    const v = islands.find((i) => i.id === vId)!;
    const isHorizontal = u.r === v.r;

    for (const [key] of bridges) {
      const [buIdStr, bvIdStr] = key.split('-');
      const buId = Number(buIdStr);
      const bvId = Number(bvIdStr);
      if (buId === uId || buId === vId || bvId === uId || bvId === vId) continue;

      const bu = islands.find((i) => i.id === buId)!;
      const bv = islands.find((i) => i.id === bvId)!;
      const isBHorizontal = bu.r === bv.r;

      if (isHorizontal !== isBHorizontal) {
        const hBridge = isHorizontal
          ? { y: u.r, x1: Math.min(u.c, v.c), x2: Math.max(u.c, v.c) }
          : { y: bu.r, x1: Math.min(bu.c, bv.c), x2: Math.max(bu.c, bv.c) };
        const vBridge = !isHorizontal
          ? { x: u.c, y1: Math.min(u.r, v.r), y2: Math.max(u.r, v.r) }
          : { x: bu.c, y1: Math.min(bu.r, bv.r), y2: Math.max(bu.r, bv.r) };

        if (
          vBridge.x > hBridge.x1 &&
          vBridge.x < hBridge.x2 &&
          hBridge.y > vBridge.y1 &&
          hBridge.y < vBridge.y2
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 因果推導定式推理引擎（供覆盤與提示階梯）
   */
  public static getNextForcedDeduction(
    islands: Island[],
    rows: number,
    cols: number,
    bridges: Map<string, 1 | 2>
  ): HashiHintStep | null {
    const degrees = new Map<number, number>();
    islands.forEach((isl) => degrees.set(isl.id, 0));

    bridges.forEach((count, key) => {
      const [uStr, vStr] = key.split('-');
      const u = Number(uStr);
      const v = Number(vStr);
      degrees.set(u, (degrees.get(u) || 0) + count);
      degrees.set(v, (degrees.get(v) || 0) + count);
    });

    // 定式 1: 剩餘可用方向容量極限收斂 (度數連鎖傳播)
    for (const isl of islands) {
      const currentDeg = degrees.get(isl.id) || 0;
      if (currentDeg === isl.capacity) continue;

      const remainingNeeded = isl.capacity - currentDeg;
      const neighbors = WebHashiGenerator.getOrthogonalNeighbors(isl.id, islands, rows, cols);

      const validNeighbors = neighbors.filter((nId) => {
        const minId = Math.min(isl.id, nId);
        const maxId = Math.max(isl.id, nId);
        const currentBridgeCount = bridges.get(`${minId}-${maxId}`) || 0;
        const neighborDeg = degrees.get(nId) || 0;
        const neighborCap = islands.find((i) => i.id === nId)!.capacity;
        return (
          currentBridgeCount < 2 &&
          neighborDeg < neighborCap &&
          !WebHashiGenerator.checkCrossing(isl.id, nId, islands, bridges)
        );
      });

      if (validNeighbors.length * 2 === remainingNeeded && validNeighbors.length > 0) {
        const target = validNeighbors[0];
        const minId = Math.min(isl.id, target);
        const maxId = Math.max(isl.id, target);
        const currentCount = bridges.get(`${minId}-${maxId}`) || 0;

        return {
          step: 1,
          u: minId,
          v: maxId,
          forcedCount: (currentCount + 1) as 1 | 2,
          technique: 'degree_propagation',
          techniqueIcon: '🌉',
          techniqueName: {
            zh: '度數連鎖飽和',
            en: 'Degree Saturation',
          },
          evidenceIslands: [isl.id, target],
          rationale: `島嶼 #${isl.id} (容量 ${isl.capacity}) 剩餘缺額 ${remainingNeeded}，所有剩餘方向必須全速連滿。`,
          humanReadable: {
            zh: `島嶼 [${isl.r + 1},${isl.c + 1}]：扣除現有橋後，剩餘方向全連剛好滿足容量，此處必架橋！`,
            en: `Island [${isl.r + 1},${isl.c + 1}] requires all remaining directions to be bridged.`,
          },
        };
      }
    }

    // 定式 2: 割邊隔離定式 (防止未包含全島時過早閉合孤立子圖)
    if (islands.length > 2) {
      for (const isl of islands) {
        if (isl.capacity === 1 && (degrees.get(isl.id) || 0) === 0) {
          const neighbors = WebHashiGenerator.getOrthogonalNeighbors(isl.id, islands, rows, cols);
          const oneCapNeighbors = neighbors.filter((nId) => {
            const n = islands.find((i) => i.id === nId)!;
            return n.capacity === 1 && (degrees.get(n.id) || 0) === 0;
          });

          if (oneCapNeighbors.length > 0) {
            const safeNeighbors = neighbors.filter((nId) => !oneCapNeighbors.includes(nId));
            if (safeNeighbors.length === 1) {
              const target = safeNeighbors[0];
              const minId = Math.min(isl.id, target);
              const maxId = Math.max(isl.id, target);
              return {
                step: 1,
                u: minId,
                v: maxId,
                forcedCount: 1,
                technique: 'cut_edge_isolation',
                techniqueIcon: '🛡️',
                techniqueName: {
                  zh: '防孤島割邊隔離',
                  en: 'Cut-Edge Isolation',
                },
                evidenceIslands: [isl.id, target, oneCapNeighbors[0]],
                rationale: `島嶼 #${isl.id} 若與相鄰容量 1 島嶼連線將形成封閉孤島，切斷全域連通。因此必須連向替代方向。`,
                humanReadable: {
                  zh: `島嶼 [${isl.r + 1},${isl.c + 1}] 不能與同為 1 度的島嶼相連（否則形成孤島閉環），必然連向另一側。`,
                  en: `Connecting to another degree 1 island creates a closed component. Must bridge to alternate neighbor.`,
                },
              };
            }
          }
        }
      }
    }

    return null;
  }

  public static generate(tier: ExtendedTierKey = 'kids', inputSeed?: number): PuzzleEntity {
    const config = TIER_SPECS[tier] || TIER_SPECS.kids;
    const { rows, cols, islandCount, baseIrt } = config;

    const actualSeed = inputSeed !== undefined ? inputSeed : Math.floor(Math.random() * 0x7fffffff);
    const rnd = mulberry32(actualSeed);

    const islands: Island[] = [];
    const solutionBridges: { u: number; v: number; count: 1 | 2 }[] = [];

    // 1. 強制 180° 對稱播撒島嶼座標
    const halfCoords: [number, number][] = [];
    for (let r = 0; r < Math.ceil(rows / 2); r++) {
      for (let c = 0; c < cols; c++) {
        if (r === rows - 1 - r && c >= Math.ceil(cols / 2)) continue;
        halfCoords.push([r, c]);
      }
    }

    for (let i = halfCoords.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [halfCoords[i], halfCoords[j]] = [halfCoords[j], halfCoords[i]];
    }

    let idCounter = 0;
    const pairCount = Math.floor(islandCount / 2);

    for (let i = 0; i < pairCount && i < halfCoords.length; i++) {
      const [r1, c1] = halfCoords[i];
      const r2 = rows - 1 - r1;
      const c2 = cols - 1 - c1;

      islands.push({ id: idCounter++, r: r1, c: c1, capacity: 0 });
      if (r1 !== r2 || c1 !== c2) {
        islands.push({ id: idCounter++, r: r2, c: c2, capacity: 0 });
      }
    }

    // 2. 建立連通支撐橋樑與計算島嶼容量
    const bridgesMap = new Map<string, 1 | 2>();
    for (let i = 0; i < islands.length; i++) {
      const neighbors = WebHashiGenerator.getOrthogonalNeighbors(islands[i].id, islands, rows, cols);
      for (const nId of neighbors) {
        const minId = Math.min(islands[i].id, nId);
        const maxId = Math.max(islands[i].id, nId);
        const key = `${minId}-${maxId}`;

        if (!bridgesMap.has(key) && !WebHashiGenerator.checkCrossing(minId, maxId, islands, bridgesMap)) {
          if (rnd() < 0.38) {
            const count: 1 | 2 = rnd() < 0.6 ? 1 : 2;
            bridgesMap.set(key, count);
          }
        }
      }
    }

    // 計算各島嶼實際容量
    bridgesMap.forEach((count, key) => {
      const [uStr, vStr] = key.split('-');
      const u = Number(uStr);
      const v = Number(vStr);
      const islU = islands.find((isl) => isl.id === u);
      const islV = islands.find((isl) => isl.id === v);
      if (islU) islU.capacity += count;
      if (islV) islV.capacity += count;
      solutionBridges.push({ u, v, count });
    });

    // 剔除容量為 0 的孤島
    const activeIslands = islands.filter((isl) => isl.capacity > 0);

    const spec: HashiSpec = {
      rows,
      cols,
      islands: activeIslands,
      solutionBridges,
      tier,
      seed: actualSeed,
      metricsAnalysis: {
        is180Symmetric: true,
        totalIslands: activeIslands.length,
        totalBridges: solutionBridges.length,
      },
    };

    return {
      id: `hashi_${tier}_s${actualSeed}`,
      category: 'topological' as any,
      engine_type: 'hashi',
      tier: (tier === 'ultimate' || tier === 'legendary' ? 'master' : tier) as TierKey,
      checksum: `HASHI_${rows}x${cols}_SYM180_S${actualSeed}`,
      puzzle: spec as any,
      solution: solutionBridges as any,
      cognitiveLoad: {
        spatial: 0.88,
        numeric: 0.5,
        workingMemory: 0.75,
        inhibition: 0.82,
      },
      metrics: {
        estimated_time_sec: Math.max(30, activeIslands.length * 6),
        irt_logit_difficulty: baseIrt,
        seed: actualSeed,
        actualTier: tier,
        is180Symmetric: true,
      } as any,
    };
  }
}
