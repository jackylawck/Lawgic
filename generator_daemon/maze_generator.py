import json
import random
import hashlib
from collections import deque
from typing import List, Dict, Any, Tuple, Set

TIERS = {
    'kids': {
        'size': 11,
        'loop_ratio': 0.0,
        'load': {'spatial': 0.35, 'numeric': 0.0, 'workingMemory': 0.3, 'inhibition': 0.2}
    },
    'intermediate': {
        'size': 17,
        'loop_ratio': 0.04,
        'load': {'spatial': 0.60, 'numeric': 0.0, 'workingMemory': 0.5, 'inhibition': 0.45}
    },
    'expert': {
        'size': 23,
        'loop_ratio': 0.08,
        'load': {'spatial': 0.85, 'numeric': 0.0, 'workingMemory': 0.75, 'inhibition': 0.7}
    },
    'master': {
        'size': 31,
        'loop_ratio': 0.12,
        'load': {'spatial': 1.0, 'numeric': 0.0, 'workingMemory': 0.95, 'inhibition': 0.9}
    }
}

def bfs_solve(grid: List[List[int]], n: int, start: Tuple[int, int], end: Tuple[int, int]) -> List[List[int]]:
    queue = deque([[start]])
    visited: Set[Tuple[int, int]] = {start}
    
    while queue:
        path = queue.popleft()
        cr, cc = path[-1]
        
        if (cr, cc) == end:
            return [[r, c] for r, c in path]
            
        for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr, nc = cr + dr, cc + dc
            if 0 <= nr < n and 0 <= nc < n and grid[nr][nc] == 0:
                if (nr, nc) not in visited:
                    visited.add((nr, nc))
                    queue.append(path + [(nr, nc)])
    return []

def analyze_maze_complexity(grid: List[List[int]], n: int, solution_path: List[List[int]]) -> Dict[str, Any]:
    """精算認知難度：分岔路口數、死胡同數量、決策深度"""
    sol_set = { (p[0], p[1]) for p in solution_path }
    junctions = 0
    dead_ends = 0
    
    for r in range(1, n - 1):
        for c in range(1, n - 1):
            if grid[r][c] == 0:
                open_neighbors = 0
                for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                    if grid[r + dr][c + dc] == 0:
                        open_neighbors += 1
                
                if open_neighbors >= 3:
                    junctions += 1
                elif open_neighbors == 1:
                    dead_ends += 1
                    
    # 解路徑上經歷的分岔點數量（真實決策負荷）
    decision_junctions_on_path = sum(
        1 for r, c in sol_set 
        if sum(1 for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)] if grid[r + dr][c + dc] == 0) >= 3
    )
    
    return {
        "total_junctions": junctions,
        "dead_ends_count": dead_ends,
        "decision_points": decision_junctions_on_path,
        "path_length": len(solution_path),
        "tortuosity": round(len(solution_path) / (2 * (n - 2)), 2)
    }

def generate_single_maze(tier: str, index: int) -> Dict[str, Any]:
    cfg = TIERS[tier]
    n = cfg['size']
    if n % 2 == 0:
        n += 1

    # 1: 牆壁, 0: 通路
    grid = [[1 for _ in range(n)] for _ in range(n)]

    # 1. 嚴格基於奇數單元的隨機化 Prim / DFS 生成完美樹
    start_cell = (1, 1)
    end_cell = (n - 2, n - 2)
    grid[start_cell[0]][start_cell[1]] = 0
    
    stack = [start_cell]
    visited_cells = {start_cell}
    directions = [(-2, 0), (2, 0), (0, -2), (0, 2)]

    while stack:
        cr, cc = stack[-1]
        candidates = []
        
        for dr, dc in directions:
            nr, nc = cr + dr, cc + dc
            if 1 <= nr < n - 1 and 1 <= nc < n - 1 and (nr, nc) not in visited_cells:
                candidates.append((dr, dc, nr, nc))

        if candidates:
            dr, dc, nr, nc = random.choice(candidates)
            # 打通中間牆壁與目標格
            grid[cr + dr // 2][cc + dc // 2] = 0
            grid[nr][nc] = 0
            visited_cells.add((nr, nc))
            stack.append((nr, nc))
        else:
            stack.pop()

    # 2. 受控長距離環路注入（避免破壞邊界與產生 2x2 空洞）
    internal_walls = []
    for r in range(2, n - 2):
        for c in range(2, n - 2):
            if grid[r][c] == 1:
                # 判斷是否為夾在兩條通路之間的單層薄牆
                horiz_pass = (grid[r][c - 1] == 0 and grid[r][c + 1] == 0 and grid[r - 1][c] == 1 and grid[r + 1][c] == 1)
                vert_pass = (grid[r - 1][c] == 0 and grid[r + 1][c] == 0 and grid[r][c - 1] == 1 and grid[r][c + 1] == 1)
                if horiz_pass or vert_pass:
                    internal_walls.append((r, c))

    random.shuffle(internal_walls)
    loops_to_inject = int(len(internal_walls) * cfg['loop_ratio'])
    
    for wr, wc in internal_walls[:loops_to_inject]:
        # 預檢查：打通後不可產生 2x2 空間退化
        grid[wr][wc] = 0
        has_2x2_flat = False
        for dr in [0, -1]:
            for dc in [0, -1]:
                if (grid[wr + dr][wc + dc] == 0 and grid[wr + dr + 1][wc + dc] == 0 and
                    grid[wr + dr][wc + dc + 1] == 0 and grid[wr + dr + 1][wc + dc + 1] == 0):
                    has_2x2_flat = True
                    break
            if has_2x2_flat:
                break
        if has_2x2_flat:
            grid[wr][wc] = 1 # 回滾

    # 3. 求解最短路徑
    solution = bfs_solve(grid, n, start_cell, end_cell)
    metrics_data = analyze_maze_complexity(grid, n, solution)

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
        # 座標系統一為 [row, col]，嚴禁進行反向倒置
        "solution": solution,
        "metrics": {
            "decision_depth": metrics_data["decision_points"],
            "propagation_steps": len(solution),
            "dead_ends": metrics_data["dead_ends_count"],
            "tortuosity": metrics_data["tortuosity"]
        }
    }

def main():
    catalog: List[Dict[str, Any]] = []
    puzzles_per_tier = 25

    print("🚀 啟動迷宮認知生成管線（嚴格奇數拓撲 + 認知熵指標）...")

    for tier in ['kids', 'intermediate', 'expert', 'master']:
        for i in range(puzzles_per_tier):
            puzzle = generate_single_maze(tier, i)
            catalog.append(puzzle)
        print(f"✅ 已完成階梯 [{tier:12s}]: 25 題 (Size: {TIERS[tier]['size']})")

    out_path = "../web-frontend/src/generated/maze.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 成功！高品質 100 道迷宮題庫已匯出至：{out_path}")

if __name__ == '__main__':
    main()
