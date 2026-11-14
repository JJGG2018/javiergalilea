#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}

// Categorías de dispositivos identificadas por el motor
pub const CAT_UNKNOWN: u32 = 0;
pub const CAT_ROUTER: u32 = 1;
pub const CAT_NETWORK: u32 = 2;
pub const CAT_NAS: u32 = 3;
pub const CAT_SERVER: u32 = 4;
pub const CAT_WORKSTATION: u32 = 5;
pub const CAT_MOBILE: u32 = 6;
pub const CAT_PRINTER: u32 = 7;
pub const CAT_MEDIA: u32 = 8;
pub const CAT_IOT: u32 = 9;
pub const CAT_CAMERA: u32 = 10;

// Sistemas operativos / perfiles inferidos
pub const OS_UNKNOWN: u32 = 0;
pub const OS_LINUX_UNIX: u32 = 1;
pub const OS_WINDOWS: u32 = 2;
pub const OS_APPLE: u32 = 3;
pub const OS_NETWORK_FW: u32 = 4;
pub const OS_EMBEDDED_IOT: u32 = 5;
pub const OS_VIRTUAL: u32 = 6;

// Máscara de puertos TCP estándar sondeados
const PORT_SSH: u32 = 1 << 0;       // 22
const PORT_TELNET: u32 = 1 << 1;    // 23
const PORT_DNS: u32 = 1 << 2;       // 53
const PORT_HTTP: u32 = 1 << 3;      // 80
const PORT_HTTPS: u32 = 1 << 4;     // 443
const PORT_SMB: u32 = 1 << 5;       // 445
const PORT_RTSP: u32 = 1 << 6;      // 554
const PORT_IPP: u32 = 1 << 7;       // 631
const PORT_MQTT: u32 = 1 << 8;      // 1883
const PORT_RDP: u32 = 1 << 9;       // 3389
const PORT_SYNOLOGY: u32 = 1 << 10; // 5000 / 5001
const PORT_MDNS: u32 = 1 << 11;     // 5353
const PORT_CAST: u32 = 1 << 12;     // 8008 / 8009
const PORT_WEBALT: u32 = 1 << 13;   // 8080 / 8443
const PORT_RAWPRINT: u32 = 1 << 14; // 9100
const PORT_PROXMOX: u32 = 1 << 15;  // 8006
const PORT_IOS: u32 = 1 << 16;      // 62078
const PORT_VNC: u32 = 1 << 17;      // 5900

const PING_CAP: usize = 512;
static mut PING_SAMPLES: [f32; PING_CAP] = [0.0; PING_CAP];
static mut PING_SORTED: [f32; PING_CAP] = [0.0; PING_CAP];
static mut PING_METRICS: [f32; 8] = [0.0; 8];
static mut OUI_RESULT_BUF: [u8; 96] = [0; 96];
static mut FINGERPRINT_OUT: [u32; 4] = [0; 4];

// Base de datos OUI IEEE compacta embebida (OUI 24-bit, nombre de fabricante, categoría base sugerida)
// Mantenida de forma estricta solo con prefijos IEEE canónicos verificados.
struct OuiEntry {
    oui: u32,
    vendor: &'static [u8],
    hint_cat: u8,
    hint_os: u8,
}

const fn oui_hex(a: u8, b: u8, c: u8) -> u32 {
    ((a as u32) << 16) | ((b as u32) << 8) | (c as u32)
}

