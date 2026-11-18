#![cfg_attr(not(test), no_std)]

#[cfg(not(test))]
use core::panic::PanicInfo;

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_RADARS: usize = 1024;
const PI: f32 = 3.14159265;
const TWO_PI: f32 = 6.28318530;
const HALF_PI: f32 = 1.57079632;
const DEG_TO_RAD: f32 = 0.017453292519943295;
const RAD_TO_DEG: f32 = 57.29577951308232;
const EARTH_RADIUS_KM: f32 = 6371.0;

static mut RADAR_LATS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_LNGS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_PKS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_TYPES: [u8; MAX_RADARS] = [0; MAX_RADARS]; // 0: fijo, 1: tramo
static mut RADAR_LIMITS: [u16; MAX_RADARS] = [120; MAX_RADARS];

static mut RESULT_INDICES: [u16; MAX_RADARS] = [0; MAX_RADARS];
static mut RESULT_DISTANCES: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RESULT_BEARINGS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];

fn wrap_pi(mut x: f32) -> f32 {
    while x > PI {
        x -= TWO_PI;
    }
    while x < -PI {
        x += TWO_PI;
    }
    x
}

fn fast_cos(x: f32) -> f32 {
    let x = wrap_pi(x);
    let x2 = x * x;
    1.0 - (x2 * 0.5) + (x2 * x2 * 0.041666667) - (x2 * x2 * x2 * 0.001388889)
}

fn fast_sin(x: f32) -> f32 {
    let mut x = wrap_pi(x);
    if x > HALF_PI {
        x = PI - x;
    } else if x < -HALF_PI {
        x = -PI - x;
    }
    let x2 = x * x;
    x * (1.0 - x2 * (0.16666667 - x2 * (0.008333333 - x2 * 0.0001984127)))
}

fn fast_sqrt(mut val: f32) -> f32 {
    if val <= 0.0 {
        return 0.0;
    }
    let mut scale = 1.0f32;
    while val < 0.25 {
        val *= 4.0;
        scale *= 0.5;
    }
    while val > 4.0 {
        val *= 0.25;
        scale *= 2.0;
    }
    let mut x = 1.0f32;
    for _ in 0..8 {
        x = 0.5 * (x + val / x);
    }
    x * scale
}

fn fast_atan_unit(z: f32) -> f32 {
    // Aproximación polinómica de atan(z) para |z| <= 1 (error < 0.0003 rad)
    let z2 = z * z;
    z * (0.9998660 + z2 * (-0.3302995 + z2 * (0.1801410 + z2 * (-0.0851330 + z2 * 0.0208351))))
}

fn fast_atan2(y: f32, x: f32) -> f32 {
    if x == 0.0 && y == 0.0 {
        return 0.0;
    }
    let ax = if x < 0.0 { -x } else { x };
    let ay = if y < 0.0 { -y } else { y };
    let mut a = if ax >= ay {
        fast_atan_unit(ay / ax)
    } else {
        HALF_PI - fast_atan_unit(ax / ay)
    };
    if x < 0.0 {
        a = PI - a;
    }
    if y < 0.0 {
        a = -a;
    }
    a
}

