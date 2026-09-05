import hashlib
import json
import random
from typing import Dict, List, Optional, Set, Tuple
from z3 import And, Bool, Distinct, Implies, Int, Or, Solver, sat, unsat

class SudokuSMTWelderGodTier:
    def __init__(self, size: int = 9, block_rows: int = 3, block_cols: int = 3):
        self.N = size
        self.R = block_rows
        self.C = block_cols
        self.cells = [[Int(f"c_{r}_{c}") for c in range(self.N)] for r in range(self.N)]
        self.base_constraints = self._build_base_rules()

    def _build_base_rules(self) -> List:
        rules = []
        # 數值區間約束
        for r in range(self.N):
            for c in range(self.N):
                rules.append(And(self.cells[r][c] >= 1, self.cells[r][c] <= self.N))
        # 行、列唯一約束
        for r in range(self.N):
            rules.append(Distinct([self.cells[r][c] for c in range(self.N)]))
        for c in range(self.N):
            rules.append(Distinct([self.cells[r][c] for c in range(self.N)]))
        # 九宮格唯一約束
        for br in range(0, self.N, self.R):
            for bc in range(0, self.N, self.C):
                block = [self.cells[r][c] for r in range(br, br + self.R) for c in range(bc, bc + self.C)]
                rules.append(Distinct(block))
        return rules

    def generate_random_solution(self) -> List[List[int]]:
        """利用隨機對稱種子在單一 SAT 週期內生成合法終盤"""
        s = Solver()
        s.set("timeout", 1500)
        s.add(self.base_constraints)
        
        # 隨機填充第一行（保證對稱性破壞，快速引導終盤生成）
        first_row_vals = list(range(1, self.N + 1))
        random.shuffle(first_row_vals)
        for c in range(self.N):
            s.add(self.cells[0][c] == first_row_vals[c])

        if s.check() == sat:
            m = s.model()
            return [[m.evaluate(self.cells[r][c]).as_long() for c in range(self.N)] for r in range(self.N)]
        raise RuntimeError("SMT_ERR: Failed to generate valid terminal solution.")

    def weld_minimal_puzzle(self, target_clues: int = 26, timeout_ms: int = 200) -> dict:
        """
        神級增量挖洞架構：
        1. 維護單一 Persistent Solver，消除重複構建 AST 的 CPU 開銷
        2. 採用雙解否定約束 (Negated Alternate Solution) 驗證唯一解
        3. 支援中心對稱/隨機挖洞策略
        """
        solution = self.generate_random_solution()
        
        # 線索追蹤變數與持久驗證器
        verifier = Solver()
        verifier.set("timeout", timeout_ms)
        verifier.add(self.base_constraints)

        clue_bools = {}
        for r in range(self.N):
            for c in range(self.N):
                b_var = Bool(f"clue_{r}_{c}")
                clue_bools[(r, c)] = b_var
                verifier.add(Implies(b_var, self.cells[r][c] == solution[r][c]))

        # 尋找「第二解」約束：至少有一個格子的值與標準答案不同
        diff_conditions = Or([
            self.cells[r][c] != solution[r][c] 
            for r in range(self.N) for c in range(self.N)
        ])
        verifier.add(diff_conditions)

        # 初始狀態：81 個線索全部開啟
        active_clues: Set[Tuple[int, int]] = set(clue_bools.keys())
        
        # 180 度中心對稱挖洞順序隊列
        positions = []
        for r in range((self.N + 1) // 2):
            for c in range(self.N):
                if (r, c) not in positions:
                    sym_r, sym_c = self.N - 1 - r, self.N - 1 - c
                    positions.append(((r, c), (sym_r, sym_c)))
        random.shuffle(positions)

        for p1, p2 in positions:
            if len(active_clues) <= target_clues:
                break

            # 嘗試暫時挖掉此對稱點對
            candidates_to_remove = {p1, p2}
            test_assumptions = [clue_bools[pos] for pos in (active_clues - candidates_to_remove)]

            # SMT 檢驗是否存在第二解
            check_res = verifier.check(test_assumptions)
            
            if check_res == unsat:
                # 依然 UNSAT -> 表示不存在第二解，唯一性保持！安全挖除
                active_clues -= candidates_to_remove
            else:
                # SAT（有第二解）或 UNKNOWN（逾時）-> 該位置為結構關鍵支撐點，必須保留
                continue

        puzzle_grid = [[0 for _ in range(self.N)] for _ in range(self.N)]
        for r, c in active_clues:
            puzzle_grid[r][c] = solution[r][c]

        clue_count = len(active_clues)
        difficulty_tier = "Easy" if clue_count >= 32 else ("Medium" if clue_count >= 28 else "Expert")

        raw_payload = {
            "id": f"sudoku_{random.randint(100000, 999999)}",
            "category": "grid_csp",
            "engine_type": "sudoku",
            "puzzle": puzzle_grid,
            "solution": solution,
            "clue_count": clue_count,
            "metrics": {
                "decision_depth": 81 - clue_count,
                "difficulty_tier": difficulty_tier,
                "is_180_symmetric": True
            }
        }

        canonical_str = json.dumps(raw_payload, sort_keys=True, separators=(',', ':'))
        raw_payload["checksum"] = hashlib.sha256(canonical_str.encode('utf-8')).hexdigest()
        return raw_payload