static OUI_TABLE: &[OuiEntry] = &[
    // Virtualización & Contenedores
    OuiEntry { oui: oui_hex(0x02, 0x42, 0xAC), vendor: b"Docker Bridge Container", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x50, 0x56), vendor: b"VMware Virtual NIC", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x0C, 0x29), vendor: b"VMware Guest ESXi", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x05, 0x69), vendor: b"VMware Inc.", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },
    OuiEntry { oui: oui_hex(0x08, 0x00, 0x27), vendor: b"Oracle VirtualBox VM", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },
    OuiEntry { oui: oui_hex(0x52, 0x54, 0x00), vendor: b"QEMU / KVM / Proxmox VM", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x15, 0x5D), vendor: b"Microsoft Hyper-V", hint_cat: CAT_SERVER as u8, hint_os: OS_WINDOWS as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x16, 0x3E), vendor: b"Xen / XCP-ng Virtual NIC", hint_cat: CAT_SERVER as u8, hint_os: OS_VIRTUAL as u8 },

    // SBC & Homelab (Raspberry Pi)
    OuiEntry { oui: oui_hex(0xB8, 0x27, 0xEB), vendor: b"Raspberry Pi Foundation", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xDC, 0xA6, 0x32), vendor: b"Raspberry Pi Trading", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xE4, 0x5F, 0x01), vendor: b"Raspberry Pi Trading", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xD8, 0x3A, 0xDD), vendor: b"Raspberry Pi Trading", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x28, 0xCD, 0xC1), vendor: b"Raspberry Pi Trading", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x2C, 0xCF, 0x67), vendor: b"Raspberry Pi Trading", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },

    // NAS & Almacenamiento
    OuiEntry { oui: oui_hex(0x00, 0x11, 0x32), vendor: b"Synology Inc. (NAS)", hint_cat: CAT_NAS as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x90, 0x09, 0xD0), vendor: b"Synology Inc. (NAS)", hint_cat: CAT_NAS as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x08, 0x9B), vendor: b"QNAP Systems (NAS)", hint_cat: CAT_NAS as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x24, 0x5E, 0xBE), vendor: b"QNAP Systems (NAS)", hint_cat: CAT_NAS as u8, hint_os: OS_LINUX_UNIX as u8 },

    // Routers, Switches & Wi-Fi Infraestructura (AVM FRITZ!Box, Ubiquiti, MikroTik, Cisco, TP-Link, Netgear)
    OuiEntry { oui: oui_hex(0x00, 0x04, 0x0E), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x24, 0x65, 0x11), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x34, 0x31, 0xC4), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x38, 0x10, 0xD5), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x44, 0x4E, 0x6D), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x7C, 0xFF, 0x4D), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x9C, 0xC7, 0xA6), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xC0, 0x25, 0x06), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xCC, 0xCE, 0x1E), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xE0, 0x28, 0x6D), vendor: b"AVM GmbH (FRITZ!Box)", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x15, 0x6D), vendor: b"Ubiquiti Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x04, 0x18, 0xD6), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x18, 0xE8, 0x29), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x24, 0x5A, 0x4C), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x44, 0xD9, 0xE7), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x68, 0x72, 0x51), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x74, 0x83, 0xC2), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x78, 0x8A, 0x20), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x80, 0x2A, 0xA8), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xB4, 0xFB, 0xE4), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xDC, 0x9F, 0xDB), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xF0, 0x9F, 0xC2), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xFC, 0xEC, 0xDA), vendor: b"Ubiquiti UniFi", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x0C, 0x42), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x18, 0xFD, 0x74), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x2C, 0xC8, 0x1B), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x48, 0x8F, 0x5A), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x4C, 0x5E, 0x0C), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x64, 0xD1, 0x54), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x74, 0x4D, 0x28), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xB8, 0x69, 0xF4), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xCC, 0x2D, 0xE0), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xD4, 0x01, 0xC3), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xE4, 0x8D, 0x8C), vendor: b"MikroTik RouterBOARD", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x00, 0x0C), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x01, 0x42), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x1B, 0xD5), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x26, 0x0B), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x68, 0xEF, 0xBD), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xF4, 0xCF, 0xE2), vendor: b"Cisco Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x23, 0xCD), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x14, 0xCC, 0x20), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x18, 0xA6, 0xF7), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x50, 0xC7, 0xBF), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x54, 0xE6, 0xFC), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x64, 0x70, 0x02), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x70, 0x4F, 0x57), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x84, 0x16, 0xF9), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x98, 0xDA, 0xC4), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xA0, 0xF3, 0xC1), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xB0, 0x4E, 0x26), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xC0, 0x25, 0xE9), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xD8, 0x0D, 0x17), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xE8, 0x94, 0xF6), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xF8, 0x1A, 0x67), vendor: b"TP-Link Systems", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x0F, 0xB5), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x1E, 0x2A), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x20, 0x4E, 0x7F), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x28, 0xC6, 0x8E), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x30, 0x46, 0x9A), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x44, 0x94, 0xFC), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x6C, 0xB0, 0xCE), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x84, 0x1B, 0x5E), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xA4, 0x2B, 0x8C), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xC0, 0x3F, 0x0E), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xE4, 0xF4, 0xC6), vendor: b"NETGEAR Inc.", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },

    // Apple
    OuiEntry { oui: oui_hex(0x00, 0x03, 0x93), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x17, 0xF2), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x1E, 0xC2), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x25, 0x00), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x14, 0x10, 0x9F), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x28, 0xCF, 0xDA), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x3C, 0x15, 0xC2), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x40, 0x6C, 0x8F), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x5C, 0x96, 0x9D), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x70, 0x56, 0x81), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0x88, 0x66, 0x5A), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xA4, 0x5E, 0x60), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xAC, 0xBC, 0x32), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xBC, 0x52, 0xB7), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xD0, 0xE1, 0x40), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xF0, 0x18, 0x98), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },
    OuiEntry { oui: oui_hex(0xF4, 0x5C, 0x89), vendor: b"Apple, Inc.", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_APPLE as u8 },

    // Intel, Realtek & ASUSTek (PCs / Placas base / Portátiles)
    OuiEntry { oui: oui_hex(0x00, 0x02, 0xB3), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x13, 0x20), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x1B, 0x21), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x1E, 0x64), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x21, 0x6A), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x18, 0x5E, 0x0F), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x34, 0x13, 0xE8), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x48, 0x51, 0xB7), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x68, 0x05, 0xCA), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x80, 0x86, 0xF2), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x9C, 0xDA, 0x3E), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xA0, 0x36, 0x9F), vendor: b"Intel Corporation", hint_cat: CAT_SERVER as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xB4, 0xB6, 0x76), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xD4, 0x3D, 0x7E), vendor: b"Micro-Star / Intel NIC", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xE8, 0x6A, 0x64), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xF8, 0x63, 0x3F), vendor: b"Intel Corporation", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x00, 0xE0, 0x4C), vendor: b"Realtek Semiconductor", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },

    OuiEntry { oui: oui_hex(0x04, 0x92, 0x26), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x08, 0x60, 0x6E), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x10, 0xBF, 0x48), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x1C, 0x87, 0x2C), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x2C, 0x56, 0xDC), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x38, 0x2C, 0x4A), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x40, 0xB0, 0x76), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x50, 0x46, 0x5D), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x60, 0x45, 0xCB), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0x70, 0x8B, 0xCD), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xAC, 0x9E, 0x17), vendor: b"ASUSTek Computer", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0xBC, 0xEE, 0x7B), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },
    OuiEntry { oui: oui_hex(0xF4, 0x6D, 0x04), vendor: b"ASUSTek Computer", hint_cat: CAT_WORKSTATION as u8, hint_os: OS_UNKNOWN as u8 },

    // Impresoras
    OuiEntry { oui: oui_hex(0x00, 0x1B, 0xA9), vendor: b"Brother Industries", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x30, 0x05, 0x5C), vendor: b"Brother Industries", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x00, 0x48), vendor: b"Seiko Epson Corp.", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x00, 0x74), vendor: b"Ricoh Company Ltd.", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x10, 0x83), vendor: b"Hewlett Packard", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x3C, 0xD9, 0x2B), vendor: b"Hewlett Packard", hint_cat: CAT_PRINTER as u8, hint_os: OS_EMBEDDED_IOT as u8 },

    // IoT, Domótica, Altavoces & Smart TVs
    OuiEntry { oui: oui_hex(0x18, 0xFE, 0x34), vendor: b"Espressif Inc. (ESP8266/ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x24, 0x0A, 0xC4), vendor: b"Espressif Inc. (ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x30, 0xAE, 0xA4), vendor: b"Espressif Inc. (ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x3C, 0x71, 0xBF), vendor: b"Espressif Inc. (ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x84, 0xCC, 0xA8), vendor: b"Espressif Inc. (ESP)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x94, 0xB9, 0x7E), vendor: b"Espressif Inc. (ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xA4, 0xCF, 0x12), vendor: b"Espressif Inc. (ESP)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xC4, 0x4F, 0x33), vendor: b"Espressif Inc. (ESP32)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xDC, 0x4F, 0x22), vendor: b"Espressif Inc. (ESP)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xEC, 0xFA, 0xBC), vendor: b"Espressif Inc. (ESP)", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x17, 0x88), vendor: b"Signify / Philips Hue", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xEC, 0xB5, 0xFA), vendor: b"Signify / Philips Hue", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x0E, 0x58), vendor: b"Sonos, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xB8, 0xE9, 0x37), vendor: b"Sonos, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x5C, 0xAA, 0xFD), vendor: b"Sonos, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x94, 0x9F, 0x3E), vendor: b"Sonos, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x1E, 0x75), vendor: b"LG Electronics", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x00, 0xE0, 0x91), vendor: b"LG Electronics", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x34, 0x4D, 0xF7), vendor: b"LG Electronics", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x64, 0x99, 0x5D), vendor: b"LG Electronics", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xA8, 0x23, 0xFE), vendor: b"LG Electronics", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0x00, 0x1A, 0x80), vendor: b"Sony Corporation", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x54, 0x42, 0x49), vendor: b"Sony Corporation", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x0D, 0x4B), vendor: b"Roku, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x00, 0x04, 0x4B), vendor: b"NVIDIA Corporation", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },

    // Samsung, Xiaomi, Google, Amazon, Huawei
    OuiEntry { oui: oui_hex(0x00, 0x12, 0xFB), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x18, 0x67, 0xB0), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x30, 0xD6, 0xC9), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x50, 0xB7, 0xC3), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x8C, 0x77, 0x12), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xD0, 0x22, 0xBE), vendor: b"Samsung Electronics", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0x34, 0xCE, 0x00), vendor: b"Xiaomi Communications", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x64, 0x09, 0x80), vendor: b"Xiaomi Communications", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x78, 0x11, 0xDC), vendor: b"Xiaomi Communications", hint_cat: CAT_IOT as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xF0, 0xB4, 0x29), vendor: b"Xiaomi Communications", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0xF4, 0xF5, 0xD8), vendor: b"Google, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xF4, 0xF5, 0xE8), vendor: b"Google, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x54, 0x60, 0x09), vendor: b"Google, Inc.", hint_cat: CAT_MEDIA as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x3C, 0x5A, 0xB4), vendor: b"Google, Inc.", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0x00, 0xFC, 0x8B), vendor: b"Amazon Technologies", hint_cat: CAT_IOT as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x44, 0x65, 0x0D), vendor: b"Amazon Technologies", hint_cat: CAT_IOT as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0x74, 0xC2, 0x46), vendor: b"Amazon Technologies", hint_cat: CAT_IOT as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xF0, 0x27, 0x2D), vendor: b"Amazon Technologies", hint_cat: CAT_IOT as u8, hint_os: OS_LINUX_UNIX as u8 },
    OuiEntry { oui: oui_hex(0xFC, 0x65, 0xDE), vendor: b"Amazon Technologies", hint_cat: CAT_IOT as u8, hint_os: OS_LINUX_UNIX as u8 },

    OuiEntry { oui: oui_hex(0x00, 0xE0, 0xFC), vendor: b"Huawei Technologies", hint_cat: CAT_ROUTER as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x04, 0xBD, 0x70), vendor: b"Huawei Technologies", hint_cat: CAT_NETWORK as u8, hint_os: OS_NETWORK_FW as u8 },
    OuiEntry { oui: oui_hex(0x20, 0xF3, 0xA3), vendor: b"Huawei Technologies", hint_cat: CAT_MOBILE as u8, hint_os: OS_LINUX_UNIX as u8 },

    // Cámaras IP / Videovigilancia
    OuiEntry { oui: oui_hex(0x28, 0x57, 0xBE), vendor: b"Hikvision Digital Tech.", hint_cat: CAT_CAMERA as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x44, 0x19, 0xB6), vendor: b"Hikvision Digital Tech.", hint_cat: CAT_CAMERA as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0x54, 0xC4, 0x15), vendor: b"Hikvision Digital Tech.", hint_cat: CAT_CAMERA as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xBC, 0xAD, 0x28), vendor: b"Hikvision Digital Tech.", hint_cat: CAT_CAMERA as u8, hint_os: OS_EMBEDDED_IOT as u8 },
    OuiEntry { oui: oui_hex(0xC0, 0x56, 0xE3), vendor: b"Hikvision Digital Tech.", hint_cat: CAT_CAMERA as u8, hint_os: OS_EMBEDDED_IOT as u8 },
];

