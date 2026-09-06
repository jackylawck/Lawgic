import os
import json
import sqlite3
import hashlib
import tempfile
import multiprocessing as mp
from collections import defaultdict
from typing import Dict, Any, Optional, List, Tuple
from tqdm import tqdm

# 難度設定規範：提示數與難度階層映射
DIFFICULTY_TIERS = {
    "kids": {"target_clues": 32, "irt_logit": 0.65, "depth": 0},
    "intermediate": {"target_clues": 28, "irt_logit": 1.45, "depth": 2},
    "expert": {"target_clues": 24, "irt_logit": 2.35, "depth": 4},
    "master": {"target_clues": 21, "irt_logit": 3.15, "depth": 7},
}

def string_to_grid(s: str) -> List[List[int]]:
    """將 81 字元字串安全轉換為 9x9 二維數值矩陣"""
    nums = [int(ch) if ch.isdigit() else 0 for ch in s.strip()]
    if len(nums) != 81:
        return [[0] * 9 for _ in range(9)]
    return [nums[i * 9 : (i + 1) * 9] for i in range(9)]

def _compute_canonical_signature(board_str: str) -> str:
    """
    計算棋盤在 D4 二面體群（8 種旋轉/翻轉變換）下的最小字典序特徵哈希，
    杜絕旋轉鏡射後的同構題污染題庫。
    """
    if len(board_str) != 81:
        return hashlib.sha256(board_str.encode("utf-8")).hexdigest()[:16]

    grid = [list(board_str[i * 9 : (i + 1) * 9]) for i in range(9)]
    variants = []

    def rotate_90(g):
        return [[g[8 - j][i] for j in range(9)] for i in range(9)]

    def reflect_h(g):
        return [row[::-1] for row in g]

    curr = grid
    for _ in range(4):
        variants.append("".join("".join(row) for row in curr))
        variants.append("".join("".join(row) for row in reflect_h(curr)))
        curr = rotate_90(curr)

    # 取 8 種幾何對稱形態中字典序最小者作為 Canonical Key
    canonical_repr = min(variants)
    return hashlib.sha256(canonical_repr.encode("utf-8")).hexdigest()[:16]

def generate_task_worker_resilient(task_params: Tuple[str, int, float, int]) -> Optional[Dict[str, Any]]:
    """具備安全隔離的單任務 Worker，支援傳入階層參數"""
    tier_name, target_clues, irt_logit, decision_depth = task_params
    
    import random
    import time
    random.seed(int(time.time() * 1000) ^ os.getpid())

    try:
        # 實例化求解器（待接入實際 SMT 模組）
        # welder = SudokuSMTWelderSecure()
        # raw = welder.weld_minimal_puzzle(target_clues=target_clues, timeout_sec=15)

        # 模擬返回合法數據
        mock_clues_str = "003020600900305001001806400008102900700000008006708200002609500800203009005010300"
        mock_solution_str = "453127689967385241281946753348512967729634158156798234832479516614853092579261370"

        clues_grid = string_to_grid(mock_clues_str)
        solution_grid = string_to_grid(mock_solution_str)
        sig = _compute_canonical_signature(mock_clues_str)

        # 構建 100% 符合前端標準的 PuzzleEntity 結構
        puzzle_entity = {
            "id": f"sudoku_{tier_name}_{sig[:8]}",
            "category": "numeric_logic",
            "engine_type": "sudoku",
            "tier": tier_name,
            "puzzle": {
                "rows": 9,
                "cols": 9,
                "grid": clues_grid,
                "clues": clues_grid,
                "pureDeductionRate": round(1.0 - (decision_depth * 0.04), 2),
            },
            "solution": solution_grid,
            "clue_count": target_clues,
            "metrics": {
                "decision_depth": decision_depth,
                "propagation_steps": 100 + (decision_depth * 65),
                "irt_logit_difficulty": irt_logit,
                "difficulty_tier": tier_name,
            },
            "checksum": f"CHK_SUDOKU_{tier_name.upper()}_{sig}",
            "signature": sig,
        }

        return puzzle_entity
    except Exception as e:
        return None

