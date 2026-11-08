#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

// Buffer RGBA para renderizado directo en Canvas (soporta hasta 1280x720 en buffer interno escalable)
const MAX_WIDTH: usize = 1280;
const MAX_HEIGHT: usize = 720;
const BUFFER_SIZE: usize = MAX_WIDTH * MAX_HEIGHT * 4;

static mut PIXEL_BUFFER: [u8; BUFFER_SIZE] = [0; BUFFER_SIZE];

#[inline(always)]
fn sin_approx(mut x: f32) -> f32 {
    const PI: f32 = 3.14159265359;
    const TWO_PI: f32 = 6.28318530718;

    x %= TWO_PI;
    if x < 0.0 {
        x += TWO_PI;
    }

    let sign = if x > PI {
        x -= PI;
        -1.0
    } else {
        1.0
    };

    let y = x * (PI - x);
    sign * (16.0 * y) / (5.0 * PI * PI - 4.0 * y)
}

#[inline(always)]
fn cos_approx(x: f32) -> f32 {
    sin_approx(x + 1.57079632679)
}

// Aproximación rápida de log2(x) en IEEE-754 para suavizado continuo de bandas
#[inline(always)]
fn fast_log2(x: f32) -> f32 {
    let bits = x.to_bits();
    let exp = ((bits >> 23) & 0xFF) as i32 - 127;
    let mantissa = f32::from_bits((bits & 0x007F_FFFF) | 0x3F80_0000);
    (exp as f32) + (mantissa - 1.0) * (1.442695 - 0.360673 * (mantissa - 1.0))
}

#[inline(always)]
fn map_color(smooth_t: f32, palette: u32, shift: f32) -> (u8, u8, u8) {
    let angle = smooth_t * 0.14 + shift;
    let c1 = 0.5 + 0.5 * cos_approx(angle);
    let c2 = 0.5 + 0.5 * cos_approx(angle + 2.094395);
    let c3 = 0.5 + 0.5 * cos_approx(angle + 4.188790);

    let (r, g, b) = match palette {
        // 1: Cyber / Synthwave (Magenta, Violeta, Cian)
        1 => (
            (c1 * 245.0 + 10.0) as u8,
            (c3 * 190.0) as u8,
            (c2 * 235.0 + 20.0) as u8,
        ),
        // 2: Solar / Fuego (Oro, Ámbar, Carmesí)
        2 => {
            let glow = 0.5 + 0.5 * sin_approx(smooth_t * 0.11 + shift);
            (
                (glow * 255.0) as u8,
                (glow * glow * 210.0) as u8,
                (c3 * 95.0) as u8,
            )
        }
        // 3: Esmeralda / Bio-Matrix
        3 => (
            (c2 * 80.0) as u8,
            (c1 * 245.0 + 10.0) as u8,
            (c3 * 185.0 + 25.0) as u8,
        ),
        // 0: Cosmos / Cian-Azul-Violeta (por defecto)
        _ => (
            (c3 * 165.0) as u8,
            (c1 * 245.0) as u8,
            (c2 * 235.0 + 20.0) as u8,
        ),
    };

    (r, g, b)
}

#[no_mangle]
pub extern "C" fn get_pixel_buffer_ptr() -> *const u8 {
    core::ptr::addr_of!(PIXEL_BUFFER) as *const u8
}

/// Renderiza el fractal en `PIXEL_BUFFER` y devuelve el porcentaje (0..1000) de píxeles en el interior del conjunto.
#[no_mangle]
pub extern "C" fn render_fractal(
    width: usize,
    height: usize,
    center_x: f64,
    center_y: f64,
    scale: f64,
    julia_cx: f64,
    julia_cy: f64,
    max_iter: u32,
    fractal_type: u32,
    palette: u32,
    color_shift: f32,
) -> u32 {
    let w = width.min(MAX_WIDTH);
    let h = height.min(MAX_HEIGHT);
    if w == 0 || h == 0 {
        return 0;
    }

    let half_w = (w as f64) * 0.5;
    let half_h = (h as f64) * 0.5;
    let pixel_step = scale / (w as f64);
    let max_it = max_iter.clamp(16, 1024);

    let mut inside_count: u32 = 0;

    unsafe {
        let buf = core::ptr::addr_of_mut!(PIXEL_BUFFER) as *mut u8;

        for py in 0..h {
            let y0 = center_y + ((py as f64) - half_h) * pixel_step;
            let row_offset = py * w * 4;

            for px in 0..w {
                let x0 = center_x + ((px as f64) - half_w) * pixel_step;

                let (mut zr, mut zi, cr, ci) = if fractal_type == 1 {
                    // Julia
                    (x0, y0, julia_cx, julia_cy)
                } else {
                    // Mandelbrot, Burning Ship, Tricorn
                    (0.0, 0.0, x0, y0)
                };

                let mut iter: u32 = 0;
                let mut zr2 = zr * zr;
                let mut zi2 = zi * zi;

                while zr2 + zi2 <= 16.0 && iter < max_it {
                    match fractal_type {
                        // Burning Ship
                        2 => {
                            let abs_zr = if zr < 0.0 { -zr } else { zr };
                            let abs_zi = if zi < 0.0 { -zi } else { zi };
                            zi = 2.0 * abs_zr * abs_zi + ci;
                            zr = zr2 - zi2 + cr;
                        }
                        // Tricorn (Mandelbar)
                        3 => {
                            zi = -2.0 * zr * zi + ci;
                            zr = zr2 - zi2 + cr;
                        }
                        // Mandelbrot (0) y Julia (1)
                        _ => {
                            zi = 2.0 * zr * zi + ci;
                            zr = zr2 - zi2 + cr;
                        }
                    }

                    zr2 = zr * zr;
                    zi2 = zi * zi;
                    iter += 1;
                }

                let idx = row_offset + px * 4;
                if iter >= max_it {
                    inside_count += 1;
                    *buf.add(idx) = 5;
                    *buf.add(idx + 1) = 7;
                    *buf.add(idx + 2) = 13;
                    *buf.add(idx + 3) = 255;
                } else {
                    let mag_sq = (zr2 + zi2) as f32;
                    let log_zn = 0.5 * fast_log2(mag_sq.max(1.0001));
                    let nu = fast_log2(log_zn.max(0.0001));
                    let smooth = (iter as f32) + 1.0 - nu;

                    let (r, g, b) = map_color(smooth.max(0.0), palette, color_shift);
                    *buf.add(idx) = r;
                    *buf.add(idx + 1) = g;
                    *buf.add(idx + 2) = b;
                    *buf.add(idx + 3) = 255;
                }
            }
        }
    }

    let total_pixels = (w * h) as u32;
    if total_pixels > 0 {
        (inside_count * 1000) / total_pixels
    } else {
        0
    }
}