fn write_result_bytes(src: &[u8]) -> u32 {
    let n = if src.len() > 96 { 96 } else { src.len() };
    unsafe {
        let dst = (&raw mut OUI_RESULT_BUF).cast::<u8>();
        let mut i = 0;
        while i < n {
            *dst.add(i) = src[i];
            i += 1;
        }
    }
    n as u32
}

fn find_oui(oui: u32) -> Option<&'static OuiEntry> {
    let mut i = 0;
    while i < OUI_TABLE.len() {
        if OUI_TABLE[i].oui == oui {
            return Some(&OUI_TABLE[i]);
        }
        i += 1;
    }
    None
}

#[no_mangle]
pub extern "C" fn get_ping_buf_ptr() -> *mut f32 {
    (&raw mut PING_SAMPLES).cast::<f32>()
}

#[no_mangle]
pub extern "C" fn get_result_ptr() -> *const u8 {
    (&raw const OUI_RESULT_BUF).cast::<u8>()
}

#[no_mangle]
pub extern "C" fn get_ping_metric(idx: u32) -> f32 {
    if (idx as usize) >= 8 {
        return 0.0;
    }
    unsafe {
        let ptr = (&raw const PING_METRICS).cast::<f32>();
        *ptr.add(idx as usize)
    }
}

