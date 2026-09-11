// core-engine/src/lib.rs
use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn init_engine() {
    console_error_panic_hook::set_once();
}

pub type BitMask = u16;
pub const ALL_CANDIDATES: BitMask = 0x03FE; // Bits 1..=9 (0b0000_0011_1111_1110)

/// 編譯期靜態計算 81 格的 20 個正交同行、同列與九宮鄰居。
/// 使用 static 確保唯讀資料段單例存在，杜絕 const 內聯展開導致二進位體積膨脹。
static PEERS_TABLE: [[u8; 20]; 81] = {
    let mut table = [[0u8; 20]; 81];
    let mut i = 0;
    while i < 81 {
        let r = i / 9;
        let c = i % 9;
        let br = (r / 3) * 3;
        let bc = (c / 3) * 3;
        let mut count = 0;

        let mut tr = 0;
        while tr < 9 {
            let mut tc = 0;
            while tc < 9 {
                if !(tr == r && tc == c) {
                    if tr == r || tc == c || (tr >= br && tr < br + 3 && tc >= bc && tc < bc + 3) {
                        table[i][count] = (tr * 9 + tc) as u8;
                        count += 1;
                    }
                }
                tc += 1;
            }
            tr += 1;
        }
        i += 1;
    }
    table
};

/// 零堆疊配置的波前約束傳播核心 (Constraint Propagation Engine)
/// 使用靜態陣列佇列，回傳 false 代表出現矛盾（候選數歸零）
pub fn bfs_propagate(
    cells: &mut [BitMask; 81],
    queue: &mut [u8; 81],
    queued: &mut [bool; 81],
    mut q_tail: usize,
) -> bool {
    let mut q_head = 0;

    while q_head < q_tail {
        let idx = queue[q_head] as usize;
        q_head += 1;

        let fixed_mask = cells[idx];
        if fixed_mask.count_ones() != 1 {
            continue;
        }

        for &peer_u8 in PEERS_TABLE[idx].iter() {
            let peer = peer_u8 as usize;
            let current_mask = cells[peer];

            if (current_mask & fixed_mask) != 0 {
                let new_mask = current_mask & !fixed_mask;
                if new_mask == 0 {
                    return false; // 剪枝：相鄰格無合法候選數，此分支無解
                }

                if new_mask != current_mask {
                    cells[peer] = new_mask;
                    if new_mask.count_ones() == 1 && !queued[peer] {
                        queue[q_tail] = peer as u8;
                        queued[peer] = true;
                        q_tail += 1;
                    }
                }
            }
        }
    }

    true
}

#[wasm_bindgen]
pub struct SudokuEngine {
    initial_clues: [u8; 81],
    user_inputs: [u8; 81],
    cells: [BitMask; 81],
}

#[wasm_bindgen]
impl SudokuEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(flat_clues: &[u8]) -> Result<SudokuEngine, JsValue> {
        if flat_clues.len() != 81 {
            return Err(JsValue::from_str("SECURITY_ERR: Payload must be exactly 81 bytes"));
        }

        let mut initial_clues = [0u8; 81];
        for (idx, &val) in flat_clues.iter().enumerate() {
            if val > 9 {
                return Err(JsValue::from_str("SECURITY_ERR: Value out of range [0-9]"));
            }
            initial_clues[idx] = val;
        }

        let mut engine = SudokuEngine {
            initial_clues,
            user_inputs: [0u8; 81],
            cells: [ALL_CANDIDATES; 81],
        };

        if !engine.rebuild_and_propagate() {
            return Err(JsValue::from_str("VALIDATION_ERR: Inherent puzzle contradiction"));
        }

