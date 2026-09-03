// web-frontend/src/engines/hashiGenerator.ts
import { PuzzleEntity, TierKey } from '../generated';

export interface HashiIsland {
  id: number;
  x: number;
  y: number;
  expectedCount: number;
}

export interface HashiBridge {
  fromId: number;
  toId: number;
  count: number;
}

export interface PotentialEdge {
  id: number;
  u: number;
  v: number;
  key: string;
  isHoriz: boolean;
  fixedCoord: number; // 水平線為 y，垂直線為 x
  minVar: number;     // 水平線為 minX，垂直線為 minY
  maxVar: number;     // 水平線為 maxX，垂直線為 maxY
}

export interface HashiHintStep {
  level: 1 | 2 | 3;
  targetIslandId: number;
  neighborIslandId?: number;
  bridgeCount?: number;
  messageZh: string;
  messageEn: string;
}

export class WebHashiGenerator {
  static generate(tier: TierKey): PuzzleEntity {
    const configMap: Record<TierKey, { size: number; pairCount: number; baseIrt: number; timeSec: number; maxRetries: number }> = {
      kids: { size: 7, pairCount: 3, baseIrt: -1.8, timeSec: 80, maxRetries: 24 },
      intermediate: { size: 9, pairCount: 5, baseIrt: -0.2, timeSec: 140, maxRetries: 36 },
      expert: { size: 11, pairCount: 8, baseIrt: 1.3, timeSec: 230, maxRetries: 48 },
      master: { size: 13, pairCount: 11, baseIrt: 2.4, timeSec: 350, maxRetries: 64 },
    };

    const config = configMap[tier] || configMap.intermediate;
    const { size, pairCount, maxRetries } = config;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const generated = this._buildSymmetricConnectedNetwork(size, pairCount);
      if (!generated) continue;

      const { islands, solutionBridges } = generated;
      const potentialEdges = this._findPotentialEdges(islands);

      // 嚴謹 MRV 唯一解驗證（納入全域連通分量與正交防交叉）
      const solutionCount = this._countSolutionsRigorous(islands, potentialEdges);
      if (solutionCount !== 1) {
        continue;
      }

      // 生成具備嚴格因果邏輯鏈的提示階梯
      const hints = this._buildHintLadder(islands, potentialEdges, solutionBridges);

      // 動態合成 IRT Logit 難度與認知負荷
      const bridgeCount = solutionBridges.reduce((acc, b) => acc + b.count, 0);
      const avgDegree = (bridgeCount * 2) / islands.length;
      const edgeDensity = potentialEdges.length / islands.length;
      const dynamicIrt = Number((config.baseIrt + (edgeDensity - 1.5) * 0.4 + (avgDegree - 2.5) * 0.2).toFixed(2));

      const spatialLoad = Number(Math.min(0.98, (tier === 'kids' ? 0.45 : 0.75) + edgeDensity * 0.08).toFixed(2));
      const workingMemory = Number(Math.min(0.95, (tier === 'kids' ? 0.40 : 0.70) + (islands.length / 25) * 0.25).toFixed(2));
      const inhibition = Number(Math.min(0.95, 0.55 + (tier === 'master' ? 0.35 : 0.20)).toFixed(2));

      const id = `hashi_${tier}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      return {
        id,
        category: ('topological' as any),
        engine_type: 'hashi',
        tier,
        puzzle: {
          size,
          islands,
          symmetry: 'rotational_180',
          hints,
        } as any,
        solution: solutionBridges as any,
        metrics: {
          grid_size: size,
          island_count: islands.length,
          bridge_count: bridgeCount,
          irt_logit_difficulty: dynamicIrt,
          estimated_time_sec: config.timeSec,
          symmetry: '180_degree_point_reflection',
          average_degree: Number(avgDegree.toFixed(2)),
          potential_edges_count: potentialEdges.length,
        } as any,
        cognitiveLoad: {
          spatial: spatialLoad,
          numeric: 0.45,
          workingMemory,
          inhibition,
        },
        checksum: `hashi_art_${id}`,
      };
    }

    return this._createFallback(tier, size);
  }

  /**
   * 構建保證全域連通的 180° 對稱網格
   */
  private static _buildSymmetricConnectedNetwork(
    size: number,
    pairCount: number
  ): { islands: HashiIsland[]; solutionBridges: HashiBridge[] } | null {
    const occupied = new Set<string>();
    const islands: HashiIsland[] = [];
    const bridges: HashiBridge[] = [];

    const addIslandPair = (x: number, y: number): boolean => {
      const symX = size - 1 - x;
      const symY = size - 1 - y;
      const key1 = `${x},${y}`;
      const key2 = `${symX},${symY}`;

      if (occupied.has(key1) || occupied.has(key2)) return false;

      occupied.add(key1);
      occupied.add(key2);

      const id1 = islands.length;
      islands.push({ id: id1, x, y, expectedCount: 0 });

      if (key1 !== key2) {
        const id2 = islands.length;
        islands.push({ id: id2, x: symX, y: symY, expectedCount: 0 });
      }
      return true;
    };

    const startX = 1 + Math.floor(Math.random() * (Math.floor(size / 2) - 1));
    const startY = 1 + Math.floor(Math.random() * (size - 2));
    addIslandPair(startX, startY);

    const dirs = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ];

    let attempts = 0;
    const maxSteps = pairCount * 30;

    while (islands.length < pairCount * 2 && attempts < maxSteps) {
      attempts++;
      const source = islands[Math.floor(Math.random() * islands.length)];
      const [dx, dy] = dirs[Math.floor(Math.random() * dirs.length)];
      const dist = 2 + Math.floor(Math.random() * 2);

      const nx = source.x + dx * dist;
      const ny = source.y + dy * dist;

      if (nx < 1 || nx >= size - 1 || ny < 1 || ny >= size - 1) continue;

      const symNX = size - 1 - nx;
      const symNY = size - 1 - ny;
      if (occupied.has(`${nx},${ny}`) || occupied.has(`${symNX},${symNY}`)) continue;

      let blocked = false;
      for (let s = 1; s < dist; s++) {
        const px = source.x + dx * s;
        const py = source.y + dy * s;
        if (occupied.has(`${px},${py}`) || occupied.has(`${size - 1 - px},${size - 1 - py}`)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const sourceSym = islands.find((i) => i.x === size - 1 - source.x && i.y === size - 1 - source.y);
      if (!sourceSym) continue;

      const prevCount = islands.length;
      if (!addIslandPair(nx, ny)) continue;

      const newId1 = prevCount;
      const newId2 = islands.length - 1;

      const bridgeCount = Math.random() < 0.35 ? 2 : 1;
      bridges.push({ fromId: source.id, toId: newId1, count: bridgeCount });
      if (newId1 !== newId2 && source.id !== sourceSym.id) {
        bridges.push({ fromId: sourceSym.id, toId: newId2, count: bridgeCount });
      }
    }

    if (islands.length < pairCount * 1.5) return null;

    // 計算各島嶼預期度數
    islands.forEach((isl) => {
      let total = 0;
      bridges.forEach((b) => {
        if (b.fromId === isl.id || b.toId === isl.id) {
          total += b.count;
        }
      });
      isl.expectedCount = total;
    });

    return { islands, solutionBridges: bridges };
  }

  private static _findPotentialEdges(islands: HashiIsland[]): PotentialEdge[] {
    const edges: PotentialEdge[] = [];
    const n = islands.length;
    let edgeId = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const u = islands[i];
        const v = islands[j];
        if (u.x !== v.x && u.y !== v.y) continue;

        let blocked = false;
        const isHoriz = u.y === v.y;

        if (!isHoriz) {
          const minY = Math.min(u.y, v.y);
          const maxY = Math.max(u.y, v.y);
          for (let k = 0; k < n; k++) {
            if (k !== i && k !== j && islands[k].x === u.x && islands[k].y > minY && islands[k].y < maxY) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            edges.push({
              id: edgeId++,
              u: u.id,
              v: v.id,
              key: `${Math.min(u.id, v.id)}_${Math.max(u.id, v.id)}`,
              isHoriz: false,
              fixedCoord: u.x,
              minVar: minY,
              maxVar: maxY,
            });
          }
        } else {
          const minX = Math.min(u.x, v.x);
          const maxX = Math.max(u.x, v.x);
          for (let k = 0; k < n; k++) {
            if (k !== i && k !== j && islands[k].y === u.y && islands[k].x > minX && islands[k].x < maxX) {
              blocked = true;
              break;
            }
          }
          if (!blocked) {
            edges.push({
              id: edgeId++,
              u: u.id,
              v: v.id,
              key: `${Math.min(u.id, v.id)}_${Math.max(u.id, v.id)}`,
              isHoriz: true,
              fixedCoord: u.y,
              minVar: minX,
              maxVar: maxX,
            });
          }
        }
      }
    }
    return edges;
  }

  /**
   * 嚴謹求解計數器：包含正交防交叉矩陣與全域連通分量（Single Spanning Component）檢驗
   */
  private static _countSolutionsRigorous(islands: HashiIsland[], edges: PotentialEdge[]): number {
    let solutions = 0;
    const nIslands = islands.length;
    const nEdges = edges.length;
    const remainingCapacity = new Int8Array(nIslands);
    for (let i = 0; i < nIslands; i++) remainingCapacity[i] = islands[i].expectedCount;

    const assignedCount = new Int8Array(nEdges);
    const edgeIncident = edges.map((e) => [e.u, e.v] as [number, number]);

    // 預先構建正交交叉互斥邊集合
    const conflictEdges = Array.from({ length: nEdges }, () => [] as number[]);
    for (let i = 0; i < nEdges; i++) {
      for (let j = i + 1; j < nEdges; j++) {
        const e1 = edges[i];
        const e2 = edges[j];
        if (e1.isHoriz !== e2.isHoriz) {
          const h = e1.isHoriz ? e1 : e2;
          const v = e1.isHoriz ? e2 : e1;
          // 判斷是否正交相交
          if (v.fixedCoord > h.minVar && v.fixedCoord < h.maxVar && h.fixedCoord > v.minVar && h.fixedCoord < v.maxVar) {
            conflictEdges[i].push(j);
            conflictEdges[j].push(i);
          }
        }
      }
    }

    const islandEdges = Array.from({ length: nIslands }, () => [] as number[]);
    edges.forEach((e) => {
      islandEdges[e.u].push(e.id);
      islandEdges[e.v].push(e.id);
    });

    const isEdgeAssigned =
