"""
Build script for engine.wasm - Generates a WebAssembly binary without external dependencies.
Exports:
  - memory
  - init(num_particles: i32, width: f32, height: f32) -> i32
  - update(num_particles: i32, width: f32, height: f32, mouse_x: f32, mouse_y: f32, mouse_active: i32, attract_mode: i32, dt: f32) -> i32
  - get_memory_offset() -> i32
  - benchmark_calc(iterations: i32) -> f32
"""

import struct

def leb_u(val):
    res = bytearray()
    while True:
        b = val & 0x7F
        val >>= 7
        if val == 0:
            res.append(b)
            break
        res.append(b | 0x80)
    return res

def leb_i(val):
    res = bytearray()
    while True:
        b = val & 0x7F
        val >>= 7
        if (val == 0 and (b & 0x40) == 0) or (val == -1 and (b & 0x40) != 0):
            res.append(b)
            break
        res.append(b | 0x80)
    return res

def vec(items):
    out = bytearray(leb_u(len(items)))
    for it in items:
        out.extend(it)
    return out

def encode_str(s):
    b = s.encode('utf-8')
    return leb_u(len(b)) + b

def func_type(params, results):
    return bytes([0x60]) + leb_u(len(params)) + bytes(params) + leb_u(len(results)) + bytes(results)

# ValTypes
I32 = 0x7F
I64 = 0x7E
F32 = 0x7D
F64 = 0x7C

# Opcodes
BLOCK = 0x02
LOOP = 0x03
IF = 0x04
ELSE = 0x05
END = 0x0B
BR = 0x0C
BR_IF = 0x0D
LOCAL_GET = 0x20
LOCAL_SET = 0x21

F32_LOAD = 0x2A
F32_STORE = 0x38

I32_CONST = 0x41
F32_CONST = 0x43

I32_EQZ = 0x45
I32_EQ = 0x46
I32_GE_S = 0x4E

I32_ADD = 0x6A
I32_MUL = 0x6C
I32_REM_S = 0x6F
I32_AND = 0x71
I32_SHR_U = 0x76

F32_LT = 0x5D
F32_GT = 0x5E

F32_ADD = 0x92
F32_SUB = 0x93
F32_MUL = 0x94
F32_DIV = 0x95

F32_CONVERT_I32_S = 0xB2

EMPTY_BLOCK = 0x40

def make_func(locals_list, body_bytes):
    # locals_list: list of (count, valtype)
    loc_bytes = leb_u(len(locals_list))
    for count, vtype in locals_list:
        loc_bytes.extend(leb_u(count))
        loc_bytes.append(vtype)
    full_body = loc_bytes + body_bytes + bytes([END])
    return leb_u(len(full_body)) + full_body

