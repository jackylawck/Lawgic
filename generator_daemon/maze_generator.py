# generator_daemon/maze_generator.py
import json
import hashlib
import random
from collections import deque
from typing import List, Tuple, Dict, Any, Set

class AcademicMazeEngineV2:
    def __init__(self, width: int, height: int):
        self.width = width if width % 2 == 1 else width + 1
        self.height = height if height % 2 == 1 else height + 1
        self.grid: List[List[int]] = []
        self.solution: List[Tuple[int, int]] = []

    def generate(self) -> Dict[str, Any]:
        self.grid = [[1 for _ in range(self.width)] for _ in range(self.height)]
        
        start_x, start_y = 1, 1
        self.grid[start_y][start_x] = 0
        
        walls: List[Tuple[int, int, int, int]] = []
        for dx, dy in [(0, 2), (2, 0), (0, -2), (-2, 0)]:
            nx, ny = start_x + dx, start_y + dy
            if 0 < nx < self.width and 0 < ny < self.height:
                walls.append((start_x, start_y, nx, ny))

        while walls:
            idx = random.randrange(len(walls))
            wx, wy, nx, ny = walls.pop(idx)

            if self.grid[ny][nx] == 1:
                self.grid[wy + (ny - wy) // 2][wx + (nx - wx) // 2] = 0
                self.grid[ny][nx] = 0

                for dx, dy in [(0, 2), (2, 0), (0, -2), (-2, 0)]:
                    nnx, nny = nx + dx, ny + dy
                    if 0 < nnx < self.width and 0 < nny < self.height and self.grid[nny][nnx] == 1:
                        walls.append((nx, ny, nnx, nny))

        start: Tuple[int, int] = (1, 1)
        end: Tuple[int, int] = (self.width - 2, self.height - 2)

        self.solution = self._bfs_shortest_path(start, end)

        turn_count = self._count_solution_turns(self.solution)
        fork_nodes, decision_fork_count = self._extract_decision_forks()
        dead_ends = self._extract_dead_ends()
        mean_dead_depth = self._calculate_mean_dead_end_depth(dead_ends)
        path_len = len(self.solution)

        spatial_load = min(1.0, 0.35 + (turn_count / max(6, self.width * 1.2)) * 0.45 + (path_len / (self.width * self.height * 0.5)) * 0.2)
        working_memory_load = min(1.0, 0.30 + (decision_fork_count / max(4, path_len * 0.4)) * 0.55 + (self.width / 30.0) * 0.15)
        inhibition_load = min(1.0, 0.25 + (mean_dead_depth / 6.0) * 0.50 + (len(dead_ends) / max(3, self.width)) * 0.25)

        # 🧠 精英級修復：依據理論最大路徑比例動態分級，杜絕單一階梯集中問題
        max_possible = self.width * self.height * 0.25
        ratio = path_len / max(1.0, max_possible)

        if ratio < 0.32:
            tier = "kids"
        elif ratio < 0.52:
            tier = "intermediate"
        elif ratio < 0.72:
            tier = "expert"
        else:
            tier = "master"

        payload: Dict[str, Any] = {
            "id": f"maze_{tier}_{random.randint(10000, 99999)}",
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
                "turn_count": turn_count,
                "decision_forks": decision_fork_count,
                "mean_dead_end_depth": round(mean_dead_depth, 2),
                "propagation_steps": self.width * self.height
            },
            "cognitiveLoad": {
                "spatial": round(spatial_load, 3),
                "numeric": 0.0,
                "workingMemory": round(working_memory_load, 3),
                "inhibition": round(inhibition_load, 3)
            }
        }

        canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'))
        payload["checksum"] = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
        return payload

    def _bfs_shortest_path(self, start: Tuple[int, int], end: Tuple[int, int]) -> List[Tuple[int, int]]:
        queue = deque([(start[0], start[1], [start])])
        visited = set([start])
        while queue:
            cx, cy, path = queue.popleft()
            if (cx, cy) == end:
                return path
            for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < self.width and 0 <= ny < self.height and self.grid[ny][nx] == 0:
                    if (nx, ny) not in visited:
                        visited.add((nx, ny))
                        queue.append((nx, ny, path + [(nx, ny)]))
        return [start, end]

    def _count_solution_turns(self, path: List[Tuple[int, int]]) -> int:
        if len(path) < 3:
            return 0
        turns = 0
        for i in range(1, len(path) - 1):
            dx1, dy1 = path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]
            dx2, dy2 = path[i + 1][0] - path[i][0], path[i + 1][1] - path[i + 1][1]
            if (dx1, dy1) != (dx2, dy2):
                turns += 1
        return turns

    def _extract_decision_forks(self) -> Tuple[List[Tuple[int, int]], int]:
        sol_set = set(self.solution)
        forks = []
        on_path_forks = 0
        for y in range(1, self.height - 1):
            for x in range(1, self.width - 1):
                if self.grid[y][x] == 0:
                    passages = sum(1 for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)] if self.grid[y + dy][x + dx] == 0)
                    if passages >= 3:
                        forks.append((x, y))
                        if (x, y) in sol_set:
                            on_path_forks += 1
        return forks, on_path_forks

    def _extract_dead_ends(self) -> List[Tuple[int, int]]:
        dead_ends = []
        for y in range(1, self.height - 1):
            for x in range(1, self.width - 1):
                if self.grid[y][x] == 0 and (x, y) != (1, 1) and (x, y) != (self.width - 2, self.height - 2):
                    passages = sum(1 for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)] if self.grid[y + dy][x + dx] == 0)
                    if passages == 1:
                        dead_ends.append((x, y))
        return dead_ends

    def _calculate_mean_dead_end_depth(self, dead_ends: List[Tuple[int, int]]) -> float:
        if not dead_ends:
            return 1.0
        depths = []
        for sx, sy in dead_ends:
            depth = 1
            curr = (sx, sy)
            visited = set([curr])
            while True:
                neighbors = []
                for dx, dy in [(0, 1), (0, -1), (1, 0), (-1, 0)]:
                    nx, ny = curr[0] + dx, curr[1] + dy
                    if 0 <= nx < self.width and 0 <= ny < self.height and self.grid[ny][nx] == 0:
                        if (nx, ny) not in visited:
                            neighbors.append((nx, ny))
                if len(neighbors) == 1:
                    visited.add(neighbors[0])
                    curr = neighbors[0]
                    depth += 1
                else:
                    break
            depths.append(depth)
        return sum(depths) / len(depths)


