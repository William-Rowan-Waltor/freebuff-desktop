// Builds icon-preview.html (self-contained, icons inlined as data URIs) so the
// generated icon can be inspected in the Preview tab. Run: node scripts/icon-preview.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const b64 = fs.readFileSync(path.join(ROOT, 'assets', 'icon.png')).toString('base64')
const b512 = fs.readFileSync(path.join(ROOT, 'assets', 'icon-512.png')).toString('base64')

const img = (data, width) =>
  `<img src="data:image/png;base64,${data}" width="${width}" style="border-radius:6px">`

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: system-ui, sans-serif; background: #0b0b0e; color: #e4e4e7; margin: 0; padding: 32px; }
  h2 { font-size: 14px; font-weight: 600; margin: 28px 0 10px; color: #a1a1aa; }
  .row { display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .tile span { font-size: 11px; color: #71717a; }
</style></head><body>
  <h2>Full icon (1024 → shown at 180px)</h2>
  <div class="row">
    <div class="tile">${img(b64, 180)}<span>icon.png · 180px</span></div>
    <div class="tile">${img(b64, 96)}<span>96px</span></div>
    <div class="tile">${img(b64, 64)}<span>64px</span></div>
    <div class="tile">${img(b64, 32)}<span>32px</span></div>
    <div class="tile">${img(b64, 16)}<span>16px</span></div>
  </div>
  <h2>On a light background</h2>
  <div class="row" style="background:#f4f4f5;border-radius:16px;padding:16px;width:max-content">
    ${img(b64, 96)} ${img(b512, 96)}
  </div>
</body></html>`

fs.writeFileSync(path.join(ROOT, 'icon-preview.html'), html)
console.log('written icon-preview.html')