#[no_mangle]
pub extern "C" fn distance_km(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> f32 {
    let phi1 = lat1 * DEG_TO_RAD;
    let phi2 = lat2 * DEG_TO_RAD;
    let delta_phi = (lat2 - lat1) * DEG_TO_RAD;
    let delta_lambda = (lon2 - lon1) * DEG_TO_RAD;

    let mean_phi = (phi1 + phi2) * 0.5;
    let x = delta_lambda * fast_cos(mean_phi);
    let y = delta_phi;

    let dist_rad = fast_sqrt(x * x + y * y);
    dist_rad * EARTH_RADIUS_KM
}

#[no_mangle]
pub extern "C" fn bearing_deg(lat1: f32, lon1: f32, lat2: f32, lon2: f32) -> f32 {
    let phi1 = lat1 * DEG_TO_RAD;
    let phi2 = lat2 * DEG_TO_RAD;
    let d_lon = (lon2 - lon1) * DEG_TO_RAD;

    let y = fast_sin(d_lon) * fast_cos(phi2);
    let x = fast_cos(phi1) * fast_sin(phi2) - fast_sin(phi1) * fast_cos(phi2) * fast_cos(d_lon);

    let mut deg = fast_atan2(y, x) * RAD_TO_DEG;
    while deg < 0.0 {
        deg += 360.0;
    }
    while deg >= 360.0 {
        deg -= 360.0;
    }
    deg
}

#[no_mangle]
pub extern "C" fn angle_diff_deg(heading_deg: f32, target_bearing_deg: f32) -> f32 {
    let mut diff = target_bearing_deg - heading_deg;
    while diff > 180.0 {
        diff -= 360.0;
    }
    while diff < -180.0 {
        diff += 360.0;
    }
    diff
}

#[no_mangle]
pub extern "C" fn eta_seconds(dist_km: f32, speed_kmh: f32) -> f32 {
    if dist_km <= 0.0 || speed_kmh < 5.0 {
        return -1.0;
    }
    (dist_km / speed_kmh) * 3600.0
}

#[no_mangle]
pub extern "C" fn register_radar(
    idx: usize,
    lat: f32,
    lng: f32,
    pk: f32,
    is_tramo: u8,
    limit: u16,
) {
    if idx < MAX_RADARS {
        unsafe {
            RADAR_LATS[idx] = lat;
            RADAR_LNGS[idx] = lng;
            RADAR_PKS[idx] = pk;
            RADAR_TYPES[idx] = is_tramo;
            RADAR_LIMITS[idx] = if limit > 0 { limit } else { 120 };
        }
    }
}

#[no_mangle]
pub extern "C" fn get_result_indices_ptr() -> *const u16 {
    core::ptr::addr_of!(RESULT_INDICES) as *const u16
}

#[no_mangle]
pub extern "C" fn get_result_distances_ptr() -> *const f32 {
    core::ptr::addr_of!(RESULT_DISTANCES) as *const f32
}

#[no_mangle]
pub extern "C" fn get_result_bearings_ptr() -> *const f32 {
    core::ptr::addr_of!(RESULT_BEARINGS) as *const f32
}

#[no_mangle]
pub extern "C" fn sort_by_proximity(user_lat: f32, user_lng: f32, count: usize) -> usize {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    if n == 0 {
        return 0;
    }

    unsafe {
        for i in 0..n {
            RESULT_INDICES[i] = i as u16;
            RESULT_DISTANCES[i] = distance_km(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
            RESULT_BEARINGS[i] = bearing_deg(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
        }
        quicksort_by_dist(0, (n - 1) as isize);
    }

    n
}

#[no_mangle]
pub extern "C" fn find_nearest_ahead(
    user_lat: f32,
    user_lng: f32,
    heading_deg: f32,
    has_heading: i32,
    max_cone_deg: f32,
    count: usize,
) -> i32 {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    if n == 0 {
        return -1;
    }

    let mut best_idx: i32 = -1;
    let mut best_dist = f32::MAX;

    unsafe {
        for i in 0..n {
            let d = distance_km(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
            if has_heading != 0 {
                let b = bearing_deg(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
                let diff = angle_diff_deg(heading_deg, b);
                let abs_diff = if diff < 0.0 { -diff } else { diff };
                if abs_diff > max_cone_deg {
                    continue;
                }
            }
            if d < best_dist {
                best_dist = d;
                best_idx = i as i32;
            }
        }
    }

    best_idx
}

#[no_mangle]
pub extern "C" fn count_radars_within_radius(
    user_lat: f32,
    user_lng: f32,
    count: usize,
    radius_km: f32,
) -> u32 {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    let mut within = 0u32;

    unsafe {
        for i in 0..n {
            let d = distance_km(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
            if d <= radius_km {
                within += 1;
            }
        }
    }

    within
}

unsafe fn quicksort_by_dist(low: isize, high: isize) {
    if low < high {
        let p = partition_dist(low, high);
        quicksort_by_dist(low, p - 1);
        quicksort_by_dist(p + 1, high);
    }
}

unsafe fn partition_dist(low: isize, high: isize) -> isize {
    let pivot_idx = RESULT_INDICES[high as usize] as usize;
    let pivot_dist = RESULT_DISTANCES[pivot_idx];
    let mut i = low - 1;

    for j in low..high {
        let cur_idx = RESULT_INDICES[j as usize] as usize;
        let cur_dist = RESULT_DISTANCES[cur_idx];
        if cur_dist <= pivot_dist {
            i += 1;
            let tmp = RESULT_INDICES[i as usize];
            RESULT_INDICES[i as usize] = RESULT_INDICES[j as usize];
            RESULT_INDICES[j as usize] = tmp;
        }
    }

    let tmp = RESULT_INDICES[(i + 1) as usize];
    RESULT_INDICES[(i + 1) as usize] = RESULT_INDICES[high as usize];
    RESULT_INDICES[high as usize] = tmp;

    i + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distance_and_bearing() {
        // Madrid (40.4168, -3.7038) -> north point (~11.1 km north)
        let d = distance_km(40.4168, -3.7038, 40.5168, -3.7038);
        assert!(d > 10.5 && d < 11.5);
        let b = bearing_deg(40.4168, -3.7038, 40.5168, -3.7038);
        assert!(b < 2.0 || b > 358.0);
    }

    #[test]
    fn test_nearest_ahead_cone() {
        register_radar(0, 40.50, -3.70, 10.0, 0, 120); // North
        register_radar(1, 40.38, -3.70, 20.0, 0, 90);  // South (closer, but behind if heading North)
        let ahead = find_nearest_ahead(40.41, -3.70, 0.0, 1, 60.0, 2);
        assert_eq!(ahead, 0);
        let all_dir = find_nearest_ahead(40.41, -3.70, 0.0, 0, 60.0, 2);
        assert_eq!(all_dir, 1);
    }
}
