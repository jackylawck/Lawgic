use wasm_bindgen::prelude::*;

#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[cfg(feature = "console_error_panic_hook")]
#[wasm_bindgen(start)]
pub fn init_engine() {
    console_error_panic_hook::set_once();
}

pub type BitMask = u16;
pub const ALL_CANDIDATES: BitMask = 0x03FE; // Bits 1..=9

/// 編譯期靜態預算 81 格的 20 個正交與九宮鄰居（零運行時計算開銷）
const PEERS_TABLE: [[u8; 20]; 81] = {
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

/// 純函數版波前傳播核心（Single Source of Truth）
/// 不依賴 `&mut self`，可在任何上下文呼叫，支援純原生單元測試
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
                    return false; // 候選數耗盡，產生衝突矛盾
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

    /// 返回 `cells` 陣列的零拷貝指針，供前端直接映射 WebAssembly.Memory。
    ///
    /// # Safety
    /// - 指針在 `SudokuEngine` 實例存活期間有效。
    /// - `cells` 為固定大小連續陣列，落子操作不會改變基址。
    /// - 呼叫端不得在實例釋放或 GC 後存取該指針指向的記憶體區塊。
    pub fn get_cells_ptr(&self) -> *const BitMask {
        self.cells.as_ptr()
    }

    /// 當前盤面是否已達到「全確定」純演繹完成狀態（所有格子皆為單一候選數）
    pub fn is_fully_deduced(&self) -> bool {
        self.cells.iter().all(|&m| m.count_ones() == 1)
    }

    /// 尚未確定的格子數量（供前端進度條展示）
    pub fn get_unsolved_count(&self) -> u32 {
        self.cells.iter().filter(|&&m| m.count_ones() > 1).count() as u32
    }

    /// 增量設定儲存格數值
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

        let backup_cells = self.cells;
        let old_val = self.user_inputs[idx];
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
                if (self.cells[i] & mask) == 0 {
                    return false;
                }
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

    /// 驗證工具（非常態遊玩運算）：使用回溯搜尋計數解空間基數
    /// - 0 = 無解
    /// - 1 = 數學唯一解（符合頂級純演繹賽事標準）
    /// - 2 = 多解（至少 2 個解，已觸發剪枝）
    pub fn verify_solution_count(&self) -> u32 {
        let mut solver_cells = self.cells;
        let mut count = 0;
        Self::backtrack_count(&mut solver_cells, &mut count);
        count
    }

    /// 具備自我完備性的 MRV 回溯計數器
    fn backtrack_count(board: &mut [BitMask; 81], count: &mut u32) {
        if *count >= 2 {
            return;
        }

        let mut min_candidates = 10;
        let mut best_idx = None;
        let mut early_break = false;

        for i in 0..81 {
            let ones = board[i].count_ones();

            if ones == 0 {
                return;
            }

            if ones > 1 && ones < min_candidates {
                min_candidates = ones;
                best_idx = Some(i);
                if ones == 2 {
                    early_break = true;
                    break;
                }
            }
        }

        // N1 修復：若觸發了 MRV 提前跳出，完整補查剩餘格子的矛盾，防禦外部污染
        if early_break {
            for i in 0..81 {
                if board[i].count_ones() == 0 {
                    return;
                }
            }
        }

        let best_idx = match best_idx {
            None => {
                *count += 1;
                return;
            }
            Some(idx) => idx,
        };

        let candidate_mask = board[best_idx];
        for val in 1..=9 {
            let mask: BitMask = 1u16 << val;
            if (candidate_mask & mask) != 0 {
                let mut next_board = *board;
                next_board[best_idx] = mask;

                let mut queue = [0u8; 81];
                let mut queued = [false; 81];
                queue[0] = best_idx as u8;
                queued[best_idx] = true;

                if bfs_propagate(&mut next_board, &mut queue, &mut queued, 1) {
                    Self::backtrack_count(&mut next_board, count);
                    if *count >= 2 {
                        return;
                    }
                }
            }
        }
    }
}

// ── 原生純 Rust 單元測試（得益於 rlib 與純函數設計，無需瀏覽器直接執行）──
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bfs_propagate_detects_direct_peer_contradiction() {
        let mut cells = [ALL_CANDIDATES; 81];
        cells[0] = 1u16 << 1; // (0,0) 設定為 1
        cells[1] = 1u16 << 1; // (0,1) 同行也設定為 1（直接矛盾）

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
        board[0] = 0; // 手動注入死路（零候選數）
        let mut count = 0;

        SudokuEngine::backtrack_count(&mut board, &mut count);
        assert_eq!(count, 0, "零候選數的死路必須返回 0，不可誤判為有效解");
    }
}
