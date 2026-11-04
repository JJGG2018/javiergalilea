#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_PARTICLES: usize = 12000;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Particle {
    pub x: f32,
    pub y: f32,
    pub vx: f32,
    pub vy: f32,
    pub color_idx: f32,
    pub size: f32,
}

impl Particle {
    pub const fn zero() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            vx: 0.0,
            vy: 0.0,
            color_idx: 0.0,
            size: 0.0,
        }
    }
}

// BSS zero-initialized so it takes 0 bytes in the .wasm binary
static mut PARTICLES: [Particle; MAX_PARTICLES] = [Particle::zero(); MAX_PARTICLES];

// Fast LCG random number generator for WebAssembly
static mut RNG_STATE: u32 = 123456789;

#[inline(always)]
fn rand_u32() -> u32 {
    unsafe {
        RNG_STATE = RNG_STATE.wrapping_mul(1664525).wrapping_add(1013904223);
        RNG_STATE
    }
}

#[inline(always)]
fn rand_f32() -> f32 {
    (rand_u32() as f32) / (u32::MAX as f32)
}

#[no_mangle]
pub extern "C" fn init(count: i32, width: f32, height: f32) -> i32 {
    let n = (count as usize).min(MAX_PARTICLES);
    unsafe {
        let ptr = core::ptr::addr_of_mut!(PARTICLES) as *mut Particle;
        for i in 0..n {
            let p = &mut *ptr.add(i);
            p.x = rand_f32() * width;
            p.y = rand_f32() * height;
            p.vx = (rand_f32() - 0.5) * 3.0;
            p.vy = (rand_f32() - 0.5) * 3.0;
            p.color_idx = (i % 5) as f32;
            p.size = 1.0 + rand_f32() * 2.0;
        }
    }
    n as i32
}

#[no_mangle]
pub extern "C" fn update(
    count: i32,
    width: f32,
    height: f32,
    mx: f32,
    my: f32,
    m_active: i32,
    mode: i32,
    dt: f32,
) -> i32 {
    let n = (count as usize).min(MAX_PARTICLES);
    let is_active = m_active != 0;
    let speed_mult = (dt * 60.0).clamp(0.1, 3.0);

    unsafe {
        let ptr = core::ptr::addr_of_mut!(PARTICLES) as *mut Particle;
        for i in 0..n {
            let p = &mut *ptr.add(i);

            if is_active {
                let dx = mx - p.x;
                let dy = my - p.y;
                let dist_sq = dx * dx + dy * dy + 400.0;

                if dist_sq < 140000.0 {
                    let mut force = 1800.0 / dist_sq;

                    match mode {
                        1 => {
                            // Repel
                            force = -force;
                            p.vx += dx * force;
                            p.vy += dy * force;
                        }
                        2 => {
                            // Vortex
                            p.vx += -dy * force;
                            p.vy += dx * force;
                        }
                        _ => {
                            // Attract
                            p.vx += dx * force;
                            p.vy += dy * force;
                        }
                    }
                }
            }

            // Damping / friction
            p.vx *= 0.985;
            p.vy *= 0.985;

            // Move
            p.x += p.vx * speed_mult;
            p.y += p.vy * speed_mult;

            // Boundary wrapping
            if p.x < 0.0 {
                p.x = width;
            } else if p.x > width {
                p.x = 0.0;
            }

            if p.y < 0.0 {
                p.y = height;
            } else if p.y > height {
                p.y = 0.0;
            }
        }
    }

    n as i32
}

#[no_mangle]
pub extern "C" fn get_memory_offset() -> *const Particle {
    core::ptr::addr_of!(PARTICLES) as *const Particle
}

#[no_mangle]
pub extern "C" fn benchmark_calc(iterations: i32) -> f32 {
    let mut sum: f32 = 0.0;
    for i in 0..iterations {
        let term = 1.0 / (2.0 * (i as f32) + 1.0);
        if (i & 1) == 0 {
            sum += term;
        } else {
            sum -= term;
        }
    }
    sum * 4.0
}
