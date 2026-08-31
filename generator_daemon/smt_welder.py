import hashlib
import json
import os
import random
from typing import Dict, List, Set, Tuple
from z3 import And, Bool, Distinct, Implies, Int, Or, Solver, sat, unknown, unsat

class SudokuSMTWelderSecure:
    def __init__(self, size: int = 9, block_rows: int = 3, block_cols: int = 3):
        self.N = size
        self.R = block_rows
        self.C = block_cols
        self.cells = [[Int(f"cell_{r}_{c}") for c in range(self.N)] for r in range(self.N)]
        self.base_constraints = self._build_base_rules()

    def _build_base_rules(self) -> List:
        rules = []
        for r in range(self.N):
            for c in range(self.N):
                rules.append(And(self.cells[r][c] >= 1, self.cells[r][c] <= self.N))
        for r in range(self.N):
            rules.append(Distinct([self.cells[r][c] for c in range(self.N)]))
        for c in range(self.N):
            rules.append(Distinct([self.cells[r][c] for c in range(self.N)]))
        for br in range(0, self.N, self.R):
            for bc in range(0, self.N, self.C):
                block = [self.cells[r][c] for r in range(br, br + self.R) for c in range(bc, bc + self.C)]
                rules.append(Distinct(block))
        return rules

    def generate_random_solution(self, max_attempts: int = 50) -> List[List[int]]:
        for _ in range(max_attempts):
            s = Solver()
            s.set("timeout", 1000)
            s.add(self.base_constraints)
            seed_cells = random.sample([(r, c) for r in range(self.N) for c in range(self.N)], 5)
            for r, c in seed_cells:
                s.add(self.cells[r][c] == random.randint(1, self.N))
            if s.check() == sat:
                m = s.model()
                return [[m.evaluate(self.cells[r][c]).as_long() for c in range(self.N)] for r in range(self.N)]
        raise RuntimeError("SMT_SECURITY_ERR: Failed to generate valid board.")

    def extract_metrics(self, clue_dict: Dict[Tuple[int, int], int]) -> Tuple[int, int]:
        s = Solver()
        s.set("timeout", 500)
        s.add(self.base_constraints)
        for (r, c), val in clue_dict.items():
            s.add(self.cells[r][c] == val)
        if s.check() != sat:
            return -1, -1
        stats = s.statistics()
        decisions = stats.get_key_value('conflicts') if 'conflicts' in [k for k, _ in stats] else 0
        props = stats.get_key_value('propagations') if 'propagations' in [k for k, _ in stats] else 0
        return decisions, props

    def weld_minimal_puzzle(self, target_clues: int = 26) -> dict:
        solution = self.generate_random_solution()
        all_positions = [(r, c) for r in range(self.N) for c in range(self.N)]
        random.shuffle(all_positions)
        
        current_clues = {(r, c): solution[r][c] for r, c in all_positions}
        locked_positions: Set[Tuple[int, int]] = set()

        for r, c in all_positions:
            if len(current_clues) <= target_clues:
                break
            if (r, c) in locked_positions:
                continue

            removed_val = current_clues.pop((r, c))
            
            verifier = Solver()
            verifier.set("timeout", 300)
            verifier.add(self.base_constraints)
            
            clue_assumptions = []
            clue_var_map = {}
            for (cr, cc), cval in current_clues.items():
                p_var = Bool(f"track_{cr}_{cc}")
                verifier.add(Implies(p_var, self.cells[cr][cc] == cval))
                clue_assumptions.append(p_var)
                clue_var_map[p_var] = (cr, cc)

            diff_conditions = [self.cells[i][j] != solution[i][j] for i in range(self.N) for j in range(self.N)]
            verifier.add(Or(diff_conditions))

            check_result = verifier.check(clue_assumptions)
            
            if check_result == sat:
                current_clues[(r, c)] = removed_val
                locked_positions.add((r, c))
            elif check_result == unsat:
                core = verifier.unsat_core()
                for p_var in core:
                    if p_var in clue_var_map:
                        locked_positions.add(clue_var_map[p_var])
            else:
                current_clues[(r, c)] = removed_val

        decisions, props = self.extract_metrics(current_clues)
        
        puzzle_grid = [[0 for _ in range(self.N)] for _ in range(self.N)]
        for (r, c), val in current_clues.items():
            puzzle_grid[r][c] = val

        raw_payload = {
            "id": f"sudoku_{random.randint(10000, 99999)}",
            "category": "grid_csp",
            "engine_type": "sudoku",
            "puzzle": puzzle_grid,
            "solution": solution,
            "clue_count": len(current_clues),
            "metrics": {
                "decision_depth": decisions,
                "propagation_steps": props,
                "difficulty_tier": "Easy" if decisions == 0 else ("Medium" if decisions <= 2 else "Expert")
            }
        }
        
        canonical_str = json.dumps(raw_payload, sort_keys=True, separators=(',', ':'))
        raw_payload["checksum"] = hashlib.sha256(canonical_str.encode('utf-8')).hexdigest()
        return raw_payload
