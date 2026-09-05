use wasm_bindgen::prelude::*;

// 🌟 啟用極限羽量級記憶體分配器（配合 Cargo.toml wee_alloc feature）
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

type BitMask = u16;
pub const ALL_CANDIDATES: BitMask = 0x03FE; // Bits 1..=9

// 🌟 編譯期靜態預算 81 格的 20 個正交與九宮鄰居（零運行時運算）
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

#[wasm_bindgen]
pub struct SudokuEngine {
    initial_clues: [u8; 81],
    user_inputs: [u8; 81],
    cells: [BitMask; 81],
    // 🌟 加註 allow(dead_code) 消除編譯器警告
    #[allow(dead_code)]
    history_snapshots: Vec<[BitMask; 81]>,
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
            history_snapshots: Vec::with_capacity(64),
        };

        if !engine.rebuild_and_propagate() {
            return Err(JsValue::from_str("VALIDATION_ERR: Inherent puzzle contradiction"));
        }

        Ok(engine)
    }

    /// 🌟 零拷貝記憶體指針：前端直接對映 WebAssembly.Memory，避免跨語言搬運陣列
    pub fn get_cells_ptr(&self) -> *const BitMask {
        self.cells.as_ptr()
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

        // 保存快照
        let backup_cells = self.cells;
        let old_val = self.user_inputs[idx];
        self.user_inputs[idx] = val;

        if val == 0 {
            // 清除數值時必須完全重建波前
            if !self.rebuild_and_propagate() {
                self.user_inputs[idx] = old_val;
                self.cells = backup_cells;
                return Ok(false);
            }
        } else {
            // 🌟 增量落子傳播：無須從頭重跑，直接在目前狀態下收斂
            let target_mask = 1 << val;
            if (self.cells[idx] & target_mask) == 0 {
                // 候選數中根本不包含此數字，直接判定非法落子
                self.user_inputs[idx] = old_val;
                return Ok(false);
            }

            self.cells[idx] = target_mask;
            if !self.propagate_constraints(idx) {
                // 違規矛盾：O(1) 立即回滾快照
                self.user_inputs[idx] = old_val;
                self.cells = backup_cells;
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// 重建並傳播全域約束
    fn rebuild_and_propagate(&mut self) -> bool {
        self.cells = [ALL_CANDIDATES; 81];

        for i in 0..81 {
            let active_val = if self.initial_clues[i] != 0 {
                self.initial_clues[i]
            } else {
                self.user_inputs[i]
            };

            if active_val != 0 {
                let mask = 1 << active_val;
                if (self.cells[i] & mask) == 0 {
                    return false;
                }
                self.cells[i] = mask;
                if !self.propagate_constraints(i) {
                    return false;
                }
            }
        }
        true
    }

    /// 🌟 超高效固定堆疊波前傳播（完全零 Heap Allocation，查表加速）
    fn propagate_constraints(&mut self, start_idx: usize) -> bool {
        let mut queue = [0u8; 81];
        let mut q_head = 0;
        let mut q_tail = 0;

        queue[q_tail] = start_idx as u8;
        q_tail += 1;

        while q_head < q_tail {
            let idx = queue[q_head] as usize;
            q_head += 1;

            let fixed_mask = self.cells[idx];
            if fixed_mask.count_ones() != 1 {
                continue;
            }

            // 查表取得 20 個 Peers
            let peers = &PEERS_TABLE[idx];
            for &peer_u8 in peers.iter() {
                let peer = peer_u8 as usize;
                let current_mask = self.cells[peer];

                if (current_mask & fixed_mask) != 0 {
                    let new_mask = current_mask & !fixed_mask;
                    if new_mask == 0 {
                        return false; // 候選數耗盡，產生衝突矛盾
                    }

                    if new_mask != current_mask {
                        self.cells[peer] = new_mask;
                        // 若被削成單一候選數，繼續級聯傳播
                        if new_mask.count_ones() == 1 {
                            if q_tail < 81 {
                                queue[q_tail] = peer as u8;
                                q_tail += 1;
                            }
                        }
                    }
                }
            }
        }

        true
    }
}