#[no_mangle]
pub extern "C" fn get_fp_out(idx: u32) -> u32 {
    if (idx as usize) >= 4 {
        return 0;
    }
    unsafe {
        let ptr = (&raw const FINGERPRINT_OUT).cast::<u32>();
        *ptr.add(idx as usize)
    }
}

/// Analiza hasta 512 muestras de latencia (valores < 0 indican paquete perdido / timeout).
/// Devuelve una puntuación de calidad de enlace [0..100] y rellena PING_METRICS[0..8].
#[no_mangle]
pub extern "C" fn analyze_ping_series(raw_count: u32) -> u32 {
    let n = if raw_count as usize > PING_CAP {
        PING_CAP
    } else {
        raw_count as usize
    };

    unsafe {
        let samples = (&raw const PING_SAMPLES).cast::<f32>();
        let sorted = (&raw mut PING_SORTED).cast::<f32>();
        let metrics = (&raw mut PING_METRICS).cast::<f32>();

        if n == 0 {
            let mut k = 0;
            while k < 8 {
                *metrics.add(k) = 0.0;
                k += 1;
            }
            return 0;
        }

        let mut ok_count: usize = 0;
        let mut sum: f32 = 0.0;
        let mut min_v: f32 = 1e9;
        let mut max_v: f32 = 0.0;
        let mut jitter: f32 = 0.0;
        let mut prev_valid: f32 = -1.0;

        let mut i = 0;
        while i < n {
            let v = *samples.add(i);
            if v >= 0.0 && v.is_finite() {
                sum += v;
                if v < min_v {
                    min_v = v;
                }
                if v > max_v {
                    max_v = v;
                }
                if prev_valid >= 0.0 {
                    let diff = (v - prev_valid).abs();
                    // Suavizado RFC 3550: J += (|D| - J) / 16
                    jitter += (diff - jitter) * (1.0 / 16.0);
                    if ok_count < 6 {
                        // Convergencia inicial más reactiva en series cortas
                        jitter = (jitter * 0.5) + (diff * 0.5);
                    }
                }
                prev_valid = v;
                *sorted.add(ok_count) = v;
                ok_count += 1;
            }
            i += 1;
        }

        let sent = n as f32;
        let recv = ok_count as f32;
        let loss_pct = ((sent - recv) / sent) * 100.0;

        *metrics.add(0) = sent;
        *metrics.add(1) = recv;
        *metrics.add(2) = loss_pct;

        if ok_count == 0 {
            *metrics.add(3) = 0.0;
            *metrics.add(4) = 0.0;
            *metrics.add(5) = 0.0;
            *metrics.add(6) = 0.0;
            *metrics.add(7) = 0.0;
            return 0;
        }

        // Ordenación por inserción para P95 exacto
        let mut a = 1;
        while a < ok_count {
            let key = *sorted.add(a);
            let mut b = a;
            while b > 0 && *sorted.add(b - 1) > key {
                *sorted.add(b) = *sorted.add(b - 1);
                b -= 1;
            }
            *sorted.add(b) = key;
            a += 1;
        }

        let avg = sum / recv;
        // Rango más cercano (nearest-rank) para el percentil 95
        let mut p95_idx = ((ok_count * 95 + 99) / 100).saturating_sub(1);
        if p95_idx >= ok_count {
            p95_idx = ok_count - 1;
        }
        let p95 = *sorted.add(p95_idx);

        *metrics.add(3) = min_v;
        *metrics.add(4) = avg;
        *metrics.add(5) = max_v;
        *metrics.add(6) = jitter;
        *metrics.add(7) = p95;

        // Cálculo de índice de salud del enlace (0..100)
        let mut score: f32 = 100.0;
        score -= loss_pct * 2.5;
        if avg > 25.0 {
            let pen = (avg - 25.0) * 0.18;
            score -= if pen > 35.0 { 35.0 } else { pen };
        }
        if jitter > 3.0 {
            let jpen = (jitter - 3.0) * 0.9;
            score -= if jpen > 25.0 { 25.0 } else { jpen };
        }
        if score < 0.0 {
            score = 0.0;
        }
        if score > 100.0 {
            score = 100.0;
        }
        (score + 0.5) as u32
    }
}