def build_engine():
    # 1. Type section
    # Type 0: (i32, f32, f32) -> i32                [init: count, width, height]
    # Type 1: (i32, f32, f32, f32, f32, i32, i32, f32) -> i32 [update: count, w, h, mx, my, m_active, mode, dt]
    # Type 2: () -> i32                             [get_memory_offset]
    # Type 3: (i32) -> f32                          [benchmark_calc]
    types = [
        func_type([I32, F32, F32], [I32]),
        func_type([I32, F32, F32, F32, F32, I32, I32, F32], [I32]),
        func_type([], [I32]),
        func_type([I32], [F32])
    ]
    type_payload = vec(types)
    type_sec = bytes([1]) + leb_u(len(type_payload)) + type_payload

    # 2. Function section (types for func 0, 1, 2, 3)
    funcs = [leb_u(0), leb_u(1), leb_u(2), leb_u(3)]
    func_payload = vec(funcs)
    func_sec = bytes([3]) + leb_u(len(func_payload)) + func_payload

    # 3. Memory section: 1 memory, min 16 pages (1MB), max 32 pages
    mem_type = bytes([0x01]) + leb_u(16) + leb_u(32)
    mem_payload = vec([mem_type])
    mem_sec = bytes([5]) + leb_u(len(mem_payload)) + mem_payload

    # 4. Export section:
    exports = [
        encode_str("memory") + bytes([0x02, 0x00]),
        encode_str("init") + bytes([0x00, 0x00]),
        encode_str("update") + bytes([0x00, 0x01]),
        encode_str("get_memory_offset") + bytes([0x00, 0x02]),
        encode_str("benchmark_calc") + bytes([0x00, 0x03]),
    ]
    export_payload = vec(exports)
    export_sec = bytes([7]) + leb_u(len(export_payload)) + export_payload

    # 5. Code section

    # --- FUNC 0: init(count: i32, width: f32, height: f32) -> i32 ---
    # Parameters:
    # $0: count
    # $1: width
    # $2: height
    # Locals:
    # $3: i (i32)
    # $4: base (i32)
    # $5: seed (i32)
    # $6: fx (f32)
    # $7: fy (f32)
    b0 = bytearray()
    # i = 0
    b0.extend([I32_CONST])
    b0.extend(leb_i(0))
    b0.extend([LOCAL_SET, 3])
    # seed = 1234567
    b0.extend([I32_CONST])
    b0.extend(leb_i(1234567))
    b0.extend([LOCAL_SET, 5])

    b0.extend([BLOCK, EMPTY_BLOCK])
    b0.extend([LOOP, EMPTY_BLOCK])
    
    # if i >= count -> br 1
    b0.extend([LOCAL_GET, 3, LOCAL_GET, 0, I32_GE_S, BR_IF, 1])

    # base = i * 24
    b0.extend([LOCAL_GET, 3, I32_CONST])
    b0.extend(leb_i(24))
    b0.extend([I32_MUL, LOCAL_SET, 4])

    # seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
    b0.extend([LOCAL_GET, 5, I32_CONST])
    b0.extend(leb_i(1103515245))
    b0.extend([I32_MUL, I32_CONST])
    b0.extend(leb_i(12345))
    b0.extend([I32_ADD, I32_CONST])
    b0.extend(leb_i(0x7FFFFFFF))
    b0.extend([I32_AND, LOCAL_SET, 5])

    # x = (float(seed % 10000) / 10000.0) * width
    b0.extend([LOCAL_GET, 4]) # addr for store
    b0.extend([LOCAL_GET, 5, I32_CONST])
    b0.extend(leb_i(10000))
    b0.extend([I32_REM_S, F32_CONVERT_I32_S, F32_CONST])
    b0.extend(struct.pack('<f', 10000.0))
    b0.extend([F32_DIV, LOCAL_GET, 1, F32_MUL])
    b0.extend([F32_STORE, 0x02, 0x00])

    # Next seed for y
    b0.extend([LOCAL_GET, 5, I32_CONST])
    b0.extend(leb_i(1103515245))
    b0.extend([I32_MUL, I32_CONST])
    b0.extend(leb_i(12345))
    b0.extend([I32_ADD, I32_CONST])
    b0.extend(leb_i(0x7FFFFFFF))
    b0.extend([I32_AND, LOCAL_SET, 5])

    # y = (float(seed % 10000) / 10000.0) * height
    b0.extend([LOCAL_GET, 4]) # addr
    b0.extend([LOCAL_GET, 5, I32_CONST])
    b0.extend(leb_i(10000))
    b0.extend([I32_REM_S, F32_CONVERT_I32_S, F32_CONST])
    b0.extend(struct.pack('<f', 10000.0))
    b0.extend([F32_DIV, LOCAL_GET, 2, F32_MUL])
    b0.extend([F32_STORE, 0x02, 0x04])

    # vx = ((float((seed >> 3) % 2000) / 1000.0) - 1.0) * 1.8
    b0.extend([LOCAL_GET, 4])
    b0.extend([LOCAL_GET, 5, I32_CONST, 3, I32_SHR_U, I32_CONST])
    b0.extend(leb_i(2000))
    b0.extend([I32_REM_S, F32_CONVERT_I32_S, F32_CONST])
    b0.extend(struct.pack('<f', 1000.0))
    b0.extend([F32_DIV, F32_CONST])
    b0.extend(struct.pack('<f', 1.0))
    b0.extend([F32_SUB, F32_CONST])
    b0.extend(struct.pack('<f', 1.8))
    b0.extend([F32_MUL])
    b0.extend([F32_STORE, 0x02, 0x08])

    # vy = ((float((seed >> 14) % 2000) / 1000.0) - 1.0) * 1.8
    b0.extend([LOCAL_GET, 4])
    b0.extend([LOCAL_GET, 5, I32_CONST, 14, I32_SHR_U, I32_CONST])
    b0.extend(leb_i(2000))
    b0.extend([I32_REM_S, F32_CONVERT_I32_S, F32_CONST])
    b0.extend(struct.pack('<f', 1000.0))
    b0.extend([F32_DIV, F32_CONST])
    b0.extend(struct.pack('<f', 1.0))
    b0.extend([F32_SUB, F32_CONST])
    b0.extend(struct.pack('<f', 1.8))
    b0.extend([F32_MUL])
    b0.extend([F32_STORE, 0x02, 0x0C])

    # color_idx = float(i % 5)
    b0.extend([LOCAL_GET, 4])
    b0.extend([LOCAL_GET, 3, I32_CONST, 5, I32_REM_S, F32_CONVERT_I32_S])
    b0.extend([F32_STORE, 0x02, 0x10])

    # size = 1.2 + float((seed >> 20) % 4) * 0.6
    b0.extend([LOCAL_GET, 4])
    b0.extend([F32_CONST])
    b0.extend(struct.pack('<f', 1.2))
    b0.extend([LOCAL_GET, 5, I32_CONST, 20, I32_SHR_U, I32_CONST, 4, I32_REM_S, F32_CONVERT_I32_S, F32_CONST])
    b0.extend(struct.pack('<f', 0.6))
    b0.extend([F32_MUL, F32_ADD])
    b0.extend([F32_STORE, 0x02, 0x14])

    # i += 1
    b0.extend([LOCAL_GET, 3, I32_CONST, 1, I32_ADD, LOCAL_SET, 3])
    b0.extend([BR, 0])
    b0.extend([END, END])
    b0.extend([LOCAL_GET, 0]) # return count

    f0 = make_func([(3, I32)], b0)


    # --- FUNC 1: update(count: i32, width: f32, height: f32, mx: f32, my: f32, m_active: i32, mode: i32, dt: f32) -> i32 ---
    # Parameters:
    # 0: count (i32)
    # 1: width (f32)
    # 2: height (f32)
    # 3: mx (f32)
    # 4: my (f32)
    # 5: m_active (i32)
    # 6: mode (i32)
    # 7: dt (f32)
    # Locals:
    # 8: i (i32)
    # 9: base (i32)
    # 10: px (f32)
    # 11: py (f32)
    # 12: vx (f32)
    # 13: vy (f32)
    # 14: dx (f32)
    # 15: dy (f32)
    # 16: dist_sq (f32)
    # 17: force (f32)
    b1 = bytearray()
    # i = 0
    b1.extend([I32_CONST, 0, LOCAL_SET, 8])

    b1.extend([BLOCK, EMPTY_BLOCK])
    b1.extend([LOOP, EMPTY_BLOCK])

    # if i >= count -> br 1
    b1.extend([LOCAL_GET, 8, LOCAL_GET, 0, I32_GE_S, BR_IF, 1])

    # base = i * 24
    b1.extend([LOCAL_GET, 8, I32_CONST])
    b1.extend(leb_i(24))
    b1.extend([I32_MUL, LOCAL_SET, 9])

    # load px, py, vx, vy
    b1.extend([LOCAL_GET, 9, F32_LOAD, 0x02, 0x00, LOCAL_SET, 10]) # px
    b1.extend([LOCAL_GET, 9, F32_LOAD, 0x02, 0x04, LOCAL_SET, 11]) # py
    b1.extend([LOCAL_GET, 9, F32_LOAD, 0x02, 0x08, LOCAL_SET, 12]) # vx
    b1.extend([LOCAL_GET, 9, F32_LOAD, 0x02, 0x0C, LOCAL_SET, 13]) # vy

    # if m_active != 0:
    b1.extend([LOCAL_GET, 5, I32_EQZ, IF, EMPTY_BLOCK])
    b1.extend([ELSE])
    # dx = mx - px
    b1.extend([LOCAL_GET, 3, LOCAL_GET, 10, F32_SUB, LOCAL_SET, 14])
    # dy = my - py
    b1.extend([LOCAL_GET, 4, LOCAL_GET, 11, F32_SUB, LOCAL_SET, 15])
    # dist_sq = dx*dx + dy*dy + 400.0
    b1.extend([LOCAL_GET, 14, LOCAL_GET, 14, F32_MUL])
    b1.extend([LOCAL_GET, 15, LOCAL_GET, 15, F32_MUL, F32_ADD])
    b1.extend([F32_CONST])
    b1.extend(struct.pack('<f', 400.0))
    b1.extend([F32_ADD, LOCAL_SET, 16])

    # if dist_sq < 120000.0
    b1.extend([LOCAL_GET, 16, F32_CONST])
    b1.extend(struct.pack('<f', 120000.0))
    b1.extend([F32_LT, IF, EMPTY_BLOCK])

    # force = 1500.0 / dist_sq
    b1.extend([F32_CONST])
    b1.extend(struct.pack('<f', 1500.0))
    b1.extend([LOCAL_GET, 16, F32_DIV, LOCAL_SET, 17])

    # mode == 1: repel
    b1.extend([LOCAL_GET, 6, I32_CONST, 1, I32_EQ, IF, EMPTY_BLOCK])
    b1.extend([F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([LOCAL_GET, 17, F32_SUB, LOCAL_SET, 17])
    b1.extend([END])

    # mode == 2: vortex
    b1.extend([LOCAL_GET, 6, I32_CONST, 2, I32_EQ, IF, EMPTY_BLOCK])
    b1.extend([LOCAL_GET, 12, F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([LOCAL_GET, 15, F32_SUB, LOCAL_GET, 17, F32_MUL, F32_ADD, LOCAL_SET, 12])
    b1.extend([LOCAL_GET, 13, LOCAL_GET, 14, LOCAL_GET, 17, F32_MUL, F32_ADD, LOCAL_SET, 13])
    b1.extend([ELSE])
    b1.extend([LOCAL_GET, 12, LOCAL_GET, 14, LOCAL_GET, 17, F32_MUL, F32_ADD, LOCAL_SET, 12])
    b1.extend([LOCAL_GET, 13, LOCAL_GET, 15, LOCAL_GET, 17, F32_MUL, F32_ADD, LOCAL_SET, 13])
    b1.extend([END])

    b1.extend([END]) # end if dist_sq
    b1.extend([END]) # end if m_active

    # damping: vx *= 0.985, vy *= 0.985
    b1.extend([LOCAL_GET, 12, F32_CONST])
    b1.extend(struct.pack('<f', 0.985))
    b1.extend([F32_MUL, LOCAL_SET, 12])

    b1.extend([LOCAL_GET, 13, F32_CONST])
    b1.extend(struct.pack('<f', 0.985))
    b1.extend([F32_MUL, LOCAL_SET, 13])

    # update position: px += vx * dt * 60.0
    b1.extend([LOCAL_GET, 10, LOCAL_GET, 12, LOCAL_GET, 7, F32_MUL, F32_CONST])
    b1.extend(struct.pack('<f', 60.0))
    b1.extend([F32_MUL, F32_ADD, LOCAL_SET, 10])

    # update py: py += vy * dt * 60.0
    b1.extend([LOCAL_GET, 11, LOCAL_GET, 13, LOCAL_GET, 7, F32_MUL, F32_CONST])
    b1.extend(struct.pack('<f', 60.0))
    b1.extend([F32_MUL, F32_ADD, LOCAL_SET, 11])

    # Boundary wrap:
    # if px < 0: px = width
    b1.extend([LOCAL_GET, 10, F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([F32_LT, IF, EMPTY_BLOCK])
    b1.extend([LOCAL_GET, 1, LOCAL_SET, 10])
    b1.extend([END])

    # if px > width: px = 0
    b1.extend([LOCAL_GET, 10, LOCAL_GET, 1, F32_GT, IF, EMPTY_BLOCK])
    b1.extend([F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([LOCAL_SET, 10])
    b1.extend([END])

    # if py < 0: py = height
    b1.extend([LOCAL_GET, 11, F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([F32_LT, IF, EMPTY_BLOCK])
    b1.extend([LOCAL_GET, 2, LOCAL_SET, 11])
    b1.extend([END])

    # if py > height: py = 0
    b1.extend([LOCAL_GET, 11, LOCAL_GET, 2, F32_GT, IF, EMPTY_BLOCK])
    b1.extend([F32_CONST])
    b1.extend(struct.pack('<f', 0.0))
    b1.extend([LOCAL_SET, 11])
    b1.extend([END])

    # Store back to memory: px, py, vx, vy
    b1.extend([LOCAL_GET, 9, LOCAL_GET, 10, F32_STORE, 0x02, 0x00])
    b1.extend([LOCAL_GET, 9, LOCAL_GET, 11, F32_STORE, 0x02, 0x04])
    b1.extend([LOCAL_GET, 9, LOCAL_GET, 12, F32_STORE, 0x02, 0x08])
    b1.extend([LOCAL_GET, 9, LOCAL_GET, 13, F32_STORE, 0x02, 0x0C])

    # i += 1
    b1.extend([LOCAL_GET, 8, I32_CONST, 1, I32_ADD, LOCAL_SET, 8])
    b1.extend([BR, 0])
    b1.extend([END, END])

    b1.extend([LOCAL_GET, 0])

    f1 = make_func([(2, I32), (8, F32)], b1)


    # --- FUNC 2: get_memory_offset() -> i32 ---
    b2 = bytearray()
    b2.extend([I32_CONST, 0])
    f2 = make_func([], b2)


    # --- FUNC 3: benchmark_calc(n: i32) -> f32 ---
    # Computes Leibniz series for Pi
    b3 = bytearray()
    b3.extend([F32_CONST])
    b3.extend(struct.pack('<f', 0.0))
    b3.extend([LOCAL_SET, 1]) # sum = 0.0

    b3.extend([I32_CONST, 0, LOCAL_SET, 2]) # i = 0

    b3.extend([BLOCK, EMPTY_BLOCK])
    b3.extend([LOOP, EMPTY_BLOCK])
    b3.extend([LOCAL_GET, 2, LOCAL_GET, 0, I32_GE_S, BR_IF, 1])

    # if (i & 1) == 0:
    b3.extend([LOCAL_GET, 2, I32_CONST, 1, I32_AND, I32_EQZ, IF, EMPTY_BLOCK])
    # sum += 1.0 / (2*i + 1)
    b3.extend([LOCAL_GET, 1, F32_CONST])
    b3.extend(struct.pack('<f', 1.0))
    b3.extend([F32_CONST])
    b3.extend(struct.pack('<f', 2.0))
    b3.extend([LOCAL_GET, 2, F32_CONVERT_I32_S, F32_MUL, F32_CONST])
    b3.extend(struct.pack('<f', 1.0))
    b3.extend([F32_ADD, F32_DIV, F32_ADD, LOCAL_SET, 1])
    b3.extend([ELSE])
    # sum -= 1.0 / (2*i + 1)
    b3.extend([LOCAL_GET, 1, F32_CONST])
    b3.extend(struct.pack('<f', 1.0))
    b3.extend([F32_CONST])
    b3.extend(struct.pack('<f', 2.0))
    b3.extend([LOCAL_GET, 2, F32_CONVERT_I32_S, F32_MUL, F32_CONST])
    b3.extend(struct.pack('<f', 1.0))
    b3.extend([F32_ADD, F32_DIV, F32_SUB, LOCAL_SET, 1])
    b3.extend([END])

    # i += 1
    b3.extend([LOCAL_GET, 2, I32_CONST, 1, I32_ADD, LOCAL_SET, 2])
    b3.extend([BR, 0])
    b3.extend([END, END])

    # return sum * 4.0
    b3.extend([LOCAL_GET, 1, F32_CONST])
    b3.extend(struct.pack('<f', 4.0))
    b3.extend([F32_MUL])

    f3 = make_func([(1, F32), (1, I32)], b3)

    # Combine code section
    code_payload = vec([f0, f1, f2, f3])
    code_sec = bytes([10]) + leb_u(len(code_payload)) + code_payload

    # WASM Header: \0asm + 0x01, 0x00, 0x00, 0x00
    wasm_bytes = bytes([0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00])
    wasm_bytes += type_sec
    wasm_bytes += func_sec
    wasm_bytes += mem_sec
    wasm_bytes += export_sec
    wasm_bytes += code_sec

    return wasm_bytes

if __name__ == '__main__':
    data = build_engine()
    with open('engine.wasm', 'wb') as f:
        f.write(data)
    print(f"Generated engine.wasm successfully! ({len(data)} bytes)")
