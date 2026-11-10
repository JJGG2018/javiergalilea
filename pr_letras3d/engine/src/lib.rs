#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_NODES: usize = 4096;

// [tx, ty, tz, letter_id]
static mut TARGETS: [f32; MAX_NODES * 4] = [0.0; MAX_NODES * 4];
// [x, y, z, vx, vy, vz]
static mut STATE: [f32; MAX_NODES * 6] = [0.0; MAX_NODES * 6];
// [sx, sy, sz, scale, shade, letter_id]
static mut PROJECTED: [f32; MAX_NODES * 6] = [0.0; MAX_NODES * 6];

static mut RNG_STATE: u32 = 987654321;

#[inline(always)]
fn rand_f32() -> f32 {
    unsafe {
        RNG_STATE = RNG_STATE.wrapping_mul(1664525).wrapping_add(1013904223);
        (RNG_STATE as f32) / (u32::MAX as f32)
    }
}

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
    sign * ((16.0 * y) / (5.0 * PI * PI - 4.0 * y))
}

#[inline(always)]
fn cos_approx(x: f32) -> f32 {
    sin_approx(x + 1.57079632679)
}

#[no_mangle]
pub extern "C" fn get_targets_ptr() -> *mut f32 {
    unsafe { core::ptr::addr_of_mut!(TARGETS) as *mut f32 }
}

#[no_mangle]
pub extern "C" fn get_projected_ptr() -> *const f32 {
    unsafe { core::ptr::addr_of!(PROJECTED) as *const f32 }
}