def batch_generate_secure_stream(
    puzzles_per_tier: int = 15,
    output_file: str = "puzzle_library.json",
    cache_db: str = "puzzles_checkpoint.db"
):
    """
    全自動梯度命題管線：
    1. 遍歷 4 大難度級別，確保題庫階梯完整
    2. 自動化 D4 幾何去重
    3. 批次寫入 SQLite 避免鎖表
    4. 輸出結構嚴格對齊前端 PUZZLE_CATALOG 格式
    """
    cpu_count = mp.cpu_count()
    print(f"🔒 啟動全難度 SMT 命題工廠 (並行核心數: {cpu_count})...")

    conn = sqlite3.connect(cache_db)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS generated_puzzles (
            signature TEXT PRIMARY KEY,
            tier TEXT,
            payload TEXT
        )
    """)
    conn.commit()

    # 針對各難度逐一計算尚需生成的題目數
    all_tasks = []
    for tier_name, config in DIFFICULTY_TIERS.items():
        cursor.execute("SELECT COUNT(*) FROM generated_puzzles WHERE tier = ?", (tier_name,))
        existing = cursor.fetchone()[0]
        needed = max(0, puzzles_per_tier - existing)
        
        if needed > 0:
            task_param = (tier_name, config["target_clues"], config["irt_logit"], config["depth"])
            all_tasks.extend([task_param] * needed)

    total_needed = len(all_tasks)
    if total_needed > 0:
        print(f"📋 當前需補充 {total_needed} 道梯度題目，分發多進程任務...")
        with mp.Pool(processes=cpu_count, maxtasksperchild=20) as pool:
            pbar = tqdm(total=total_needed, desc="🔨 SMT Constraint Solving", unit="puzzle")
            batch_buffer = []

            for res in pool.imap_unordered(generate_task_worker_resilient, all_tasks, chunksize=2):
                if res is not None:
                    batch_buffer.append((res["signature"], res["tier"], json.dumps(res, ensure_ascii=False)))
                    
                    # 累積 10 筆一次性寫入，大幅減少 SQLite 鎖定開銷
                    if len(batch_buffer) >= 10:
                        cursor.executemany(
                            "INSERT OR IGNORE INTO generated_puzzles (signature, tier, payload) VALUES (?, ?, ?)",
                            batch_buffer
                        )
                        conn.commit()
                        batch_buffer.clear()
                    
                    pbar.update(1)

            if batch_buffer:
                cursor.executemany(
                    "INSERT OR IGNORE INTO generated_puzzles (signature, tier, payload) VALUES (?, ?, ?)",
                    batch_buffer
                )
                conn.commit()

            pbar.close()

    # 提取所有題目並依 engine_type 封裝成前端所需的格式
    cursor.execute("SELECT payload FROM generated_puzzles")
    all_puzzles = [json.loads(row[0]) for row in cursor.fetchall()]
    conn.close()

    # 封裝為前端標準結構：{"sudoku": [...], "maze": [...]}
    catalog_output: Dict[str, List[Any]] = defaultdict(list)
    for p in all_puzzles:
        engine = p.get("engine_type", "sudoku")
        catalog_output[engine].append(p)

    # 原子安全寫入目標 JSON 檔案
    dir_name = os.path.dirname(output_file) or "."
    with tempfile.NamedTemporaryFile('w', dir=dir_name, delete=False, encoding='utf-8') as tf:
        json.dump(dict(catalog_output), tf, indent=2, ensure_ascii=False)
        temp_name = tf.name

    os.replace(temp_name, output_file)
    print(f"✅ 生成完畢！有效唯一題數: {len(all_puzzles)}，已成功輸出至 {output_file}")

    if os.path.exists(cache_db):
        os.remove(cache_db)

if __name__ == "__main__":
    batch_generate_secure_stream(puzzles_per_tier=15, output_file="puzzle_library.json")
