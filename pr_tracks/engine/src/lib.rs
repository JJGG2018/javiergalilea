#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_AGENTS: usize = 32;
const MAX_TRACK_POINTS: usize = 2048;
const EARTH_RADIUS_M: f32 = 6_371_000.0;
const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;
const DEG_TO_RAD: f32 = 0.01745329252;
const RAD_TO_DEG: f32 = 57.2957795131;

// Estado de agentes: [lat, lon, vx, vy, heading_deg, speed_kmh, total_dist_m, phase]
static mut AGENTS: [f32; MAX_AGENTS * 8] = [0.0; MAX_AGENTS * 8];

// Buffer de puntos para análisis geodésico: [lat, lon, timestamp_s, cumulative_dist_m]
static mut TRACK_POINTS: [f32; MAX_TRACK_POINTS * 4] = [0.0; MAX_TRACK_POINTS * 4];

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
    // Dos iteraciones de Newton-Raphson para alta precisión geodésica
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
fn atan2_approx(y: f32, x: f32) -> f32 {
    if x == 0.0 && y == 0.0 {
        return 0.0;
    }
    let abs_y = abs_f32(y) + 1e-10;
    let (r, angle_base) = if x < 0.0 {
        ((x + abs_y) / (abs_y - x), 2.35619449)
    } else {
        ((x - abs_y) / (x + abs_y), 0.78539816)
    };
    let angle = angle_base + (0.1963 * r * r - 0.9817) * r;
    if y < 0.0 { -angle } else { angle }
}

#[no_mangle]
pub extern "C" fn get_agents_ptr() -> *mut f32 {
    unsafe { core::ptr::addr_of_mut!(AGENTS) as *mut f32 }
}

#[no_mangle]
pub extern "C" fn get_track_points_ptr() -> *mut f32 {
    unsafe { core::ptr::addr_of_mut!(TRACK_POINTS) as *mut f32 }
}