// --- UTILIDADES IPv4 / CIDR ---

#[no_mangle]
pub extern "C" fn ipv4_mask_from_prefix(prefix: u32) -> u32 {
    if prefix == 0 {
        return 0;
    }
    if prefix >= 32 {
        return 0xFFFF_FFFF;
    }
    0xFFFF_FFFFu32 << (32 - prefix)
}

#[no_mangle]
pub extern "C" fn cidr_network_addr(ip_u32: u32, prefix: u32) -> u32 {
    ip_u32 & ipv4_mask_from_prefix(prefix)
}

#[no_mangle]
pub extern "C" fn cidr_broadcast_addr(ip_u32: u32, prefix: u32) -> u32 {
    let mask = ipv4_mask_from_prefix(prefix);
    (ip_u32 & mask) | (!mask)
}

#[no_mangle]
pub extern "C" fn cidr_host_count(prefix: u32) -> u32 {
    if prefix >= 32 {
        return 1;
    }
    if prefix == 31 {
        return 2;
    }
    let host_bits = 32 - prefix;
    if host_bits >= 31 {
        return 0xFFFF_FFFE;
    }
    (1u32 << host_bits).saturating_sub(2)
}

#[no_mangle]
pub extern "C" fn cidr_nth_host(ip_u32: u32, prefix: u32, index: u32) -> u32 {
    let net = cidr_network_addr(ip_u32, prefix);
    if prefix >= 31 {
        return net.wrapping_add(index);
    }
    net.wrapping_add(1).wrapping_add(index)
}

