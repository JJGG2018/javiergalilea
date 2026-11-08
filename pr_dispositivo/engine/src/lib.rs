#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn calculate_hardware_tier(
    cores: u32,
    ram_gb: f32,
    screen_width: u32,
    screen_height: u32,
    dpr: f32,
    is_mobile: u32,
) -> u32 {
    let mut score: u32 = 0;

    // Núcleos lógicos
    score += cores * 10;

    // Memoria RAM estimada
    if ram_gb >= 16.0 {
        score += 40;
    } else if ram_gb >= 8.0 {
        score += 30;
    } else if ram_gb >= 4.0 {
        score += 20;
    } else {
        score += 10;
    }

    // Resolución total efectiva
    let total_pixels = ((screen_width as f32 * dpr) * (screen_height as f32 * dpr)) as u64;
    if total_pixels >= 3840 * 2160 {
        score += 35; // 4K o superior
    } else if total_pixels >= 2560 * 1440 {
        score += 25; // 1440p
    } else if total_pixels >= 1920 * 1080 {
        score += 18; // 1080p
    } else {
        score += 10;
    }

    // Tipo de dispositivo
    if is_mobile == 1 {
        score += 5;
    } else {
        score += 15;
    }

    score
}

#[no_mangle]
pub extern "C" fn bench_cpu_single_thread(iterations: u32) -> u32 {
    let mut val: u32 = 0x12345678;
    for i in 0..iterations {
        val = val.wrapping_mul(1103515245).wrapping_add(12345);
        val ^= val >> 13;
        val = val.wrapping_add(i);
    }
    val
}
