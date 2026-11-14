#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const BATCH_TRIS: usize = 4096;
const BUF_FLOATS: usize = BATCH_TRIS * 9;
const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;

// Buffers de lote para vértices de triángulos (ax,ay,az, bx,by,bz, cx,cy,cz)
static mut POS_BUF: [f32; BUF_FLOATS] = [0.0; BUF_FLOATS];
static mut NORM_BUF: [f32; BUF_FLOATS] = [0.0; BUF_FLOATS];

// [0..2]: min(x,y,z), [3..5]: max(x,y,z), [6]: area, [7]: vol, [8]: tri_count,
// [9]: degen_count, [10..12]: center(x,y,z), [13]: norm_scale
static mut STATS: [f32; 16] = [0.0; 16];

// [0]: yaw, [1]: pitch, [2]: dist, [3]: pan_x, [4]: pan_y, [5]: pan_z, [6]: auto_time, [7]: tour_step
static mut CAM_STATE: [f32; 8] = [0.65, 0.42, 3.2, 0.0, 0.0, 0.0, 0.0, 0.0];

static mut MIN_X: f32 = 0.0;
static mut MIN_Y: f32 = 0.0;
static mut MIN_Z: f32 = 0.0;
static mut MAX_X: f32 = 0.0;
static mut MAX_Y: f32 = 0.0;
static mut MAX_Z: f32 = 0.0;
static mut ACC_AREA: f32 = 0.0;
static mut ACC_VOL: f32 = 0.0;
static mut TOTAL_TRIS: u32 = 0;
static mut DEGEN_TRIS: u32 = 0;
static mut HAS_POINTS: bool = false;

#[inline(always)]
fn abs_f32(x: f32) -> f32 {
    if x < 0.0 { -x } else { x }
}

#[inline(always)]
fn sqrt_approx(x: f32) -> f32 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut y = x;
    let mut i = y.to_bits();
    i = 0x5f3759df - (i >> 1);
    y = f32::from_bits(i);
    y = y * (1.5 - 0.5 * x * y * y);
    y = y * (1.5 - 0.5 * x * y * y);
    y = y * (1.5 - 0.5 * x * y * y);
    x * y
}

