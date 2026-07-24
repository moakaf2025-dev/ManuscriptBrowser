#!/usr/bin/env python3
"""
Post-build script: replace Electron's default icon in the packaged ManuscriptBrowser.exe
with our custom icon.ico. This is required on Linux/aarch64 builders where wine is
unavailable (electron-builder cannot run rcedit-win to modify the .exe).

Usage:
  python3 patch-exe-icon.py <path-to-exe> <path-to-icon.ico>
"""
import sys
import os
import lief


def build_mini_ico(src_ico_bytes: bytes, w: int, h: int) -> bytes | None:
    """Extract a single icon entry matching WxH from an .ico file and return a
    minimal one-entry .ico blob (header + 1 dirent + image)."""
    if src_ico_bytes[:4] != b"\x00\x00\x01\x00":
        return None
    count = int.from_bytes(src_ico_bytes[4:6], "little")
    for i in range(count):
        off = 6 + i * 16
        ew = src_ico_bytes[off] or 256
        eh = src_ico_bytes[off + 1] or 256
        if ew != w or eh != h:
            continue
        size = int.from_bytes(src_ico_bytes[off + 8: off + 12], "little")
        doff = int.from_bytes(src_ico_bytes[off + 12: off + 16], "little")
        mini = bytearray()
        mini += b"\x00\x00\x01\x00"       # ICO header
        mini += b"\x01\x00"               # 1 entry
        mini += src_ico_bytes[off: off + 12]  # first 12 bytes of dirent
        mini += (22).to_bytes(4, "little")   # image offset = 22
        mini += src_ico_bytes[doff: doff + size]
        return bytes(mini)
    return None


def patch(exe_path: str, ico_path: str) -> None:
    src = open(ico_path, "rb").read()

    pe = lief.PE.parse(exe_path)
    if pe is None:
        raise RuntimeError(f"Could not parse PE: {exe_path}")

    rm = pe.resources_manager
    if not rm.has_icons:
        raise RuntimeError("Executable has no existing icons to replace")

    existing = list(rm.icons)
    replaced = 0
    for icon in existing:
        w = icon.width if icon.width else 256
        h = icon.height if icon.height else 256
        mini = build_mini_ico(src, w, h)
        if mini is None:
            # Fall back: use the largest smaller size present in source
            print(f"  no {w}x{h} in source, skipping")
            continue
        new_icon = lief.PE.ResourceIcon.from_serialization(mini)
        if not isinstance(new_icon, lief.PE.ResourceIcon):
            print(f"  failed to deserialize {w}x{h}")
            continue
        new_icon.id = icon.id
        new_icon.lang = icon.lang
        new_icon.sublang = icon.sublang
        rm.change_icon(icon, new_icon)
        replaced += 1
        print(f"  replaced {w}x{h} (id={icon.id}) with {len(mini)} bytes")

    if replaced == 0:
        raise RuntimeError("No icons were replaced")

    cfg = lief.PE.Builder.config_t()
    cfg.resources = True
    cfg.overlay = True
    builder = lief.PE.Builder(pe, cfg)
    builder.build()

    tmp = exe_path + ".patched"
    builder.write(tmp)
    os.replace(tmp, exe_path)
    print(f"OK: patched {exe_path} ({replaced} icons)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: patch-exe-icon.py <exe> <ico>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2])
