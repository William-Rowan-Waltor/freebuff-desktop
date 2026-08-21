// Generates the app icon assets (PNG / ICO / ICNS) with zero dependencies:
// a small rasterizer draws the Freebuff calendar glyph on the default accent
// (#34d399 emerald) gradient, and hand-rolled encoders write PNG, ICO and
// ICNS containers. Run:  node scripts/generate-icons.mjs
//
// The icon is a fixed asset — an app icon can't change with the runtime
// accent picker, so it uses the app's default/identity accent.

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'assets')
const SIZE = 1024

// ---------- color helpers ----------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Background color at (x, y): vertical emerald gradient + corner vignette. */
function bgColor(x, y) {
  const top = hexToRgb('#46e5b2')
  const bottom = hexToRgb('#0c8f66')
  const t = y / SIZE
  let r = lerp(top[0], bottom[0], t)
  let g = lerp(top[1], bottom[1], t)
  let b = lerp(top[2], bottom[2], t)
  // Gentle radial vignette toward the corners.
  const dx = (x - SIZE / 2) / (SIZE / 2)
  const dy = (y - SIZE / 2) / (SIZE / 2)
  const v = Math.max(0, Math.hypot(dx, dy) - 0.55) * 0.22
  r *= 1 - v
  g *= 1 - v
  b *= 1 - v
  return [r, g, b]
}

// ---------- geometry (signed distances) ----------
function sdRoundedRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

function sdCircle(px, py, cx, cy) {
  return Math.hypot(px - cx, py - cy)
}

function sdSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1
  const vy = y2 - y1
  const wx = px - x1
  const wy = py - y1
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(px - (x1 + vx * t), py - (y1 + vy * t))
}

/** 1px anti-aliased coverage for a signed distance (negative = inside). */
function cov(d) {
  return Math.max(0, Math.min(1, 0.5 - d))
}

// ---------- glyph: white calendar ----------
const BODY = { cx: 512, cy: 560, hw: 230, hh: 205, r: 60, stroke: 46 }
const RINGS = [
  { cx: 396, cy: 320, r: 46, stroke: 42 },
  { cx: 628, cy: 320, r: 46, stroke: 42 },
]
const RULE_Y = 600
const RULE_X = [330, 694]
const VERT_X = [430, 512, 594]
const VERT_BOTTOM = 742
const LINE_W = 26

/** White-glyph coverage at (x, y) in the 0..SIZE space. */
function glyphCoverage(x, y) {
  // Body outline: outer rounded rect minus inner.
  const outer = cov(sdRoundedRect(x, y, BODY.cx, BODY.cy, BODY.hw, BODY.hh, BODY.r))
  const inner = cov(
    sdRoundedRect(x, y, BODY.cx, BODY.cy, BODY.hw - BODY.stroke, BODY.hh - BODY.stroke, BODY.r - BODY.stroke * 0.6),
  )
  let c = outer - inner
  // Binding rings: annuli clipped to the body so they look attached.
  for (const ring of RINGS) {
    const d = sdCircle(x, y, ring.cx, ring.cy)
    const ringCov = cov(Math.abs(d - ring.r) - ring.stroke / 2)
    const overBody = cov(sdRoundedRect(x, y, BODY.cx, BODY.cy, BODY.hw, BODY.hh, BODY.r))
    c = Math.max(c, ringCov * (1 - overBody) + ringCov * overBody)
  }
  // Grid: one horizontal rule and three vertical lines inside the body.
  const hLine = cov(Math.abs(y - RULE_Y) - LINE_W / 2)
  if (x >= RULE_X[0] && x <= RULE_X[1]) c = Math.max(c, hLine)
  for (const vx of VERT_X) {
    if (y >= RULE_Y && y <= VERT_BOTTOM) {
      c = Math.max(c, cov(Math.abs(x - vx) - LINE_W / 2))
    }
  }
  return Math.max(0, Math.min(1, c))
}

