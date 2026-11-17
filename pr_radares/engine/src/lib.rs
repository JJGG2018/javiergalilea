#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_RADARS: usize = 1024;

static mut RADAR_LATS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_LNGS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_PKS: [f32; MAX_RADARS] = [0.0; MAX_RADARS];
static mut RADAR_TYPES: [u8; MAX_RADARS] = [0; MAX_RADARS]; // 0: fijo, 1: tramo

static mut RESULT_INDICES: [u16; MAX_RADARS] = [0; MAX_RADARS];
static mut RESULT_DISTANCES: [f32; MAX_RADARS] = [0.0; MAX_RADARS];

const DEG_TO_RAD: f32 = 0.017453292519943295; // PI / 180
const EARTH_RADIUS_KM: f32 = 6371.0;

fn fast_cos(mut x: f32) -> f32 {
    let pi = 3.14159265;
    while x > pi {
        x -= 2.0 * pi;
    }
    while x < -pi {
        x += 2.0 * pi;
    }
    let x2 = x * x;
    1.0 - (x2 * 0.5) + (x2 * x2 * 0.041666667) - (x2 * x2 * x2 * 0.001388889)
}

fn fast_sqrt(val: f32) -> f32 {
    if val <= 0.0 {
        return 0.0;
    }
    let mut x = val;
    for _ in 0..6 {
        x = 0.5 * (x + val / x);
    }
    x
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
pub extern "C" fn register_radar(idx: usize, lat: f32, lng: f32, pk: f32, is_tramo: u8) {
    if idx < MAX_RADARS {
        unsafe {
            RADAR_LATS[idx] = lat;
            RADAR_LNGS[idx] = lng;
            RADAR_PKS[idx] = pk;
            RADAR_TYPES[idx] = is_tramo;
        }
    }
}

#[no_mangle]
pub extern "C" fn get_result_indices_ptr() -> *const u16 {
    unsafe { RESULT_INDICES.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_result_distances_ptr() -> *const f32 {
    unsafe { RESULT_DISTANCES.as_ptr() }
}

// Encuentra el índice del radar más cercano a una posición GPS dada
#[no_mangle]
pub extern "C" fn find_nearest_radar(user_lat: f32, user_lng: f32, count: usize) -> i32 {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    if n == 0 {
        return -1;
    }

    let mut min_idx = 0;
    let mut min_dist = f32::MAX;

    unsafe {
        for i in 0..n {
            let d = distance_km(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
            if d < min_dist {
                min_dist = d;
                min_idx = i;
            }
        }
    }

    min_idx as i32
}

// Cuenta cuántos radares se encuentran dentro de un radio en kilómetros (ej. aviso a 1 km o 3 km)
#[no_mangle]
pub extern "C" fn count_radars_within_radius(user_lat: f32, user_lng: f32, count: usize, radius_km: f32) -> u32 {
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

// Ordenar radares por proximidad a unas coordenadas dadas
#[no_mangle]
pub extern "C" fn sort_by_proximity(user_lat: f32, user_lng: f32, count: usize) -> usize {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    if n == 0 {
        return 0;
    }

    unsafe {
        for i in 0..n {
            RESULT_INDICES[i] = i as u16;
            let d = distance_km(user_lat, user_lng, RADAR_LATS[i], RADAR_LNGS[i]);
            RESULT_DISTANCES[i] = d;
        }

        quicksort_by_dist(0, (n - 1) as isize);
    }

    n
}

// Ordenar radares por punto kilométrico (PK)
#[no_mangle]
pub extern "C" fn sort_by_pk(count: usize, ascending: i32) -> usize {
    let n = if count <= MAX_RADARS { count } else { MAX_RADARS };
    if n == 0 {
        return 0;
    }

    unsafe {
        for i in 0..n {
            RESULT_INDICES[i] = i as u16;
        }

        quicksort_by_pk(0, (n - 1) as isize, ascending != 0);
    }

    n
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

unsafe fn quicksort_by_pk(low: isize, high: isize, asc: bool) {
    if low < high {
        let p = partition_pk(low, high, asc);
        quicksort_by_pk(low, p - 1, asc);
        quicksort_by_pk(p + 1, high, asc);
    }
}

unsafe fn partition_pk(low: isize, high: isize, asc: bool) -> isize {
    let pivot_idx = RESULT_INDICES[high as usize] as usize;
    let pivot_pk = RADAR_PKS[pivot_idx];
    let mut i = low - 1;

    for j in low..high {
        let cur_idx = RESULT_INDICES[j as usize] as usize;
        let cur_pk = RADAR_PKS[cur_idx];
        let condition = if asc { cur_pk <= pivot_pk } else { cur_pk >= pivot_pk };
        if condition {
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
