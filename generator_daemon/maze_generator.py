import json
import random
import hashlib
from collections import deque
from typing import List, Dict, Any

TIERS = {
    'kids': {'size': 11, 'loops': 0, 'load': {'spatial': 0.4, 'numeric': 0.0, 'workingMemory': 0.3, 'inhibition': 0.2}},
    'intermediate': {'size': 15, 'loops': 2, 'load': {'spatial': 0.6, 'numeric': 0.0, 'workingMemory': 0.5, 'inhibition': 0.4}},
    'expert': {'size': 21, 'loops': 5, 'load': {'spatial': 0.85, 'numeric': 0.0, 'workingMemory': 0.75, 'inhibition': 0.65}},
    'master': {'size': 27, 'loops': 8, 'load': {'spatial': 1.0, 'numeric': 0.0, 'workingMemory': 0.9, 'inhibition': 0.85}}
}

def bfs_solve(grid: List[List[int]], n: int, start: List[int], end: List[int]) -> List[List[int]]:
    queue = deque([[start]])
    visited = {f"{start[0]},{start[1]}"}
    while queue:
        path = queue.popleft()
        cr, cc = path[-1]
        if cr == end[0] and cc == end[1]:
            return path
        for dr, dc in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
            nr, nc = cr + dr, cc + dc
            if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0:
                k = f"{nr},{nc}"
                if k not in visited:
                    visited.add(k)
                    queue.append(path + [[nr, nc]])
    return []

def generate_single_maze(tier: str, index: int) -> Dict[str, Any]:
    cfg = TIERS[tier]
    n = cfg['size']
    if n % 2 == 0:
        n += 1

    # 1 代表牆壁，0 代表通路
    grid = [[1 for _ in range(n)] for _ in range(n)]

    def in_bounds(r: int, c: int) -> bool:
        return 1 <= r < n - 1 and 1 <= c < n - 1

    # Randomized DFS 演算法生成主迷宮
    start_r, start_c = 1, 1
    grid[start_r][start_c] = 0
    stack = [(start_r, start_c)]
    directions = [(-2, 0), (2, 0), (0, -2), (0, 2)]

    while stack:
        cr, cc = stack[-1]
        neighbors = []
        for dr, dc in directions:
            nr, nc = cr + dr, cc + dc
            if in_bounds(nr, nc) and grid[nr][nc] == 1:
                neighbors.append((dr, dc, nr, nc))

        if neighbors:
            dr, dc, nr, nc = random.choice(neighbors)
            grid[cr + dr // 2][cc + dc // 2] = 0
            grid[nr][nc] = 0
            stack.append((nr, nc))
        else:
            stack.pop()

    # 起點與終點設定
    start = [1, 1]
    end = [n - 2, n - 2]
    grid[start[0]][start[1]] = 0
    grid[end[0]][end[1]] = 0

    # 終點打通保證：確保終點必定連回主迷宮
    if grid[end[0] - 1][end[1]] == 1 and grid[end[0]][end[1] - 1] == 1:
        grid[end[0] - 1][end[1]] = 0

    # 注入長距離環路
    for _ in range(cfg['loops']):
        wr = random.randrange(2, n - 2, 2)
        wc = random.randrange(1, n - 1, 2)
        grid[wr][wc] = 0

    # 計算最短路徑
    solution = bfs_solve(grid, n, start, end)
    if not solution:
        # 若仍有孤立阻隔，強行打通終點周圍兩格並重新求解
        grid[end[0]][end[1] - 1] = 0
        grid[end[0] - 1][end[1]] = 0
        solution = bfs_solve(grid, n, start, end)

    content_str = f"maze-{tier}-{index}-{n}-{json.dumps(grid)}"
    checksum = hashlib.sha256(content_str.encode('utf-8')).hexdigest()[:12]

    return {
        "id": f"maze-{tier}-{index + 1:02d}",
        "category": "topological",
        "engineType": "maze",
        "engine_type": "maze",
        "tier": tier,
        "cognitiveLoad": cfg['load'],
        "checksum": checksum,
        # 兼容 puzzle 結構與 spec 結構，徹底避免前端找不到 end 欄位
        "puzzle": {
            "width": n,
            "height": n,
            "size": n,
            "grid": grid,
            "start": [1, 1],
            "end": [n - 2, n - 2],
            "visualNoise": 0.5
        },
        "spec": {
            "size": n,
            "grid": grid,
            "start": [1, 1],
            "end": [n - 2, n - 2]
        },
        "solution": [[p[1], p[0]] if isinstance(p, list) else p for p in solution],
        "metrics": {
            "decision_depth": len(solution),
            "propagation_steps": n * n
        }
    }

def main():
    catalog: List[Dict[str, Any]] = []
    puzzles_per_tier = 25

    print("🚀 開始生成 100 道迷宮題庫（相容前後端完整規格）...")

    for tier in ['kids', 'intermediate', 'expert', 'master']:
        for i in range(puzzles_per_tier):
            puzzle = generate_single_maze(tier, i)
            catalog.append(puzzle)
        print(f"✅ 已完成階梯 [{tier}]: 25 題")

    out_path = "../web-frontend/src/generated/maze.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 成功！相容格式之 100 道題庫已注入至：{out_path}")

if __name__ == '__main__':
    main()