/// 0=Pública, 1=RFC1918 10/8, 2=RFC1918 172.16/12, 3=RFC1918 192.168/16,
/// 4=Loopback 127/8, 5=Link-Local 169.254/16, 6=CGNAT 100.64/10, 7=Multicast/Reservada
#[no_mangle]
pub extern "C" fn classify_ipv4_scope(ip: u32) -> u32 {
    let a = (ip >> 24) & 0xFF;
    let b = (ip >> 16) & 0xFF;
    if a == 10 {
        return 1;
    }
    if a == 172 && (16..=31).contains(&b) {
        return 2;
    }
    if a == 192 && b == 168 {
        return 3;
    }
    if a == 127 {
        return 4;
    }
    if a == 169 && b == 254 {
        return 5;
    }
    if a == 100 && (64..=127).contains(&b) {
        return 6;
    }
    if a >= 224 || a == 0 {
        return 7;
    }
    0
}

// --- MOTOR MAC / OUI & FINGERPRINTING ---

#[no_mangle]
pub extern "C" fn is_mac_locally_administered(b0: u32) -> u32 {
    let byte0 = (b0 & 0xFF) as u8;
    if (byte0 & 0x02) != 0 && (byte0 & 0x01) == 0 {
        1
    } else {
        0
    }
}

