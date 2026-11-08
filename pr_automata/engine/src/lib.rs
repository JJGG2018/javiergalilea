#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_CELLS: usize = 3840 * 2160 / 64; // Soporte hasta 4K
static mut GRID_CURRENT: [u8; MAX_CELLS] = [0; MAX_CELLS];
static mut GRID_NEXT: [u8; MAX_CELLS] = [0; MAX_CELLS];
static mut AGE_BUFFER: [u8; MAX_CELLS] = [0; MAX_CELLS];

static mut COLS: usize = 0;
static mut ROWS: usize = 0;
static mut RULE_MODE: u32 = 0; // 0 = Conway, 1 = HighLife, 2 = Seeds, 3 = Day & Night

#[no_mangle]
pub extern "C" fn init_automata(c: usize, r: usize, seed_random: u32) -> *const u8 {
    unsafe {
        COLS = if c * r <= MAX_CELLS { c } else { 100 };
        ROWS = if c * r <= MAX_CELLS { r } else { 100 };
        let total = COLS * ROWS;

        let mut rng_state: u32 = seed_random.wrapping_mul(1664525).wrapping_add(1013904223);

        for i in 0..total {
            rng_state = rng_state.wrapping_mul(1664525).wrapping_add(1013904223);
            let alive = if (rng_state >> 16) % 100 < 18 { 1 } else { 0 };
            GRID_CURRENT[i] = alive;
            AGE_BUFFER[i] = alive;
            GRID_NEXT[i] = 0;
        }

        GRID_CURRENT.as_ptr()
    }
}

#[no_mangle]
pub extern "C" fn set_rule(mode: u32) {
    unsafe {
        RULE_MODE = mode;
    }
}

#[no_mangle]
pub extern "C" fn get_current_grid_ptr() -> *const u8 {
    unsafe { GRID_CURRENT.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_age_buffer_ptr() -> *const u8 {
    unsafe { AGE_BUFFER.as_ptr() }
}

#[no_mangle]
pub extern "C" fn set_cell(x: usize, y: usize, state: u8) {
    unsafe {
        if x < COLS && y < ROWS {
            let idx = y * COLS + x;
            GRID_CURRENT[idx] = state;
            AGE_BUFFER[idx] = state;
        }
    }
}

#[no_mangle]
pub extern "C" fn clear_cells() {
    unsafe {
        let total = COLS * ROWS;
        for i in 0..total {
            GRID_CURRENT[i] = 0;
            GRID_NEXT[i] = 0;
            AGE_BUFFER[i] = 0;
        }
    }
}

#[no_mangle]
pub extern "C" fn step_generation() -> u32 {
    unsafe {
        let cols = COLS;
        let rows = ROWS;
        let rule = RULE_MODE;
        let mut alive_count: u32 = 0;

        for y in 0..rows {
            let y_up = if y == 0 { rows - 1 } else { y - 1 };
            let y_down = if y + 1 == rows { 0 } else { y + 1 };

            let row_idx = y * cols;
            let up_idx = y_up * cols;
            let down_idx = y_down * cols;

            for x in 0..cols {
                let x_left = if x == 0 { cols - 1 } else { x - 1 };
                let x_right = if x + 1 == cols { 0 } else { x + 1 };

                // Suma de los 8 vecinos
                let neighbors = GRID_CURRENT[up_idx + x_left] as u32
                    + GRID_CURRENT[up_idx + x] as u32
                    + GRID_CURRENT[up_idx + x_right] as u32
                    + GRID_CURRENT[row_idx + x_left] as u32
                    + GRID_CURRENT[row_idx + x_right] as u32
                    + GRID_CURRENT[down_idx + x_left] as u32
                    + GRID_CURRENT[down_idx + x] as u32
                    + GRID_CURRENT[down_idx + x_right] as u32;

                let idx = row_idx + x;
                let state = GRID_CURRENT[idx];

                // Reglas implementadas directamente en Rust
                let will_live = match rule {
                    // HighLife: B36 / S23
                    1 => {
                        if state == 1 {
                            neighbors == 2 || neighbors == 3
                        } else {
                            neighbors == 3 || neighbors == 6
                        }
                    }
                    // Seeds: B2 / S
                    2 => state == 0 && neighbors == 2,
                    // Day & Night: B3678 / S34678
                    3 => {
                        if state == 1 {
                            neighbors == 3 || neighbors == 4 || neighbors == 6 || neighbors == 7 || neighbors == 8
                        } else {
                            neighbors == 3 || neighbors == 6 || neighbors == 7 || neighbors == 8
                        }
                    }
                    // Conway clásico: B3 / S23
                    _ => {
                        if state == 1 {
                            neighbors == 2 || neighbors == 3
                        } else {
                            neighbors == 3
                        }
                    }
                };

                let new_state = if will_live { 1u8 } else { 0u8 };
                GRID_NEXT[idx] = new_state;

                if will_live {
                    alive_count += 1;
                    let age = AGE_BUFFER[idx];
                    AGE_BUFFER[idx] = if age < 255 { age + 1 } else { 255 };
                } else {
                    AGE_BUFFER[idx] = 0;
                }
            }
        }

        // Volcar GRID_NEXT a GRID_CURRENT
        let total = cols * rows;
        for i in 0..total {
            GRID_CURRENT[i] = GRID_NEXT[i];
        }

        alive_count
    }
}