#[inline(always)]
fn sin_approx(mut x: f32) -> f32 {
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

#[inline(always)]
fn smoothstep01(t: f32) -> f32 {
    let c = t.clamp(0.0, 1.0);
    c * c * (3.0 - 2.0 * c)
}

#[no_mangle]
pub extern "C" fn get_pos_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(POS_BUF) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_norm_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(NORM_BUF) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_stats_ptr() -> *const f32 {
    core::ptr::addr_of!(STATS) as *const f32
}

#[no_mangle]
pub extern "C" fn get_cam_ptr() -> *mut f32 {
    core::ptr::addr_of_mut!(CAM_STATE) as *mut f32
}

#[no_mangle]
pub extern "C" fn get_batch_capacity() -> usize {
    BATCH_TRIS
}

#[no_mangle]
pub extern "C" fn begin_analysis() {
    unsafe {
        MIN_X = 1.0e30;
        MIN_Y = 1.0e30;
        MIN_Z = 1.0e30;
        MAX_X = -1.0e30;
        MAX_Y = -1.0e30;
        MAX_Z = -1.0e30;
        ACC_AREA = 0.0;
        ACC_VOL = 0.0;
        TOTAL_TRIS = 0;
        DEGEN_TRIS = 0;
        HAS_POINTS = false;
        for i in 0..16 {
            STATS[i] = 0.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn analyze_batch(tri_count: usize, compute_normals: i32) {
    let n = if tri_count <= BATCH_TRIS { tri_count } else { BATCH_TRIS };
    unsafe {
        for t in 0..n {
            let b = t * 9;
            let ax = POS_BUF[b];
            let ay = POS_BUF[b + 1];
            let az = POS_BUF[b + 2];
            let bx = POS_BUF[b + 3];
            let by = POS_BUF[b + 4];
            let bz = POS_BUF[b + 5];
            let cx = POS_BUF[b + 6];
            let cy = POS_BUF[b + 7];
            let cz = POS_BUF[b + 8];

            if !ax.is_finite() || !ay.is_finite() || !az.is_finite()
                || !bx.is_finite() || !by.is_finite() || !bz.is_finite()
                || !cx.is_finite() || !cy.is_finite() || !cz.is_finite()
            {
                DEGEN_TRIS += 1;
                continue;
            }

            HAS_POINTS = true;
            TOTAL_TRIS += 1;

            // AABB update
            if ax < MIN_X { MIN_X = ax; }
            if bx < MIN_X { MIN_X = bx; }
            if cx < MIN_X { MIN_X = cx; }
            if ax > MAX_X { MAX_X = ax; }
            if bx > MAX_X { MAX_X = bx; }
            if cx > MAX_X { MAX_X = cx; }

            if ay < MIN_Y { MIN_Y = ay; }
            if by < MIN_Y { MIN_Y = by; }
            if cy < MIN_Y { MIN_Y = cy; }
            if ay > MAX_Y { MAX_Y = ay; }
            if by > MAX_Y { MAX_Y = by; }
            if cy > MAX_Y { MAX_Y = cy; }

            if az < MIN_Z { MIN_Z = az; }
            if bz < MIN_Z { MIN_Z = bz; }
            if cz < MIN_Z { MIN_Z = cz; }
            if az > MAX_Z { MAX_Z = az; }
            if bz > MAX_Z { MAX_Z = bz; }
            if cz > MAX_Z { MAX_Z = cz; }

            // Vectores de arista
            let e1x = bx - ax;
            let e1y = by - ay;
            let e1z = bz - az;
            let e2x = cx - ax;
            let e2y = cy - ay;
            let e2z = cz - az;

            // Producto vectorial e1 x e2
            let nx = e1y * e2z - e1z * e2y;
            let ny = e1z * e2x - e1x * e2z;
            let nz = e1x * e2y - e1y * e2x;

            let len_sq = nx * nx + ny * ny + nz * nz;
            if len_sq > 1.0e-20 {
                let len = sqrt_approx(len_sq);
                ACC_AREA += 0.5 * len;

                if compute_normals != 0 {
                    let inv = 1.0 / len;
                    let ux = nx * inv;
                    let uy = ny * inv;
                    let uz = nz * inv;
                    NORM_BUF[b] = ux;
                    NORM_BUF[b + 1] = uy;
                    NORM_BUF[b + 2] = uz;
                    NORM_BUF[b + 3] = ux;
                    NORM_BUF[b + 4] = uy;
                    NORM_BUF[b + 5] = uz;
                    NORM_BUF[b + 6] = ux;
                    NORM_BUF[b + 7] = uy;
                    NORM_BUF[b + 8] = uz;
                }
            } else {
                DEGEN_TRIS += 1;
                if compute_normals != 0 {
                    NORM_BUF[b] = 0.0;
                    NORM_BUF[b + 1] = 1.0;
                    NORM_BUF[b + 2] = 0.0;
                    NORM_BUF[b + 3] = 0.0;
                    NORM_BUF[b + 4] = 1.0;
                    NORM_BUF[b + 5] = 0.0;
                    NORM_BUF[b + 6] = 0.0;
                    NORM_BUF[b + 7] = 1.0;
                    NORM_BUF[b + 8] = 0.0;
                }
            }

            // Volumen firmado del tetraedro: A · (B x C) / 6
            let bxc_x = by * cz - bz * cy;
            let bxc_y = bz * cx - bx * cz;
            let bxc_z = bx * cy - by * cx;
            ACC_VOL += (ax * bxc_x + ay * bxc_y + az * bxc_z) / 6.0;
        }
    }
}

#[no_mangle]
pub extern "C" fn finish_analysis() {
    unsafe {
        if !HAS_POINTS {
            STATS[13] = 1.0;
            return;
        }
        let dx = (MAX_X - MIN_X).max(0.0001);
        let dy = (MAX_Y - MIN_Y).max(0.0001);
        let dz = (MAX_Z - MIN_Z).max(0.0001);
        let max_dim = dx.max(dy).max(dz);
        let scale = 2.0 / max_dim;

        let cx = (MIN_X + MAX_X) * 0.5;
        let cy = (MIN_Y + MAX_Y) * 0.5;
        let cz = (MIN_Z + MAX_Z) * 0.5;

        STATS[0] = MIN_X;
        STATS[1] = MIN_Y;
        STATS[2] = MIN_Z;
        STATS[3] = MAX_X;
        STATS[4] = MAX_Y;
        STATS[5] = MAX_Z;
        STATS[6] = ACC_AREA;
        STATS[7] = abs_f32(ACC_VOL);
        STATS[8] = TOTAL_TRIS as f32;
        STATS[9] = DEGEN_TRIS as f32;
        STATS[10] = cx;
        STATS[11] = cy;
        STATS[12] = cz;
        STATS[13] = scale;
    }
}

#[no_mangle]
pub extern "C" fn transform_batch(tri_count: usize, cx: f32, cy: f32, cz: f32, scale: f32) {
    let n = if tri_count <= BATCH_TRIS { tri_count } else { BATCH_TRIS };
    let max_floats = n * 9;
    unsafe {
        let mut i = 0;
        while i < max_floats {
            POS_BUF[i] = (POS_BUF[i] - cx) * scale;
            POS_BUF[i + 1] = (POS_BUF[i + 1] - cy) * scale;
            POS_BUF[i + 2] = (POS_BUF[i + 2] - cz) * scale;
            i += 3;
        }
    }
}

#[no_mangle]
pub extern "C" fn set_camera_immediate(yaw: f32, pitch: f32, dist: f32, px: f32, py: f32, pz: f32) {
    unsafe {
        CAM_STATE[0] = yaw;
        CAM_STATE[1] = pitch;
        CAM_STATE[2] = dist;
        CAM_STATE[3] = px;
        CAM_STATE[4] = py;
        CAM_STATE[5] = pz;
    }
}

/// Calcula el paso de cámara para exploración manual (amortiguada) o automática:
/// - auto_mode 0: Órbita 360° continua con ligera respiración vertical
/// - auto_mode 1: Tour Cinematográfico (barridos dinámicos, ángulos rasantes y zoom de detalle)
/// - auto_mode 2: Tour Técnico de Vistas CAD (Isométrica -> Alzado -> Perfil -> Planta -> Inferior)
#[no_mangle]
pub extern "C" fn step_camera(
    dt: f32,
    auto_enabled: i32,
    auto_mode: i32,
    auto_speed: f32,
    user_interacting: i32,
    target_yaw: f32,
    target_pitch: f32,
    target_dist: f32,
    target_px: f32,
    target_py: f32,
    target_pz: f32,
) {
    let safe_dt = dt.clamp(0.001, 0.1);
    let lerp_t = (1.0 - (1.0 - 0.14 * (safe_dt * 60.0)).clamp(0.0, 0.99)).clamp(0.04, 0.45);

    unsafe {
        let mut yaw = CAM_STATE[0];
        let mut pitch = CAM_STATE[1];
        let mut dist = CAM_STATE[2];
        let mut px = CAM_STATE[3];
        let mut py = CAM_STATE[4];
        let mut pz = CAM_STATE[5];

        if auto_enabled != 0 && user_interacting == 0 {
            let spd = auto_speed.clamp(0.2, 3.0);
            let t = CAM_STATE[6] + safe_dt * spd;
            CAM_STATE[6] = t;

            match auto_mode {
                1 => {
                    // Tour Cinematográfico: combinación armónica de órbita, elevación y acercamiento
                    let desired_yaw = yaw + safe_dt * spd * 0.48;
                    let desired_pitch = 0.28 + sin_approx(t * 0.55) * 0.46 + cos_approx(t * 0.28) * 0.14;
                    let desired_dist = 2.95 + sin_approx(t * 0.42) * 0.65;
                    yaw = desired_yaw;
                    pitch += (desired_pitch.clamp(-1.15, 1.25) - pitch) * (lerp_t * 0.5);
                    dist += (desired_dist - dist) * (lerp_t * 0.45);
                    px += (0.0 - px) * lerp_t;
                    py += (0.0 - py) * lerp_t;
                    pz += (0.0 - pz) * lerp_t;
                }
                2 => {
                    // Tour Técnico de Vistas CAD: 5 estaciones con transición suave y pausa
                    const YAWS: [f32; 5] = [0.68, 0.0, 1.5708, 0.0, -0.78];
                    const PITCHES: [f32; 5] = [0.46, 0.04, 0.04, 1.38, -0.35];
                    const DISTS: [f32; 5] = [3.15, 2.95, 2.95, 3.25, 2.85];

                    let seg_dur = 3.2_f32;
                    let total_cycle = seg_dur * 5.0;
                    let ct = t % total_cycle;
                    let idx = ((ct / seg_dur) as usize) % 5;
                    let next_idx = (idx + 1) % 5;
                    let local_u = (ct - (idx as f32) * seg_dur) / seg_dur;

                    // Mantener 55% en la vista, transicionar suavemente en el último 45%
                    let blend = if local_u < 0.55 {
                        0.0
                    } else {
                        smoothstep01((local_u - 0.55) / 0.45)
                    };

                    // Camino angular más corto en yaw
                    let y0 = YAWS[idx];
                    let mut y1 = YAWS[next_idx];
                    let diff = y1 - y0;
                    if diff > PI { y1 -= TWO_PI; }
                    if diff < -PI { y1 += TWO_PI; }

                    let goal_yaw = y0 + (y1 - y0) * blend;
                    let goal_pitch = PITCHES[idx] + (PITCHES[next_idx] - PITCHES[idx]) * blend;
                    let goal_dist = DISTS[idx] + (DISTS[next_idx] - DISTS[idx]) * blend;

                    let mut dy = goal_yaw - yaw;
                    while dy > PI { dy -= TWO_PI; }
                    while dy < -PI { dy += TWO_PI; }

                    yaw += dy * (lerp_t * 0.75);
                    pitch += (goal_pitch - pitch) * (lerp_t * 0.75);
                    dist += (goal_dist - dist) * (lerp_t * 0.75);
                    px += (0.0 - px) * lerp_t;
                    py += (0.0 - py) * lerp_t;
                    pz += (0.0 - pz) * lerp_t;
                    CAM_STATE[7] = idx as f32;
                }
                _ => {
                    // Órbita 360° continua
                    yaw += safe_dt * spd * 0.58;
                    let breathe_pitch = 0.42 + sin_approx(t * 0.45) * 0.16;
                    pitch += (breathe_pitch - pitch) * (lerp_t * 0.35);
                    dist += (target_dist - dist) * (lerp_t * 0.5);
                    px += (target_px - px) * lerp_t;
                    py += (target_py - py) * lerp_t;
                    pz += (target_pz - pz) * lerp_t;
                }
            }
        } else {
            // Exploración manual suave con amortiguación de inercia
            let mut dy = target_yaw - yaw;
            while dy > PI { dy -= TWO_PI; }
            while dy < -PI { dy += TWO_PI; }
            yaw += dy * lerp_t;
            pitch += (target_pitch - pitch) * lerp_t;
            dist += (target_dist - dist) * lerp_t;
            px += (target_px - px) * lerp_t;
            py += (target_py - py) * lerp_t;
            pz += (target_pz - pz) * lerp_t;
        }

        CAM_STATE[0] = yaw;
        CAM_STATE[1] = pitch.clamp(-1.52, 1.52);
        CAM_STATE[2] = dist.clamp(0.75, 12.0);
        CAM_STATE[3] = px;
        CAM_STATE[4] = py;
        CAM_STATE[5] = pz;
    }
}
