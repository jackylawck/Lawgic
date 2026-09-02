import json
import random
import hashlib
from typing import List, Dict, Any

TIERS = {
    'kids': {'size': 9, 'loops': 0, 'dead_ends': 3, 'load': {'spatial': 0.4, 'numeric': 0.0, 'workingMemory': 0.3, 'inhibition': 0.2}},
    'intermediate': {'size': 13, 'loops': 2, 'dead_ends': 8, 'load': {'spatial': 0.6, 'numeric': 0.0, 'workingMemory': 0.5, 'inhibition': 0.4}},
    'expert': {'size': 19, 'loops': 5, 'dead_ends': 18, 'load': {'spatial': 0.85, 'numeric': 0.0, 'workingMemory': 0.75, 'inhibition': 0.65}},
    'master': {'size': 25, 'loops': 9, 'dead_ends': 30, 'load': {'spatial': 1.0, 'numeric': 0.0, 'workingMemory': 0.9, 'inhibition': 0.85}}
}

def generate_single_maze(tier: str, index: int) -> Dict[str, Any]:
    cfg = TIERS[tier]
    n = cfg['size']
    # 確保維度為奇數
    if n % 2 == 0:
        n += 1

    # 1 代表牆壁，0 代表通道
    grid = [[1 for _ in range(n)] for _ in range(n)]

    def in_bounds(r: int, c: int) -> bool:
        return 1 <= r < n - 1 and 1 <= c < n - 1

    # Randomized DFS 迷宮生成演算法
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

    # 高階迷宮（專家 / 宗師）：打通特定內牆形成環路陷阱 (Braid Loops)
    for _ in range(cfg['loops']):
        wr = random.randrange(2, n - 2, 2)
        wc = random.randrange(1, n - 1, 2)
        grid[wr][wc] = 0

    # 起點與終點
    start = [1, 1]
    end = [n - 2, n - 2]
    grid[end[0]][end[1]] = 0

    # 產生穩定校驗碼
    content_str = f"maze-{tier}-{index}-{n}-{json.dumps(grid)}"
    checksum = hashlib.sha256(content_str.encode('utf-8')).hexdigest()[:12]

    return {
        "id": f"maze-{tier}-{index + 1:02d}",
        "engineType": "maze",
        "tier": tier,
        "cognitiveLoad": cfg['load'],
        "checksum": checksum,
        "spec": {
            "size": n,
            "grid": grid,
            "start": start,
            "end": end
        }
    }

def main():
    catalog: List[Dict[str, Any]] = []
    puzzles_per_tier = 25

    print("🚀 開始生成 100 道迷宮題庫（每階梯 25 題，含 50 題專家與宗師級）...")

    for tier in ['kids', 'intermediate', 'expert', 'master']:
        for i in range(puzzles_per_tier):
            puzzle = generate_single_maze(tier, i)
            catalog.append(puzzle)
        print(f"✅ 已完成階梯 [{tier}]: 25 題")

    out_path = "../web-frontend/src/generated/maze.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 成功！100 道題庫已注入至：{out_path}")

if __name__ == '__main__':
    main()
