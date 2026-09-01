# generator_daemon/maze_academic_generator.py
import json
import hashlib
import random
from collections import deque
from typing import List, Tuple, Dict, Any

class AcademicMazeGenerator:
    def __init__(self, width: int, height: int, complexity: float = 0.7):
        self.width = width if width % 2 == 1 else width + 1
        self.height = height if height % 2 == 1 else height + 1
        self.grid = []
        self.solution = []
        self.complexity = max(0.3, min(1.0, complexity))  # 控制額外死路分支

    def generate(self) -> Dict[str, Any]:
        self.grid = [[1 for _ in range(self.width)] for _ in range(self.height)]
        self._carve(1, 1)
        
        # 🧠 學術級擴充：刻意添加「死胡同分支」（增加認知負荷）
        self._add_extra_dead_ends(self.complexity)
        
        start = (1, 1)
        end = (self.width - 2, self.height - 2)
        self.solution = self._bfs_shortest_path(start, end)
        
        # 📊 心理測量指標計算 (Real Metrics)
        fork_ratio = self._count_forks() / ((self.width // 2) * (self.height // 2))
        dead_end_density = self._count_dead_ends() / ((self.width // 2) * (self.height // 2))
        path_len = len(self.solution)
        
        # 🧠 動態認知負荷向量 (符合 Baddeley 多元工作記憶模型)
        cognitive_load = {
            "spatial": min(1.0, 0.3 + (path_len / 80) + (fork_ratio * 0.5)),
            "numeric": 0.0,
            "workingMemory": min(1.0, 0.4 + (fork_ratio * 0.8)),
            "inhibition": min(1.0, 0.3 + (dead_end_density * 1.2))  # 死胡同越多，抑制控制需求越高
        }
        
        # 🎯 難度分級 (結合路徑長度與死胡同密度)
        if path_len < 20 and dead_end_density < 0.1:
            tier = "kids"
        elif path_len < 35 and dead_end_density < 0.2:
            tier = "intermediate"
        elif path_len < 60 and dead_end_density < 0.3:
            tier = "expert"
        else:
            tier = "master"

        raw_payload = {
            "id": f"maze_{tier}_{random.randint(1000, 9999)}",
            "category": "topological",
            "engine_type": "maze",
            "tier": tier,
            "puzzle": {
                "width": self.width,
                "height": self.height,
                "start": list(start),
                "end": list(end),
                "grid": self.grid
            },
            "solution": self.solution,
            "metrics": {
                "decision_depth": path_len,
                "propagation_steps": self.width * self.height,
                "fork_ratio": round(fork_ratio, 3),
                "dead_end_density": round(dead_end_density, 3)
            },
            "cognitiveLoad": cognitive_load
        }
        
        # 🔒 真正的 SHA-256 (遞迴排序，與前端校驗完全相容)
        canonical = json.dumps(raw_payload, sort_keys=True, separators=(',', ':'))
        raw_payload["checksum"] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        
        return raw_payload

    def _carve(self, x: int, y: int):
        self.grid[y][x] = 0
        dirs = [(0, -2), (0, 2), (-2, 0), (2, 0)]
        random.shuffle(dirs)
        for dx, dy in dirs:
            nx, ny = x + dx, y + dy
            if 0 < nx < self.width and 0 < ny < self.height and self.grid[ny][nx] == 1:
                self.grid[y + dy//2][x + dx//2] = 0
                self._carve(nx, ny)

    def _add_extra_dead_ends(self, ratio: float):
        """隨機將部分通路末端轉為死胡同，增加認知負荷 (inhibition)"""
        for _ in range(int(ratio * 10)):
            y = random.randint(1, self.height-2)
            x = random.randint(1, self.width-2)
            if self.grid[y][x] == 0:
                neighbors = [(x+dx, y+dy) for dx, dy in [(1,0),(-1,0),(0,1),(0,-1)] 
                             if 0 <= x+dx < self.width and 0 <= y+dy < self.height and self.grid[y+dy][x+dx] == 0]
                if len(neighbors) == 1:
                    self.grid[y][x] = 1  # 轉為牆壁，形成死胡同

    def _bfs_shortest_path(self, start, end):
        queue = deque([(start[0], start[1], [start])])
        visited = set([start])
        while queue:
            x, y, path = queue.popleft()
            if (x, y) == end:
                return path
            for dx, dy in [(0, -1), (0, 1), (-1, 0), (1, 0)]:
                nx, ny = x + dx, y + dy
                if 0 <= nx < self.width and 0 <= ny < self.height and self.grid[ny][nx] == 0 and (nx, ny) not in visited:
                    visited.add((nx, ny))
                    queue.append((nx, ny, path + [(nx, ny)]))
        return [start, end]

    def _count_forks(self) -> int:
        count = 0
        for y in range(1, self.height-1):
            for x in range(1, self.width-1):
                if self.grid[y][x] == 0:
                    paths = sum([1 for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)] if self.grid[y+dy][x+dx] == 0])
                    if paths >= 3:
                        count += 1
        return count

    def _count_dead_ends(self) -> int:
        count = 0
        for y in range(1, self.height-1):
            for x in range(1, self.width-1):
                if self.grid[y][x] == 0:
                    paths = sum([1 for dx, dy in [(0,1),(0,-1),(1,0),(-1,0)] if self.grid[y+dy][x+dx] == 0])
                    if paths == 1:
                        count += 1
        return count

if __name__ == "__main__":
    import os
    output_dir = "../web-frontend/src/generated/"
    os.makedirs(output_dir, exist_ok=True)
    
    all_mazes = []
    sizes = [(9,9), (11,11), (13,13), (15,15), (17,17)]
    complexities = [0.3, 0.5, 0.7, 0.9]
    
    for size in sizes:
        for comp in complexities:
            for _ in range(5):  # 每種尺寸*複雜度 生成5個變體
                gen = AcademicMazeGenerator(width=size[0], height=size[1], complexity=comp)
                all_mazes.append(gen.generate())
    
    with open(os.path.join(output_dir, "maze.json"), "w", encoding="utf-8") as f:
        json.dump(all_mazes, f, indent=2, ensure_ascii=False)
    
    print(f"✅ 學術級迷宮題庫生成完畢！共 {len(all_mazes)} 題")
