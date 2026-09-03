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
  fixedCoord: number;
  minVar: number;
  maxVar: number;
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

      const solutionCount = this._countSolutionsRigorous(islands, potentialEdges);
      if (solutionCount !== 1) {
        continue;
      }

      const hints = this._buildHintLadder(islands, potentialEdges, solutionBridges);

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

  private static _countSolutionsRigorous(islands: HashiIsland[], edges: PotentialEdge[]): number {
    let solutions = 0;
    const nIslands = islands.length;
    const nEdges = edges.length;
    const remainingCapacity = new Int8Array(nIslands);
    for (let i = 0; i < nIslands; i++) remainingCapacity[i] = islands[i].expectedCount;

    const assignedCount = new Int8Array(nEdges);
    const edgeIncident = edges.map((e) => [e.u, e.v] as [number, number]);

    const conflictEdges = Array.from({ length: nEdges }, () => [] as number[]);
    for (let i = 0; i < nEdges; i++) {
      for (let j = i + 1; j < nEdges; j++) {
        const e1 = edges[i];
        const e2 = edges[j];
        if (e1.isHoriz !== e2.isHoriz) {
          const h = e1.isHoriz ? e1 : e2;
          const v = e1.isHoriz ? e2 : e1;
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

    const isEdgeAssigned = new Uint8Array(nEdges);
    const activeBridgeConflicts = new Int8Array(nEdges);

    const isSingleComponent = (): boolean => {
      const adj = Array.from({ length: nIslands }, () => [] as number[]);
      for (let e = 0; e < nEdges; e++) {
        if (assignedCount[e] > 0) {
          const [u, v] = edgeIncident[e];
          adj[u].push(v);
          adj[v].push(u);
        }
      }

      let visitedCount = 0;
      const visited = new Uint8Array(nIslands);
      const queue = [0];
      visited[0] = 1;

      while (queue.length > 0) {
        const curr = queue.shift()!;
        visitedCount++;
        for (const neighbor of adj[curr]) {
          if (!visited[neighbor]) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }

      return visitedCount === nIslands;
    };

    const solve = () => {
      if (solutions >= 2) return;

      let allSatisfied = true;
      for (let i = 0; i < nIslands; i++) {
        if (remainingCapacity[i] !== 0) {
          allSatisfied = false;
          break;
        }
      }

      if (allSatisfied) {
        if (isSingleComponent()) {
          solutions++;
        }
        return;
      }

      let bestIsland = -1;
      let minUnassignedEdges = 999;

      for (let i = 0; i < nIslands; i++) {
        const remCap = remainingCapacity[i];
        if (remCap <= 0) continue;

        let unassignedEdges = 0;
        let potentialCapacity = 0;

        for (const eId of islandEdges[i]) {
          if (!isEdgeAssigned[eId] && activeBridgeConflicts[eId] === 0) {
            const other = edgeIncident[eId][0] === i ? edgeIncident[eId][1] : edgeIncident[eId][0];
            if (remainingCapacity[other] > 0) {
              potentialCapacity += 2;
              unassignedEdges++;
            }
          }
        }

        if (potentialCapacity < remCap) return;

        if (unassignedEdges < minUnassignedEdges && unassignedEdges > 0) {
          minUnassignedEdges = unassignedEdges;
          bestIsland = i;
        }
      }

      if (bestIsland === -1) return;

      let targetEdgeId = -1;
      for (const eId of islandEdges[bestIsland]) {
        if (!isEdgeAssigned[eId] && activeBridgeConflicts[eId] === 0) {
          targetEdgeId = eId;
          break;
        }
      }
      if (targetEdgeId === -1) return;

      const [u, v] = edgeIncident[targetEdgeId];
      const maxBridges = Math.min(2, remainingCapacity[u], remainingCapacity[v]);

      isEdgeAssigned[targetEdgeId] = 1;

      for (let count = maxBridges; count >= 0; count--) {
        assignedCount[targetEdgeId] = count;
        remainingCapacity[u] -= count;
        remainingCapacity[v] -= count;

        if (count > 0) {
          for (const conf of conflictEdges[targetEdgeId]) {
            activeBridgeConflicts[conf]++;
          }
        }

        solve();

        if (count > 0) {
          for (const conf of conflictEdges[targetEdgeId]) {
            activeBridgeConflicts[conf]--;
          }
        }

        remainingCapacity[u] += count;
        remainingCapacity[v] += count;
        assignedCount[targetEdgeId] = 0;

        if (solutions >= 2) break;
      }

      isEdgeAssigned[targetEdgeId] = 0;
    };

    solve();
    return solutions;
  }

  private static _buildHintLadder(
    islands: HashiIsland[],
    edges: PotentialEdge[],
    solution: HashiBridge[]
  ): HashiHintStep[] {
    const hints: HashiHintStep[] = [];

    for (const isl of islands) {
      const incidentEdges = edges.filter((e) => e.u === isl.id || e.v === isl.id);
      const solIncident = solution.filter((b) => b.fromId === isl.id || b.toId === isl.id);
      const dirCount = incidentEdges.length;

      if (dirCount > 0 && isl.expectedCount === dirCount * 2) {
        const targetBridge = solIncident[0];
        const neighborId = targetBridge.fromId === isl.id ? targetBridge.toId : targetBridge.fromId;
        const neighbor = islands.find((i) => i.id === neighborId)!;

        hints.push({
          level: 1,
          targetIslandId: isl.id,
          messageZh: `島嶼 (${isl.x + 1}, ${isl.y + 1}) 數字為 ${isl.expectedCount}，周圍僅有 ${dirCount} 個延伸方向。因每方向最多容納 2 條橋，所有方向已達完全飽和。`,
          messageEn: `Island at (${isl.x + 1}, ${isl.y + 1}) demands ${isl.expectedCount} bridges with only ${dirCount} branch(es). Since max capacity is 2 per branch, all directions are fully saturated.`,
        });

        hints.push({
          level: 2,
          targetIslandId: isl.id,
          neighborIslandId: neighborId,
          messageZh: `基於全方向飽和定理：通往島嶼 (${neighbor.x + 1}, ${neighbor.y + 1}) 的分支必然架設 2 條雙橋。`,
          messageEn: `By saturation theorem: the connection to island (${neighbor.x + 1}, ${neighbor.y + 1}) is mathematically forced to have 2 bridges.`,
        });

        hints.push({
          level: 3,
          targetIslandId: isl.id,
          neighborIslandId: neighborId,
          bridgeCount: 2,
          messageZh: `👉 請親自落子確認：點選島嶼 (${isl.x + 1}, ${isl.y + 1}) 與 (${neighbor.x + 1}, ${neighbor.y + 1})，手動架設 2 條雙橋。`,
          messageEn: `👉 Action: Tap island (${isl.x + 1}, ${isl.y + 1}) and (${neighbor.x + 1}, ${neighbor.y + 1}) to manually place 2 bridges.`,
        });
        return hints;
      }
    }

    for (const isl of islands) {
      const incidentEdges = edges.filter((e) => e.u === isl.id || e.v === isl.id);
      const solIncident = solution.filter((b) => b.fromId === isl.id || b.toId === isl.id);
      const dirCount = incidentEdges.length;

      if (dirCount === 2 && isl.expectedCount === 3 && solIncident.length >= 2) {
        const targetBridge = solIncident[0];
        const neighborId = targetBridge.fromId === isl.id ? targetBridge.toId : targetBridge.fromId;
        const neighbor = islands.find((i) => i.id === neighborId)!;

        hints.push({
          level: 1,
          targetIslandId: isl.id,
          messageZh: `島嶼 (${isl.x + 1}, ${isl.y + 1}) 數字為 3，但僅有 2 個方向可延伸。單一方向最多僅能分擔 2 條橋，任一方向皆不能為 0。`,
          messageEn: `Island at (${isl.x + 1}, ${isl.y + 1}) requires 3 bridges across only 2 directions. Neither branch can be empty.`,
        });

        hints.push({
          level: 2,
          targetIslandId: isl.id,
          neighborIslandId: neighborId,
          messageZh: `由鴿巢原理：兩方向各自分配的橋數必定至少保底 1 條（1+2=3）。`,
          messageEn: `By Pigeonhole Principle: each branch is guaranteed to carry at least 1 bridge (1+2=3).`,
        });

        hints.push({
          level: 3,
          targetIslandId: isl.id,
          neighborIslandId: neighborId,
          bridgeCount: 1,
          messageZh: `👉 請親自落子確認：點選這兩座島嶼，手動架設至少 1 條保底單橋。`,
          messageEn: `👉 Action: Tap these two islands to manually place the guaranteed single bridge.`,
        });
        return hints;
      }
    }

    if (solution.length > 0) {
      const firstBridge = solution[0];
      const islA = islands.find((i) => i.id === firstBridge.fromId)!;
      const islB = islands.find((i) => i.id === firstBridge.toId)!;
      hints.push({
        level: 1,
        targetIslandId: islA.id,
        messageZh: `檢視島嶼 (${islA.x + 1}, ${islA.y + 1}) 的度數 ${islA.expectedCount}，周邊分支存在約束收斂。`,
        messageEn: `Inspect degree ${islA.expectedCount} of island (${islA.x + 1}, ${islA.y + 1}); branches are constrained.`,
      });
      hints.push({
        level: 2,
        targetIslandId: islA.id,
        neighborIslandId: islB.id,
        messageZh: `排除互斥交叉與孤島閉環後，此通道必定承擔連接任務。`,
        messageEn: `After eliminating cycle risks and cross collisions, this branch must carry bridge(s).`,
      });
      hints.push({
        level: 3,
        targetIslandId: islA.id,
        neighborIslandId: islB.id,
        bridgeCount: firstBridge.count,
        messageZh: `👉 請親自落子確認：手動架設 ${firstBridge.count} 條橋連通此島嶼對。`,
        messageEn: `👉 Action: Manually place ${firstBridge.count} bridge(s) between these islands.`,
      });
    }

    return hints;
  }

  private static _createFallback(tier: TierKey, size: number): PuzzleEntity {
    const id = `hashi_sym_fb_${tier}_${Date.now()}`;
    const islands: HashiIsland[] = [
      { id: 0, x: 1, y: 1, expectedCount: 2 },
      { id: 1, x: 1, y: size - 2, expectedCount: 2 },
      { id: 2, x: size - 2, y: 1, expectedCount: 2 },
      { id: 3, x: size - 2, y: size - 2, expectedCount: 2 },
    ];
    return {
      id,
      category: ('topological' as any),
      engine_type: 'hashi',
      tier,
      puzzle: {
        size,
        islands,
        hints: [
          { level: 1, targetIslandId: 0, messageZh: '角落島嶼僅有 2 個直角方向可供延伸。', messageEn: 'Corner islands have only 2 orthogonal branches.' },
          { level: 2, targetIslandId: 0, neighborIslandId: 1, messageZh: '度數為 2 且需全域連通，每個方向各需 1 條橋。', messageEn: 'Degree is 2 with global spanning; each branch needs 1 bridge.' },
          { level: 3, targetIslandId: 0, neighborIslandId: 1, bridgeCount: 1, messageZh: '👉 請親自手動架設 1 條橋樑。', messageEn: '👉 Action Required: Manually place 1 bridge.' },
        ],
      } as any,
      solution: [
        { fromId: 0, toId: 1, count: 1 },
        { fromId: 0, toId: 2, count: 1 },
        { fromId: 1, toId: 3, count: 1 },
        { fromId: 2, toId: 3, count: 1 },
      ] as any,
      metrics: {
        grid_size: size,
        island_count: 4,
        bridge_count: 4,
        irt_logit_difficulty: -1.2,
        estimated_time_sec: 90,
      } as any,
      cognitiveLoad: { spatial: 0.5, numeric: 0.4, workingMemory: 0.5, inhibition: 0.6 },
      checksum: `fb_sym_${id}`,
    };
  }
}