/// Calcula la distancia geodésica Haversine (en metros) entre dos coordenadas GPS.
#[no_mangle]
pub extern "C" fn haversine_meters(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> f32 {
    let dlat = (lat2 - lat1) * DEG_TO_RAD;
    let dlon = (lon2 - lon1) * DEG_TO_RAD;
    let rlat1 = lat1 * DEG_TO_RAD;
    let rlat2 = lat2 * DEG_TO_RAD;

    let sdlat = sin_approx(dlat * 0.5);
    let sdlon = sin_approx(dlon * 0.5);

    let a = (sdlat * sdlat + cos_approx(rlat1) * cos_approx(rlat2) * sdlon * sdlon).clamp(0.0, 1.0);
    let c = 2.0 * atan2_approx(sqrt_approx(a), sqrt_approx(1.0 - a));
    EARTH_RADIUS_M * c
}

/// Calcula el rumbo / acimut (0..360 grados) desde (lat1, lon1) hacia (lat2, lon2).
#[no_mangle]
pub extern "C" fn compute_bearing(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> f32 {
    let rlat1 = lat1 * DEG_TO_RAD;
    let rlat2 = lat2 * DEG_TO_RAD;
    let dlon = (lon2 - lon1) * DEG_TO_RAD;

    let y = sin_approx(dlon) * cos_approx(rlat2);
    let x = cos_approx(rlat1) * sin_approx(rlat2)
        - sin_approx(rlat1) * cos_approx(rlat2) * cos_approx(dlon);

    let mut brng = atan2_approx(y, x) * RAD_TO_DEG;
    if brng < 0.0 {
        brng += 360.0;
    }
    brng
}

/// Analiza una polilínea de puntos GPS en `TRACK_POINTS` y rellena la distancia acumulada.
/// Devuelve la longitud total del track en metros.
#[no_mangle]
pub extern "C" fn analyze_track(count: usize) -> f32 {
    let n = if count <= MAX_TRACK_POINTS { count } else { MAX_TRACK_POINTS };
    if n == 0 {
        return 0.0;
    }
    let mut total_m: f32 = 0.0;
    unsafe {
        TRACK_POINTS[3] = 0.0;
        for i in 1..n {
            let prev = (i - 1) * 4;
            let curr = i * 4;
            let seg = haversine_meters(
                TRACK_POINTS[prev],
                TRACK_POINTS[prev + 1],
                TRACK_POINTS[curr],
                TRACK_POINTS[curr + 1],
            );
            total_m += seg;
            TRACK_POINTS[curr + 3] = total_m;
        }
    }
    total_m
}

/// Avanza la cinemática de `count` usuarios simulados / autónomos alrededor de (center_lat, center_lon).
#[no_mangle]
pub extern "C" fn step_sim_agents(
    count: usize,
    center_lat: f32,
    center_lon: f32,
    radius_deg: f32,
    dt: f32,
    time: f32,
    pattern_mode: i32,
) -> usize {
    let n = if count <= MAX_AGENTS { count } else { MAX_AGENTS };
    let safe_dt = dt.clamp(0.005, 0.25);
    let cos_lat = cos_approx(center_lat * DEG_TO_RAD).clamp(0.2, 1.0);

    unsafe {
        for i in 0..n {
            let base = i * 8;
            let old_lat = AGENTS[base];
            let old_lon = AGENTS[base + 1];
            let mut phase = AGENTS[base + 7];

            let idx_f = i as f32;
            let speed_factor = 0.28 + (i % 5) as f32 * 0.09;
            phase += safe_dt * speed_factor;

            let (target_lat, target_lon) = match pattern_mode {
                1 => {
                    // Lissajous táctico urbano
                    let a = 2.0 + (i % 3) as f32;
                    let b = 3.0 + (i % 2) as f32;
                    let dlat = sin_approx(phase * a + idx_f * 1.1) * radius_deg * 0.85;
                    let dlon = cos_approx(phase * b + idx_f * 0.7) * (radius_deg / cos_lat) * 0.85;
                    (center_lat + dlat, center_lon + dlon)
                }
                2 => {
                    // Patrulla en cuadrícula / manzanas
                    let t = phase * 0.8 + idx_f * 1.57;
                    let leg = (t as i32) % 4;
                    let frac = (t - (t as i32 as f32)) * 2.0 - 1.0;
                    let r = radius_deg * (0.35 + (i % 4) as f32 * 0.18);
                    let (dlat, dlon) = match leg {
                        0 => (r, frac * r / cos_lat),
                        1 => (-frac * r, r / cos_lat),
                        2 => (-r, -frac * r / cos_lat),
                        _ => (frac * r, -r / cos_lat),
                    };
                    (center_lat + dlat, center_lon + dlon)
                }
                _ => {
                    // Órbita orgánica + deriva armónica
                    let orbit_r = radius_deg * (0.32 + (i % 5) as f32 * 0.16);
                    let wobble = sin_approx(time * 0.7 + idx_f * 2.1) * radius_deg * 0.18;
                    let angle = phase + idx_f * 1.2566;
                    let dlat = sin_approx(angle) * (orbit_r + wobble);
                    let dlon = cos_approx(angle) * ((orbit_r - wobble * 0.5) / cos_lat);
                    (center_lat + dlat, center_lon + dlon)
                }
            };

            let blend = (safe_dt * 3.5).clamp(0.02, 0.45);
            let new_lat = if old_lat == 0.0 && old_lon == 0.0 {
                target_lat
            } else {
                old_lat + (target_lat - old_lat) * blend
            };
            let new_lon = if old_lat == 0.0 && old_lon == 0.0 {
                target_lon
            } else {
                old_lon + (target_lon - old_lon) * blend
            };

            let step_dist = haversine_meters(old_lat, old_lon, new_lat, new_lon);
            let valid_step = if old_lat == 0.0 && old_lon == 0.0 { 0.0 } else { step_dist };
            let heading = if valid_step > 0.05 {
                compute_bearing(old_lat, old_lon, new_lat, new_lon)
            } else {
                AGENTS[base + 4]
            };
            let inst_speed_kmh = (valid_step / safe_dt) * 3.6;
            let smooth_speed = AGENTS[base + 5] * 0.8 + inst_speed_kmh * 0.2;

            AGENTS[base] = new_lat;
            AGENTS[base + 1] = new_lon;
            AGENTS[base + 2] = (new_lat - old_lat) / safe_dt;
            AGENTS[base + 3] = (new_lon - old_lon) / safe_dt;
            AGENTS[base + 4] = heading;
            AGENTS[base + 5] = smooth_speed.clamp(0.0, 240.0);
            AGENTS[base + 6] += valid_step;
            AGENTS[base + 7] = phase;
        }
    }

    n
}
