use wasm_bindgen::prelude::*;
use std::collections::VecDeque;

type BitMask = u16;
const ALL_CANDIDATES: BitMask = 0x03FE;
const MAX_ITERATIONS: usize = 2000;

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

        if !engine.full_recompute() {
            return Err(JsValue::from_str("VALIDATION_ERR: Inherent contradictions"));
        }

        Ok(engine)
    }

    fn full_recompute(&mut self) -> bool {
        self.cells = [ALL_CANDIDATES; 81];
        let mut queue: VecDeque<usize> = VecDeque::with_capacity(81);

        for idx in 0..81 {
            let active_val = if self.initial_clues[idx] != 0 {
                self.initial_clues[idx]
            } else {
                self.user_inputs[idx]
            };

            if active_val != 0 {
                self.cells[idx] = 1 << active_val;
                queue.push_back(idx);
            }
        }

        let mut iterations = 0;
        while let Some(idx) = queue.pop_front() {
            iterations += 1;
            if iterations > MAX_ITERATIONS {
                return false;
            }

            let fixed_mask = self.cells[idx];
            if fixed_mask.count_ones() != 1 {
                continue;
            }

            let peers = get_peers_static(idx);
            for &peer in peers.iter() {
                if (self.cells[peer] & fixed_mask) != 0 {
                    let new_mask = self.cells[peer] & !fixed_mask;
                    if new_mask == 0 {
                        return false;
                    }
                    if new_mask != self.cells[peer] {
                        self.cells[peer] = new_mask;
                        if new_mask.count_ones() == 1 {
                            queue.push_back(peer);
                        }
                    }
                }
            }
        }
        true
    }

    pub fn get_candidates(&self) -> Vec<u16> {
        self.cells.to_vec()
    }

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
        self.user_inputs[idx] = val;

        let is_valid = self.full_recompute();
        if !is_valid {
            self.user_inputs[idx] = old_val;
            self.full_recompute();
            return Ok(false);
        }

        Ok(true)
    }
}

#[inline(always)]
fn get_peers_static(idx: usize) -> [usize; 20] {
    let mut peers = [0; 20];
    let row = idx / 9;
    let col = idx % 9;
    let start_r = (row / 3) * 3;
    let start_c = (col / 3) * 3;
    let mut count = 0;

    for r in 0..9 {
        for c in 0..9 {
            if r == row && c == col { continue; }
            if r == row || c == col || (r >= start_r && r < start_r + 3 && c >= start_c && c < start_c + 3) {
                peers[count] = r * 9 + c;
                count += 1;
            }
        }
    }
    peers
}
