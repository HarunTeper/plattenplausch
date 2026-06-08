// Generate placeholder PNG PWA icons with zero dependencies.
// Draws a flat orange paddle disc on the dark broadcast background, encoded as a
// minimal (uncompressed, stored zlib block) PNG. Run: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const BG = [11, 27, 43] // #0b1b2b
const ORANGE = [255, 90, 31] // #ff5a1f
const BLUE = [29, 111, 184] // #1d6fb8
const WHITE = [232, 237, 242]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function pngFor(size) {
  const cx = size / 2
  const cy = size * 0.45
  const r = size * 0.30
  const handleW = size * 0.10
  const handleTop = cy
  const handleBot = size * 0.92
  const ballR = size * 0.075
  const ballX = size * 0.70
  const ballY = size * 0.26

  // raw RGBA, one filter byte (0) per row
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    for (let x = 0; x < size; x++) {
      let col = BG
      const dPaddle = Math.hypot(x - cx, y - cy)
      if (dPaddle <= r) col = ORANGE
      // handle
      if (x >= cx - handleW / 2 && x <= cx + handleW / 2 && y >= handleTop && y <= handleBot)
        col = WHITE
      // ball
      const dBall = Math.hypot(x - ballX, y - ballY)
      if (dBall <= ballR) col = WHITE
      else if (dBall <= ballR + size * 0.012) col = BLUE
      const o = y * stride + 1 + x * 4
      raw[o] = col[0]
      raw[o + 1] = col[1]
      raw[o + 2] = col[2]
      raw[o + 3] = 255
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true })
for (const size of [192, 512]) {
  const out = new URL(`../public/icons/icon-${size}.png`, import.meta.url)
  writeFileSync(out, pngFor(size))
  console.log(`wrote icons/icon-${size}.png`)
}
