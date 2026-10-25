// アイコン生成スクリプト（外部ライブラリ不要）
// 同じ図形定義から SVG と PNG（180 / 192 / 512px、maskable を含む）を生成する。
// 使い方: node scripts/build-icons.js
//
// 図形は「角丸四角形」と「太さのある線分（端は丸）」だけに限定し、
// 各ピクセルを 4×4 のサブピクセルで判定して縁を滑らかにする（アンチエイリアス）。

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
const SIZE = 512; // 図形の座標系

const COLORS = {
  bg: '#2563eb',
  paper: '#ffffff',
  clip: '#1e3a8a',
  check: '#2563eb',
  line: '#bfdbfe',
};

/** クリップボード＋チェックマーク（座標は 512×512） */
const CONTENT = [
  { type: 'rect', x: 136, y: 104, w: 240, h: 312, r: 28, fill: COLORS.paper },
  { type: 'rect', x: 196, y: 76, w: 120, h: 60, r: 18, fill: COLORS.clip },
  { type: 'line', x1: 184, y1: 188, x2: 328, y2: 188, width: 20, stroke: COLORS.line },
  { type: 'line', x1: 196, y1: 288, x2: 240, y2: 332, width: 30, stroke: COLORS.check },
  { type: 'line', x1: 240, y1: 332, x2: 324, y2: 236, width: 30, stroke: COLORS.check },
];

/**
 * @param {'any'|'full'|'maskable'} variant
 *  any: 角丸の背景（周囲は透明） / full: 全面背景（iOS用。iOSが角丸に切り抜く） / maskable: 全面背景＋中央80%に縮小
 */
function shapes(variant) {
  const bg = variant === 'any'
    ? { type: 'rect', x: 0, y: 0, w: SIZE, h: SIZE, r: 112, fill: COLORS.bg }
    : { type: 'rect', x: 0, y: 0, w: SIZE, h: SIZE, r: 0, fill: COLORS.bg };
  const scale = variant === 'maskable' ? 0.8 : 1;
  const c = SIZE / 2;
  const t = (v) => c + (v - c) * scale;
  const content = CONTENT.map((s) =>
    s.type === 'rect'
      ? { ...s, x: t(s.x), y: t(s.y), w: s.w * scale, h: s.h * scale, r: s.r * scale }
      : { ...s, x1: t(s.x1), y1: t(s.y1), x2: t(s.x2), y2: t(s.y2), width: s.width * scale }
  );
  return [bg, ...content];
}

// ---------- SVG ----------

function toSvg(list) {
  const body = list.map((s) =>
    s.type === 'rect'
      ? `  <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${s.fill}"/>`
      : `  <line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round"/>`
  ).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">\n${body}\n</svg>\n`;
}

// ---------- ラスタライズ ----------

function insideRect(s, px, py) {
  if (px < s.x || px > s.x + s.w || py < s.y || py > s.y + s.h) return false;
  const r = Math.min(s.r, s.w / 2, s.h / 2);
  const cx = Math.min(Math.max(px, s.x + r), s.x + s.w - r);
  const cy = Math.min(Math.max(py, s.y + r), s.y + s.h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function insideLine(s, px, py) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
  const qx = s.x1 + t * dx - px;
  const qy = s.y1 + t * dy - py;
  return qx * qx + qy * qy <= (s.width / 2) ** 2;
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function rasterize(list, size) {
  const k = SIZE / size;
  const SS = 4;
  const px = new Uint8Array(size * size * 4);
  const layers = list.map((s) => ({ s, rgb: hex(s.fill || s.stroke), inside: s.type === 'rect' ? insideRect : insideLine }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 背景から順に重ねる（プリマルチプライドで合成）
      let r = 0, g = 0, b = 0, a = 0;
      for (const { s, rgb, inside } of layers) {
        let hit = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (inside(s, (x + (sx + 0.5) / SS) * k, (y + (sy + 0.5) / SS) * k)) hit++;
          }
        }
        const cov = hit / (SS * SS);
        if (cov === 0) continue;
        r = rgb[0] * cov + r * (1 - cov);
        g = rgb[1] * cov + g * (1 - cov);
        b = rgb[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      const i = (y * size + x) * 4;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

// ---------- PNG エンコード ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // フィルタなし
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 出力 ----------

const OUTPUTS = [
  { file: 'icon.svg', variant: 'any' },
  { file: 'icon-maskable.svg', variant: 'maskable' },
  { file: 'apple-touch-icon.png', variant: 'full', size: 180 },
  { file: 'icon-192.png', variant: 'any', size: 192 },
  { file: 'icon-512.png', variant: 'any', size: 512 },
  { file: 'icon-maskable-512.png', variant: 'maskable', size: 512 },
];

function main() {
  mkdirSync(OUT, { recursive: true });
  for (const o of OUTPUTS) {
    const list = shapes(o.variant);
    const data = o.size ? encodePng(rasterize(list, o.size), o.size) : toSvg(list);
    writeFileSync(join(OUT, o.file), data);
    console.log(`icons/${o.file}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
