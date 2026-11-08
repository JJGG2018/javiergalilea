#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_RINGS: usize = 48;
const VERTICES_PER_RING: usize = 16;
// Cada vértice almacena (x, y, radius, alpha)
static mut RINGS_BUFFER: [f32; MAX_RINGS * 4] = [0.0; MAX_RINGS * 4];

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

#[inline]
fn cos_approx(x: f32) -> f32 {
    sin_approx(x + 1.57079632679)
}

#[no_mangle]
pub extern "C" fn get_rings_buffer_ptr() -> *const f32 {
    unsafe { RINGS_BUFFER.as_ptr() }
}

#[no_mangle]
pub extern "C" fn update_tunnel(
    ring_count: usize,
    width: f32,
    height: f32,
    time: f32,
    speed: f32,
    tunnel_curve: f32,
) -> usize {
    unsafe {
        let n = if ring_count <= MAX_RINGS { ring_count } else { MAX_RINGS };
        let cx = width * 0.5;
        let cy = height * 0.5;
        let max_dim = if width > height { width } else { height };

        let t = time * speed;

        for i in 0..n {
            // Progreso z cíclico entre 0.01 y 1.0
            let raw_z = (i as f32 / n as f32 + t) % 1.0;
            // Perspectiva no lineal: los anillos se aceleran hacia la cámara
            let z = raw_z * raw_z;

            // Curvatura del túnel
            let curve_x = sin_approx(t * 0.6 + raw_z * 2.5) * (width * 0.15) * tunnel_curve;
            let curve_y = cos_approx(t * 0.4 + raw_z * 2.0) * (height * 0.12) * tunnel_curve;

            let center_x = cx + curve_x * (1.0 - z);
            let center_y = cy + curve_y * (1.0 - z);

            let radius = z * (max_dim * 0.75) + 2.0;
            // Los anillos lejanos son más tenues, los cercanos más brillantes
            let alpha = z * 0.85 + 0.05;

            let base = i * 4;
            RINGS_BUFFER[base] = center_x;
            RINGS_BUFFER[base + 1] = center_y;
            RINGS_BUFFER[base + 2] = radius;
            RINGS_BUFFER[base + 3] = alpha;
        }

        n
    }
}

