# generator_daemon/maze_generator.py
import json
import hashlib
import random
from collections import deque
from typing import List, Tuple, Dict, Any

class MazeGenerator:
    def __init__(self, width: int, height: int):
        # 迷宮必須是奇數尺寸，才有明確的通道與牆壁
        self.width = width if width % 2 == 1 else width + 1
        self.height = height if height % 2 == 1 else height + 1
        self.grid: List[List[int]] = []
        self.solution: List[Tuple[int, int]] = []

    def generate(self) -> Dict[str, Any]:
        """主入口：生成迷宮網格並計算指標"""
        # 1. 初始化全牆壁網格 (1 = 牆, 0 = 路)
        self.grid = [[1 for _ in range(self.width)] for _ in range(self.height)]
        
        # 2. 從 (1,1) 開始 DFS 挖路 (遞迴回溯法)
        self._carve(1, 1)
        
        # 3. 設定起點 (左上) 與終點 (右下)
        start = (1, 1)
        end = (self.width - 2, self.height - 2)
        
        # 4. 用 BFS 計算最短路徑 (決策深度指標)
        self.solution = self._bfs_shortest_path(start, end)
        
        # 5. 計算迷宮熵值 (岔路率 / 複雜度)
        forks = self._count_forks()
        entropy = forks / ((self.width // 2) * (self.height // 2))
        
        # 6. 根據路徑長度與熵值動態決定難度 (對應 TierKey)
        path_len = len(self.solution)
        if path_len < 20:
            tier = "kids"
        elif path_len < 35:
            tier = "intermediate"
        elif path_len < 55:
            tier = "expert"
        else:
            tier = "master"
            
        # 7. 組合迷宮資料
        puzzle_data = {
            "width": self.width,
            "height": self.height,
            "start": list(start),
            "end": list(end),
            "grid": self.grid
        }
        
        raw_payload = {
            "id": f"maze_{tier}_{random.randint(1000, 9999)}",
            "category": "topological",
            "engine_type": "maze",
            "tier": tier,
            "puzzle": puzzle_data,
            "solution": self.solution,  # 最短路徑座標陣列
            "metrics": {
                "decision_depth": path_len,  # 路徑長度等同於決策步數
                "propagation_steps": len(self.grid) * len(self.grid[0]),
                "entropy": round(entropy, 3)
            },
            "cognitiveLoad": {
                "spatial": min(1.0, 0.4 + (path_len / 100)),
                "numeric": 0.0,
                "workingMemory": min(1.0, 0.3 + (entropy * 2)),
                "inhibition": min(1.0, 0.4 + (self._count_dead_ends() / 20))
            }
        }
        
        # SHA-256 簽名 (排序鍵確保確定性)
        canonical = json.dumps(raw_payload, sort_keys=True, separators=(',', ':'))
        raw_payload["checksum"] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        
        return raw_payload

    def _carve(self, x: int, y: int):
        """DFS 遞迴挖路 (完美迷宮生成)"""
        self.grid[y][x] = 0
        # 四個方向隨機打亂
        dirs = [(0, -2), (0, 2), (-2, 0), (2, 0)]
        random.shuffle(dirs)
        
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 < nx < self.width and 0 < ny < self.height and self.grid[ny][nx] == 1:
                # 打穿中間的牆
                self.grid[y + dy//2][x + dx//2] = 0
                self._carve(nx, ny)

    def _bfs_shortest_path(self, start: Tuple[int, int], end: Tuple[int, int]) -> List[Tuple[int, int]]:
        """BFS 求最短路徑 (確保永遠有解)"""
        queue = deque([(start[0], start[1], [start])])
        visited = set([start])
        
        while queue:
            x, y, path = queue.popleft()
            if (x, y) == end:
                return path
            for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < self.width and 0 <= ny < self.height:
                    if self.grid[ny][nx] == 0 and (nx, ny) not in visited:
                        visited.add((nx, ny))
                        queue.append((nx, ny, path + [(nx, ny)]))
        return [start, end]  # fallback

    def _count_forks(self) -> int:
        """統計岔路數量 (影響認知負荷)"""
        count = 0
        for y in range(1, self.height - 1):
            for x in range(1, self.width - 1):
                if self.grid[y][x] == 0:
                    paths = sum([1 for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)] 
                                 if self.grid[y+dy][x+dx] == 0])
                    if paths >= 3:
                        count += 1
        return count

    def _count_dead_ends(self) -> int:
        """統計死胡同數量 (影響抑制控制)"""
        count = 0
        for y in range(1, self.height - 1):
            for x in range(1, self.width - 1):
                if self.grid[y][x] == 0:
                    paths = sum([1 for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)] 
                                 if self.grid[y+dy][x+dx] == 0])
                    if paths == 1:
                        count += 1
        return count


# ===== 批次生成入口 (直接執行) =====
if __name__ == "__main__":
    import os
    output_dir = "../web-frontend/src/generated/"
    os.makedirs(output_dir, exist_ok=True)
    
    all_mazes = []
    
    # 生成 50 題各難度迷宮
    print("🚀 正在生成迷宮題庫 (50 題)...")
    for size in [(9,9), (11,11), (13,13), (15,15), (17,17)]:
        for _ in range(10):  # 每種尺寸 10 個不同隨機種子
            gen = MazeGenerator(width=size[0], height=size[1])
            all_mazes.append(gen.generate())
    
    # 寫入 maze.json
    output_path = os.path.join(output_dir, "maze.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_mazes, f, indent=2, ensure_ascii=False)
    
    print(f"✅ 成功生成 {len(all_mazes)} 道迷宮題目！")
    print(f"📁 已寫入: {output_path}")
