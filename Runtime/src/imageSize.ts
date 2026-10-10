/** Width and height from an encoded PNG, JPEG, WebP, GIF or KTX2 header. */
export function imageSize(b: Uint8Array): {width: number; height: number} {
  const u32 = (o: number) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  const le16 = (o: number) => b[o] | b[o + 1] << 8;
  const le32 = (o: number) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return {width: u32(16), height: u32(20)};
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return {width: le16(6), height: le16(8)};
  if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return {width: le16(26) & 0x3fff, height: le16(28) & 0x3fff};
    if (kind === 'VP8L') { const v = le32(21); return {width: (v & 0x3fff) + 1, height: (v >> 14 & 0x3fff) + 1}; }
    if (kind === 'VP8X') return {width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16)};
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1], len = b[o + 2] << 8 | b[o + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return {width: b[o + 7] << 8 | b[o + 8], height: b[o + 5] << 8 | b[o + 6]};
      o += 2 + len;
    }
  }
  if (b.length > 28 && b[0] === 0xab && b[1] === 0x4b) return {width: le32(20), height: le32(24)};
  return {width: 1, height: 1};
}
