#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

const MAX_CAMERAS: usize = 2048;

static mut CAM_LATS: [f32; MAX_CAMERAS] = [0.0; MAX_CAMERAS];
static mut CAM_LNGS: [f32; MAX_CAMERAS] = [0.0; MAX_CAMERAS];
static mut CAM_PKS: [f32; MAX_CAMERAS] = [0.0; MAX_CAMERAS];

static mut RESULT_INDICES: [u16; MAX_CAMERAS] = [0; MAX_CAMERAS];
static mut RESULT_DISTANCES: [f32; MAX_CAMERAS] = [0.0; MAX_CAMERAS];

const DEG_TO_RAD: f32 = 0.017453292519943295; // PI / 180
const EARTH_RADIUS_KM: f32 = 6371.0;

// Aproximación rápida y precisa de cos(x) para [-PI, PI]
fn fast_cos(mut x: f32) -> f32 {
    // Normalizar a [-PI, PI]
    let pi = 3.14159265;
    while x > pi {
        x -= 2.0 * pi;
    }
    while x < -pi {
        x += 2.0 * pi;
    }
    // Serie de Taylor: 1 - x^2/2 + x^4/24 - x^6/720
    let x2 = x * x;
    1.0 - (x2 * 0.5) + (x2 * x2 * 0.041666667) - (x2 * x2 * x2 * 0.001388889)
}

// Raíz cuadrada por método de Newton-Raphson
fn fast_sqrt(val: f32) -> f32 {
    if val <= 0.0 {
        return 0.0;
    }
    let mut x = val;
    // 6 iteraciones dan precisión perfecta para f32
    for _ in 0..6 {
        x = 0.5 * (x + val / x);
    }
    x
}

// Distancia geodésica esférica aproximada (Equirectangular) en kilómetros
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
pub extern "C" fn register_camera(idx: usize, lat: f32, lng: f32, pk: f32) {
    if idx < MAX_CAMERAS {
        unsafe {
            CAM_LATS[idx] = lat;
            CAM_LNGS[idx] = lng;
            CAM_PKS[idx] = pk;
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

// Ordenar cámaras por proximidad a unas coordenadas dadas
#[no_mangle]
pub extern "C" fn sort_by_proximity(user_lat: f32, user_lng: f32, count: usize) -> usize {
    let n = if count <= MAX_CAMERAS { count } else { MAX_CAMERAS };
    if n == 0 {
        return 0;
    }

    unsafe {
        // Inicializar índices y calcular distancias
        for i in 0..n {
            RESULT_INDICES[i] = i as u16;
            let d = distance_km(user_lat, user_lng, CAM_LATS[i], CAM_LNGS[i]);
            RESULT_DISTANCES[i] = d;
        }

        // Quicksort en índices usando las distancias calculadas
        quicksort_by_dist(0, (n - 1) as isize);
    }

    n
}

// Ordenar cámaras por punto kilométrico (PK)
#[no_mangle]
pub extern "C" fn sort_by_pk(count: usize, ascending: i32) -> usize {
    let n = if count <= MAX_CAMERAS { count } else { MAX_CAMERAS };
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
    let pivot_pk = CAM_PKS[pivot_idx];
    let mut i = low - 1;

    for j in low..high {
        let cur_idx = RESULT_INDICES[j as usize] as usize;
        let cur_pk = CAM_PKS[cur_idx];
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