/// Busca el fabricante por prefijo OUI en la tabla interna o detecta MAC privada aleatoria.
/// Escribe el nombre UTF-8 en OUI_RESULT_BUF y devuelve su longitud en bytes.
#[no_mangle]
pub extern "C" fn lookup_oui_vendor(b0: u32, b1: u32, b2: u32) -> u32 {
    let oui = oui_hex((b0 & 0xFF) as u8, (b1 & 0xFF) as u8, (b2 & 0xFF) as u8);
    if let Some(entry) = find_oui(oui) {
        return write_result_bytes(entry.vendor);
    }
    if is_mac_locally_administered(b0) == 1 {
        return write_result_bytes(b"MAC Privada / Aleatoria (iOS, Android o VM)");
    }
    0
}

/// Clasifica un dispositivo combinando OUI, máscara de puertos TCP, TTL y rol de gateway.
#[no_mangle]
pub extern "C" fn fingerprint_device(
    b0: u32,
    b1: u32,
    b2: u32,
    port_mask: u32,
    ttl: u32,
    is_gateway: u32,
    has_mac: u32,
) -> u32 {
    let mut cat = CAT_UNKNOWN;
    let mut os = OS_UNKNOWN;
    let mut conf: u32 = 30;
    let mut flags: u32 = 0;

    let is_local_mac = if has_mac != 0 {
        is_mac_locally_administered(b0)
    } else {
        0
    };
    if is_local_mac == 1 {
        flags |= 2;
    }

    // 1. Pista de OUI si existe MAC
    if has_mac != 0 {
        let oui = oui_hex((b0 & 0xFF) as u8, (b1 & 0xFF) as u8, (b2 & 0xFF) as u8);
        if let Some(entry) = find_oui(oui) {
            cat = entry.hint_cat as u32;
            os = entry.hint_os as u32;
            conf = 72;
            flags |= 1;
        } else if is_local_mac == 1 {
            cat = CAT_MOBILE;
            os = OS_LINUX_UNIX;
            conf = 62;
        }
    }

    // 2. Pista por TTL si aún no hay SO concreto
    if os == OS_UNKNOWN && ttl > 0 {
        if ttl <= 64 {
            os = OS_LINUX_UNIX;
            conf += 10;
        } else if ttl <= 128 {
            os = OS_WINDOWS;
            if cat == CAT_UNKNOWN {
                cat = CAT_WORKSTATION;
            }
            conf += 14;
        } else {
            os = OS_NETWORK_FW;
            if cat == CAT_UNKNOWN {
                cat = CAT_NETWORK;
            }
            conf += 12;
        }
    }

    // 3. Reglas fuertes basadas en puertos TCP detectados
    if (port_mask & PORT_PROXMOX) != 0 {
        cat = CAT_SERVER;
        os = OS_LINUX_UNIX;
        conf = 96;
    } else if (port_mask & PORT_SYNOLOGY) != 0 && ((port_mask & (PORT_SMB | PORT_SSH | PORT_HTTPS)) != 0 || cat == CAT_NAS) {
        cat = CAT_NAS;
        os = OS_LINUX_UNIX;
        conf = 92;
    } else if (port_mask & (PORT_IPP | PORT_RAWPRINT)) != 0 {
        cat = CAT_PRINTER;
        os = OS_EMBEDDED_IOT;
        conf = 95;
    } else if (port_mask & PORT_RTSP) != 0 {
        cat = CAT_CAMERA;
        os = OS_EMBEDDED_IOT;
        conf = 90;
    } else if (port_mask & PORT_CAST) != 0 {
        cat = CAT_MEDIA;
        os = OS_LINUX_UNIX;
        conf = 92;
    } else if (port_mask & PORT_IOS) != 0 {
        cat = CAT_MOBILE;
        os = OS_APPLE;
        conf = 96;
    } else if (port_mask & PORT_MQTT) != 0 {
        cat = CAT_IOT;
        os = OS_EMBEDDED_IOT;
        conf = 90;
    } else if (port_mask & PORT_RDP) != 0 {
        cat = if (port_mask & PORT_SMB) != 0 && (port_mask & PORT_WEBALT) != 0 {
            CAT_SERVER
        } else {
            CAT_WORKSTATION
        };
        os = OS_WINDOWS;
        conf = 93;
    } else if (port_mask & PORT_SMB) != 0 && cat == CAT_UNKNOWN {
        cat = if ttl > 64 && ttl <= 128 {
            os = OS_WINDOWS;
            CAT_WORKSTATION
        } else {
            CAT_NAS
        };
        conf = 80;
    } else if (port_mask & PORT_DNS) != 0 && (is_gateway == 1 || (port_mask & (PORT_HTTP | PORT_HTTPS)) != 0) {
        cat = if is_gateway == 1 { CAT_ROUTER } else { CAT_SERVER };
        if os == OS_UNKNOWN {
            os = OS_NETWORK_FW;
        }
        conf = 90;
    } else if is_gateway == 1 {
        cat = CAT_ROUTER;
        if os == OS_UNKNOWN {
            os = OS_NETWORK_FW;
        }
        conf = if conf < 88 { 88 } else { conf + 10 };
    } else if (port_mask & PORT_SSH) != 0 {
        if cat == CAT_UNKNOWN {
            cat = CAT_SERVER;
        }
        if os == OS_UNKNOWN {
            os = OS_LINUX_UNIX;
        }
        conf = if conf < 84 { 84 } else { conf + 12 };
    } else if (port_mask & (PORT_HTTP | PORT_HTTPS | PORT_WEBALT | PORT_TELNET)) != 0 {
        if cat == CAT_UNKNOWN {
            cat = if (port_mask & PORT_TELNET) != 0 { CAT_NETWORK } else { CAT_IOT };
            conf = 64;
        } else {
            conf = conf.saturating_add(10);
        }
    } else if (port_mask & PORT_MDNS) != 0 && cat == CAT_UNKNOWN {
        cat = CAT_MEDIA;
        conf = 60;
    } else if (port_mask & PORT_VNC) != 0 && cat == CAT_UNKNOWN {
        cat = CAT_WORKSTATION;
        conf = 72;
    }

    if conf > 99 {
        conf = 99;
    }

    unsafe {
        let out = (&raw mut FINGERPRINT_OUT).cast::<u32>();
        *out.add(0) = cat;
        *out.add(1) = os;
        *out.add(2) = conf;
        *out.add(3) = flags;
    }
    cat
}
