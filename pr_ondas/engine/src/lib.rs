#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_SAMPLES: usize = 2048;
// Coordenadas [x, y, x, y...] para las ondas
static mut WAVE_BUFFER: [f32; MAX_SAMPLES * 2] = [0.0; MAX_SAMPLES * 2];

#[inline]
fn sin_approx(mut x: f32) -> f32 {
    const PI: f32 = 3.14159265359;
    const TWO_PI: f32 = 6.28318530718;

    while x < 0.0 {
        x += TWO_PI;
    }
    while x >= TWO_PI {
        x -= TWO_PI;
    }

    if x > PI {
        return -sin_approx(x - PI);
    }

    let y = x * (PI - x);
    (16.0 * y) / (5.0 * PI * PI - 4.0 * y)
}

#[no_mangle]
pub extern "C" fn get_wave_buffer_ptr() -> *const f32 {
    unsafe { WAVE_BUFFER.as_ptr() }
}

#[no_mangle]
pub extern "C" fn calculate_harmonics(
    samples: usize,
    width: f32,
    height: f32,
    base_freq: f32,
    harmonic_layer: usize,
    time: f32,
    amp_mod: f32,
) -> usize {
    unsafe {
        let n = if samples <= MAX_SAMPLES { samples } else { MAX_SAMPLES };
        let cy = height * 0.5;
        let h = harmonic_layer as f32;
        let amp = (45.0 * amp_mod) / (h * 0.65);
        let freq_scale = (base_freq * 0.0003) * h;
        let speed = h * 0.9;

        for i in 0..n {
            let x = (i as f32 / (n - 1) as f32) * width;
            let edge = sin_approx((x / width) * 3.14159265);
            let y = cy + sin_approx(x * freq_scale + time * speed) * amp * edge;

            let base = i * 2;
            WAVE_BUFFER[base] = x;
            WAVE_BUFFER[base + 1] = y;
        }

        n
    }
}

#[no_mangle]
pub extern "C" fn calculate_lissajous(
    samples: usize,
    cx: f32,
    cy: f32,
    radius_x: f32,
    radius_y: f32,
    a: f32,
    b: f32,
    delta: f32,
) -> usize {
    unsafe {
        let n = if samples <= MAX_SAMPLES { samples } else { MAX_SAMPLES };
        const TWO_PI: f32 = 6.28318530718;

        for i in 0..n {
            let theta = (i as f32 / n as f32) * TWO_PI;
            let x = cx + radius_x * sin_approx(a * theta + delta);
            let y = cy + radius_y * sin_approx(b * theta);

            let base = i * 2;
            WAVE_BUFFER[base] = x;
            WAVE_BUFFER[base + 1] = y;
        }

        n
    }
}

