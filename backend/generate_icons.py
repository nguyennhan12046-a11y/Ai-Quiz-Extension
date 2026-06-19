import struct
import zlib


def create_png(width, height, color=(79, 70, 229)):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    raw = b""
    for y in range(height):
        raw += b"\x00"  # filter: none
        for x in range(width):
            cx = width // 2
            cy = height // 2
            r = min(width, height) * 0.38
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist < r:
                raw += bytes(color) + b"\xff"
            else:
                raw += b"\x00\x00\x00\x00"

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr_data = chunk(b"IHDR", ihdr)
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")

    return b"\x89PNG\r\n\x1a\n" + ihdr_data + idat + iend


if __name__ == "__main__":
    import os

    icons_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "extension", "icons")
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        data = create_png(size, size)
        path = os.path.join(icons_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({len(data)} bytes)")