// ---------- rasterize at 1024 ----------
function rasterize() {
  const px = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const bg = cov(sdRoundedRect(x, y, SIZE / 2, SIZE / 2, SIZE / 2, SIZE / 2, 232))
      const g = glyphCoverage(x, y)
      const i = (y * SIZE + x) * 4
      const [br, bgc, bb] = bgColor(x, y)
      px[i] = Math.round(lerp(br, 255, g))
      px[i + 1] = Math.round(lerp(bgc, 255, g))
      px[i + 2] = Math.round(lerp(bb, 255, g))
      px[i + 3] = Math.round(bg * 255)
    }
  }
  return px
}

// ---------- box downscale ----------
function downscale(src, sw, sh, dw, dh) {
  const dst = new Uint8Array(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh))
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4
          const alpha = src[i + 3] / 255
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha * 255
          n += alpha
        }
      }
      const i = (y * dw + x) * 4
      if (n > 0) {
        dst[i] = r / n
        dst[i + 1] = g / n
        dst[i + 2] = b / n
        dst[i + 3] = a / n
      } else {
        dst[i + 3] = 0
      }
    }
  }
  return dst
}

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = w * 4 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0 // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * stride + 1)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------- ICO / ICNS containers ----------
function encodeIco(pngs) {
  const count = pngs.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(count, 4)
  const entries = []
  let offset = 6 + count * 16
  for (const { size, png } of pngs) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size // width (0 = 256)
    e[1] = size >= 256 ? 0 : size // height
    e[2] = 0 // palette
    e[3] = 0 // reserved
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bpp
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

function encodeIcns(entries) {
  let total = 8
  for (const e of entries) total += 8 + e.png.length
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(total, 4)
  const parts = [header]
  for (const e of entries) {
    const head = Buffer.alloc(8)
    head.write(e.type, 0, 'ascii')
    head.writeUInt32BE(8 + e.png.length, 4)
    parts.push(head, e.png)
  }
  return Buffer.concat(parts)
}

// ---------- main ----------
fs.mkdirSync(OUT, { recursive: true })

const base = rasterize()
const pngs = new Map()
pngs.set(1024, encodePng(base, SIZE, SIZE))

let src = base
let srcSize = SIZE
// Halve repeatedly so each smaller size is box-filtered from the previous one.
for (const target of [512, 256, 128, 64]) {
  src = downscale(src, srcSize, srcSize, target, target)
  srcSize = target
  pngs.set(target, encodePng(src, target, target))
}
const p64 = src // 64x64 buffer kept for the non-power-of-two 48px size
const p48 = downscale(p64, 64, 64, 48, 48)
pngs.set(48, encodePng(p48, 48, 48))
for (const target of [32, 16]) {
  src = downscale(src, srcSize, srcSize, target, target)
  srcSize = target
  pngs.set(target, encodePng(src, target, target))
}

fs.writeFileSync(path.join(OUT, 'icon.png'), pngs.get(1024))
fs.writeFileSync(path.join(OUT, 'icon-512.png'), pngs.get(512))

const ico = encodeIco([
  { size: 16, png: pngs.get(16) },
  { size: 32, png: pngs.get(32) },
  { size: 48, png: pngs.get(48) },
  { size: 256, png: pngs.get(256) },
])
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico)

const icns = encodeIcns([
  { type: 'icp4', png: pngs.get(16) },
  { type: 'icp5', png: pngs.get(32) },
  { type: 'icp6', png: pngs.get(64) },
  { type: 'ic07', png: pngs.get(128) },
  { type: 'ic08', png: pngs.get(256) },
  { type: 'ic09', png: pngs.get(512) },
  { type: 'ic10', png: pngs.get(1024) },
])
fs.writeFileSync(path.join(OUT, 'icon.icns'), icns)

console.log('Wrote assets/icon.png, icon-512.png, icon.ico, icon.icns')
