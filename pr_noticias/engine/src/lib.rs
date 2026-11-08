#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_ITEMS: usize = 256;
static mut SHUFFLED_INDICES: [u16; MAX_ITEMS] = [0; MAX_ITEMS];

#[no_mangle]
pub extern "C" fn get_shuffled_ptr() -> *const u16 {
    unsafe { SHUFFLED_INDICES.as_ptr() }
}

#[no_mangle]
pub extern "C" fn shuffle_news(count: usize, seed: u32) -> usize {
    unsafe {
        let n = if count <= MAX_ITEMS { count } else { MAX_ITEMS };
        if n == 0 {
            return 0;
        }

        // Inicializar array 0..n
        for i in 0..n {
            SHUFFLED_INDICES[i] = i as u16;
        }

        // Algoritmo Fisher-Yates con generador pseudoaleatorio LCG
        let mut rng = seed.wrapping_mul(1664525).wrapping_add(1013904223);

        for i in (1..n).rev() {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            let j = ((rng >> 16) as usize) % (i + 1);

            let tmp = SHUFFLED_INDICES[i];
            SHUFFLED_INDICES[i] = SHUFFLED_INDICES[j];
            SHUFFLED_INDICES[j] = tmp;
        }

        n
    }
}
