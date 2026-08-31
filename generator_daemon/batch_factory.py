import json
import multiprocessing as mp
import os
import tempfile
from tqdm import tqdm
from .smt_welder import SudokuSMTWelderSecure

def generate_task_worker(target_clues: int) -> dict:
    import random
    random.seed()
    welder = SudokuSMTWelderSecure()
    return welder.weld_minimal_puzzle(target_clues=target_clues)

def batch_generate_secure(count: int = 100, target_clues: int = 26, output_file: str = "puzzle_library.json"):
    print(f"🔒 啟動 SMT 生成工廠 (進程數: {mp.cpu_count()})...")
    tasks = [target_clues for _ in range(count)]
    
    with mp.Pool(processes=mp.cpu_count(), maxtasksperchild=25) as pool:
        results = list(tqdm(
            pool.imap_unordered(generate_task_worker, tasks, chunksize=5),
            total=count,
            desc="Generating Puzzles"
        ))
    
    graded = {"Easy": [], "Medium": [], "Expert": []}
    for data in results:
        tier = data["metrics"]["difficulty_tier"]
        graded[tier].append(data)
        
    dir_name = os.path.dirname(output_file) or "."
    with tempfile.NamedTemporaryFile('w', dir=dir_name, delete=False, encoding='utf-8') as tf:
        json.dump(graded, tf, indent=2, ensure_ascii=False)
        temp_name = tf.name

    os.replace(temp_name, output_file)
    print(f"✅ 生成完成！已寫入 {output_file}")

if __name__ == "__main__":
    batch_generate_secure(count=60, target_clues=26)