def canonical_fingerprint(grid: List[List[int]]) -> str:
    variants = []
    curr = grid
    for _ in range(4):
        curr = [list(row) for row in zip(*curr[::-1])]
        variants.append("".join("".join(map(str, r)) for r in curr))
        variants.append("".join("".join(map(str, r[::-1])) for r in curr))
    return min(variants)


if __name__ == "__main__":
    import os
    output_dir = "../web-frontend/src/generated/"
    os.makedirs(output_dir, exist_ok=True)

    seen_fingerprints: Set[str] = set()
    all_mazes: List[Dict[str, Any]] = []

    target_tiers = [
        {"size": (9, 9), "count": 25},
        {"size": (11, 11), "count": 25},
        {"size": (15, 15), "count": 25},
        {"size": (19, 19), "count": 25},
    ]

    for spec in target_tiers:
        w, h = spec["size"]
        needed = spec["count"]
        generated = 0
        attempts = 0

        while generated < needed and attempts < needed * 60:
            attempts += 1
            engine = AcademicMazeEngineV2(width=w, height=h)
            maze_obj = engine.generate()
            fp = canonical_fingerprint(maze_obj["puzzle"]["grid"])

            if fp not in seen_fingerprints:
                seen_fingerprints.add(fp)
                all_mazes.append(maze_obj)
                generated += 1

    output_path = os.path.join(output_dir, "maze.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_mazes, f, indent=2, ensure_ascii=False)

    print(f"✅ 成功產出 {len(all_mazes)} 道均勻分佈之資優迷宮！")