        Ok(engine)
    }

    /// 返回 `cells` 陣列的零拷貝指標，供前端直接映射 WebAssembly.Memory。
    ///
    /// # Safety & WebAssembly Memory 契約
    ///
    /// 1. **對齊保證**：指標為 2-byte 對齊（指向 `u16`）。JS 側必須使用 `Uint16Array` 視圖存取。
    /// 2. **基底位址穩定性**：`cells` 為固定大小陣列 `[BitMask; 81]`，落子操作僅修改記憶體內容，不會改變基底位址。
    /// 3. **記憶體增長脫鉤防禦 (Detached Buffer Trap)**：
    ///    若宿主環境或任何操作引發了 `WebAssembly.Memory.grow`，所有既有的 JS `TypedArray` 視圖會立即失效。
    ///    前端呼叫端必須在每次寫入操作後，重新透過 `memory.buffer` 構建視圖，禁止長期快取。
    ///
    /// # Returns
    /// **wasm-bindgen 返回型別為 JS `number`**（WASM 線性記憶體偏移量）。
    /// JS 端使用範例：
    /// ```js
    /// const ptr = engine.get_cells_ptr();
    /// const cells = new Uint16Array(wasmMemory.buffer, ptr, 81);
    /// ```
    pub fn get_cells_ptr(&self) -> *const BitMask {
        self.cells.as_ptr()
    }

    /// 取得指定儲存格的候選數 BitMask（跨邊界安全唯讀查詢）
    pub fn get_cell_mask(&self, idx: usize) -> Result<u16, JsValue> {
        if idx >= 81 {
            return Err(JsValue::from_str("OUT_OF_BOUNDS: Index out of range"));
        }
        Ok(self.cells[idx])
    }

    /// 驗證當前盤面是否已達到「全確定」純演繹完成狀態（所有格子皆為單一候選數）
    pub fn is_fully_deduced(&self) -> bool {
        self.cells.iter().all(|&m| m.count_ones() == 1)
    }

    /// 尚未確定的格子數量（供前端進度條展示）
    pub fn get_unsolved_count(&self) -> u32 {
        self.cells.iter().filter(|&&m| m.count_ones() > 1).count() as u32
    }

    /// 增量設定儲存格數值（具備冪等短路防禦）
    pub fn set_cell_value(&mut self, idx: usize, val: u8) -> Result<bool, JsValue> {
        if idx >= 81 {
            return Err(JsValue::from_str("OUT_OF_BOUNDS: Index out of range"));
        }
        if val > 9 {
            return Err(JsValue::from_str("INVALID_INPUT: Value must be 0 to 9"));
        }
        if self.initial_clues[idx] != 0 {
            return Err(JsValue::from_str("IMMUTABLE_CLUE: Cannot edit starting clue"));
        }

        let old_val = self.user_inputs[idx];
        if old_val == val {
            return Ok(true); // 冪等短路：相同數值跳過重複傳播開銷
        }

        let backup_cells = self.cells;
        self.user_inputs[idx] = val;

        if val == 0 {
            if !self.rebuild_and_propagate() {
                self.user_inputs[idx] = old_val;
                self.cells = backup_cells;
                return Ok(false);
            }
        } else {
            let target_mask: BitMask = 1u16 << val;
            if (self.cells[idx] & target_mask) == 0 {
                self.user_inputs[idx] = old_val;
                return Ok(false);
            }

            self.cells[idx] = target_mask;
            if !self.propagate_single_cell(idx) {
                self.user_inputs[idx] = old_val;
                self.cells = backup_cells;
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// 批量入隊 + 單次 BFS 全域傳播（O(n) 複雜度）
    fn rebuild_and_propagate(&mut self) -> bool {
        self.cells = [ALL_CANDIDATES; 81];
        let mut queue = [0u8; 81];
        let mut queued = [false; 81];
        let mut q_tail = 0;

        for i in 0..81 {
            let active_val = if self.initial_clues[i] != 0 {
                self.initial_clues[i]
            } else {
                self.user_inputs[i]
            };

            if active_val != 0 {
                let mask: BitMask = 1u16 << active_val;
                self.cells[i] = mask;
                queue[q_tail] = i as u8;
                queued[i] = true;
                q_tail += 1;
            }
        }

        bfs_propagate(&mut self.cells, &mut queue, &mut queued, q_tail)
    }

    /// 單格落子專用傳播入口
    fn propagate_single_cell(&mut self, start_idx: usize) -> bool {
        let mut queue = [0u8; 81];
        let mut queued = [false; 81];
        queue[0] = start_idx as u8;
        queued[start_idx] = true;
        bfs_propagate(&mut self.cells, &mut queue, &mut queued, 1)
    }

    /// 驗證工具（非常態遊玩運算）：使用回溯搜尋計算解空間基數
    ///
    /// # Performance
    /// 針對極端高難度題型，回溯深度可能耗時數毫秒至數十毫秒。
    /// 建議在 Worker 執行緒中呼叫，避免阻塞 UI 渲染循環。
    ///
    /// # Returns
    /// - 0 = 無解
    /// - 1 = 數學唯一解（符合頂級純演繹賽事標準）
    /// - 2 = 多解（至少 2 個解，已觸發剪枝早退）
    pub fn verify_solution_count(&self) -> u32 {
        let mut solver_cells = self.cells;
        let mut count = 0;
        Self::backtrack_count(&mut solver_cells, &mut count);
        count
    }

    /// 原地修改與撤銷（In-place Backtracking & Undo）的 MRV 回溯計數器
    /// 杜絕遞迴呼叫時累積複製大陣列所帶來的堆疊溢位與耗能
    fn backtrack_count(board: &mut [BitMask; 81], count: &mut u32) {
        if *count >= 2 {
            return;
        }

        let mut min_candidates = 10;
        let mut best_idx = None;

        // 單次線性掃描：優先攔截矛盾死局格
        for i in 0..81 {
            let ones = board[i].count_ones();
            if ones == 0 {
                return; // 存在無候選數的矛盾格，立即剪枝
            }
            if ones > 1 && ones < min_candidates {
                min_candidates = ones;
                best_idx = Some(i);
                if ones == 2 {
                    // 已達最優分支因子，但需繼續確保未掃描格子沒有 0
                    for j in (i + 1)..81 {
                        if board[j].count_ones() == 0 {
                            return;
                        }
                    }
                    break;
                }
            }
        }

        let best_idx = match best_idx {
            None => {
                // 所有格子皆只有 1 個候選數且無 0，確認為一個合法解
                *count += 1;
                return;
            }
            Some(idx) => idx,
        };

        let candidate_mask = board[best_idx];

        for val in 1..=9 {
            let mask: BitMask = 1u16 << val;
            if (candidate_mask & mask) == 0 {
                continue;
            }

            // 原地修改前備份盤面狀態
            let backup = *board;
            board[best_idx] = mask;

            let mut queue = [0u8; 81];
            let mut queued = [false; 81];
            queue[0] = best_idx as u8;
            queued[best_idx] = true;

            if bfs_propagate(board, &mut queue, &mut queued, 1) {
                Self::backtrack_count(board, count);
                if *count >= 2 {
                    *board = backup;
                    return;
                }
            }

            // 狀態撤銷，恢復回溯分支點
            *board = backup;
        }
    }
}

// ── 原生純 Rust 單元測試 ──
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bfs_propagate_detects_direct_peer_contradiction() {
        let mut cells = [ALL_CANDIDATES; 81];
        cells[0] = 1u16 << 1;
        cells[1] = 1u16 << 1;

        let mut queue = [0u8; 81];
        let mut queued = [false; 81];
        queue[0] = 0;
        queue[1] = 1;
        queued[0] = true;
        queued[1] = true;

        assert!(!bfs_propagate(&mut cells, &mut queue, &mut queued, 2));
    }

    #[test]
    fn test_backtrack_count_aborts_on_zero_candidate_dead_end() {
        let mut board = [ALL_CANDIDATES; 81];
        board[0] = 0; // 注入零候選數矛盾
        let mut count = 0;

        SudokuEngine::backtrack_count(&mut board, &mut count);
        assert_eq!(count, 0, "零候選數的死路必須返回 0，不可誤判為有效解");
    }

    #[test]
    fn test_backtrack_count_detects_late_dead_end_with_binary_branch() {
        let mut board = [ALL_CANDIDATES; 81];
        board[2] = (1u16 << 1) | (1u16 << 2);
        board[80] = 0;

        let mut count = 0;
        SudokuEngine::backtrack_count(&mut board, &mut count);
        assert_eq!(count, 0, "二分支之後出現死局時，必須即刻剪枝");
    }
}