#[no_mangle]
pub extern "C" fn snap_to_targets(count: usize) {
    let n = if count <= MAX_NODES { count } else { MAX_NODES };
    unsafe {
        for i in 0..n {
            let t_base = i * 4;
            let s_base = i * 6;
            STATE[s_base] = TARGETS[t_base] * 1.4;
            STATE[s_base + 1] = TARGETS[t_base + 1] * 1.4;
            STATE[s_base + 2] = TARGETS[t_base + 2] + (rand_f32() - 0.5) * 380.0;
            STATE[s_base + 3] = 0.0;
            STATE[s_base + 4] = 0.0;
            STATE[s_base + 5] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn explode(count: usize, strength: f32) {
    let n = if count <= MAX_NODES { count } else { MAX_NODES };
    unsafe {
        for i in 0..n {
            let s_base = i * 6;
            let x = STATE[s_base];
            let y = STATE[s_base + 1];
            let z = STATE[s_base + 2];

            let nx = x * 0.015 + (rand_f32() - 0.5) * 2.2;
            let ny = y * 0.015 + (rand_f32() - 0.5) * 2.2;
            let nz = z * 0.025 + (rand_f32() - 0.5) * 3.0;

            STATE[s_base + 3] += nx * strength;
            STATE[s_base + 4] += ny * strength;
            STATE[s_base + 5] += nz * strength;
        }
    }
}

#[no_mangle]
pub extern "C" fn update_scene(
    count: usize,
    width: f32,
    height: f32,
    rot_x: f32,
    rot_y: f32,
    zoom: f32,
    time: f32,
    dt: f32,
    anim_mode: i32,
    depth_mult: f32,
    mx: f32,
    my: f32,
    m_active: i32,
    m_radius: f32,
) -> usize {
    let n = if count <= MAX_NODES { count } else { MAX_NODES };
    let step = (dt * 60.0).clamp(0.2, 2.5);

    let sin_x = sin_approx(rot_x);
    let cos_x = cos_approx(rot_x);
    let sin_y = sin_approx(rot_y);
    let cos_y = cos_approx(rot_y);

    let fov: f32 = 760.0;
    let cam_dist: f32 = 640.0 / zoom.clamp(0.4, 2.5);
    let cx = width * 0.5;
    let cy = height * 0.5;
    let r_sq = m_radius * m_radius;

    unsafe {
        for i in 0..n {
            let t_base = i * 4;
            let s_base = i * 6;

            let base_tx = TARGETS[t_base];
            let base_ty = TARGETS[t_base + 1];
            let base_tz = TARGETS[t_base + 2] * depth_mult;
            let letter_id = TARGETS[t_base + 3];

            let mut anim_tx = base_tx;
            let mut anim_ty = base_ty;
            let mut anim_tz = base_tz;

            match anim_mode {
                0 => {
                    // Onda Sinusoidal 3D
                    let wave = sin_approx(time * 2.6 + base_tx * 0.011 + letter_id * 0.45);
                    let wave2 = cos_approx(time * 1.9 + base_ty * 0.014);
                    anim_ty += wave * 14.0;
                    anim_tz += wave * 38.0 + wave2 * 16.0;
                }
                1 => {
                    // Torsión Helicoidal / ADN 3D
                    let twist = sin_approx(time * 1.8 + base_tx * 0.007) * 0.75;
                    let st = sin_approx(twist);
                    let ct = cos_approx(twist);
                    let ny = base_ty * ct - base_tz * st;
                    let nz = base_ty * st + base_tz * ct;
                    anim_ty = ny;
                    anim_tz = nz;
                }
                2 => {
                    // Levitación por letra + Pulso Cuántico
                    let phase = time * 2.2 + letter_id * 0.85;
                    let pulse = 1.0 + sin_approx(time * 3.0 + letter_id * 0.5) * 0.35;
                    anim_tx += cos_approx(phase * 0.7) * 6.0;
                    anim_ty += sin_approx(phase) * 16.0;
                    anim_tz = base_tz * pulse + cos_approx(phase) * 32.0;
                }
                _ => {
                    // Vórtice Respiratorio 3D
                    let angle = sin_approx(time * 1.4 + letter_id * 0.3) * 0.28;
                    let sa = sin_approx(angle);
                    let ca = cos_approx(angle);
                    anim_tx = base_tx * ca - base_tz * sa;
                    anim_tz = base_tx * sa + base_tz * ca;
                    anim_ty += sin_approx(time * 2.4 + base_tx * 0.015) * 10.0;
                }
            }

            let mut x = STATE[s_base];
            let mut y = STATE[s_base + 1];
            let mut z = STATE[s_base + 2];
            let mut vx = STATE[s_base + 3];
            let mut vy = STATE[s_base + 4];
            let mut vz = STATE[s_base + 5];

            // Fuerza elástica de retorno al objetivo 3D (Ley de Hooke)
            let spring_k = 0.085;
            vx += (anim_tx - x) * spring_k;
            vy += (anim_ty - y) * spring_k;
            vz += (anim_tz - z) * spring_k;

            // Amortiguación suave
            let damping = 0.84;
            vx *= damping;
            vy *= damping;
            vz *= damping;

            x += vx * step;
            y += vy * step;
            z += vz * step;

            // Rotación 3D en eje Y y luego eje X
            let rx1 = x * cos_y + z * sin_y;
            let rz1 = -x * sin_y + z * cos_y;
            let ry1 = y;

            let rx2 = rx1;
            let ry2 = ry1 * cos_x - rz1 * sin_x;
            let rz2 = ry1 * sin_x + rz1 * cos_x;

            let mut z_cam = rz2 + cam_dist;
            if z_cam < 80.0 {
                z_cam = 80.0;
            }
            let scale = fov / z_cam;
            let sx = cx + rx2 * scale;
            let sy = cy + ry2 * scale;

            // Interacción física 3D con el cursor
            if m_active != 0 {
                let dx = sx - mx;
                let dy = sy - my;
                let dist_sq = dx * dx + dy * dy;
                if dist_sq < r_sq && dist_sq > 0.001 {
                    let factor = (1.0 - dist_sq / r_sq) * 2.6;
                    // Empuje en espacio 3D inverso a la rotación de cámara
                    let push_x = dx * 0.12 * factor;
                    let push_y = dy * 0.12 * factor;
                    let push_z = -22.0 * factor;

                    vx += push_x * cos_y - push_z * sin_y;
                    vy += push_y;
                    vz += push_x * sin_y + push_z * cos_y;
                }
            }

            STATE[s_base] = x;
            STATE[s_base + 1] = y;
            STATE[s_base + 2] = z;
            STATE[s_base + 3] = vx;
            STATE[s_base + 4] = vy;
            STATE[s_base + 5] = vz;

            // Iluminación direccional 3D + profundidad
            let depth_norm = ((120.0 - rz2) / 240.0).clamp(0.25, 1.35);
            let specular = if base_tz > 0.0 { 1.15 } else { 0.82 };
            let shade = depth_norm * specular;

            PROJECTED[s_base] = sx;
            PROJECTED[s_base + 1] = sy;
            PROJECTED[s_base + 2] = rz2;
            PROJECTED[s_base + 3] = scale;
            PROJECTED[s_base + 4] = shade;
            PROJECTED[s_base + 5] = letter_id;
        }
    }

    n
}
