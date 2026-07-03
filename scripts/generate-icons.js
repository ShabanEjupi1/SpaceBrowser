#!/usr/bin/env node
/**
 * Space Browser – Icon Generator
 * --------------------------------
 * Generates PNG icons at required sizes from an SVG source.
 * Requires: sharp (npm install sharp --save-dev)
 *
 * Usage: node scripts/generate-icons.js
 */

const path = require('path');
const fs   = require('fs');

// ── SVG source ────────────────────────────────────────────────────────────────
// A stylised planet/orbit icon that represents "Space"

// Blue-only Space Browser icon — no purple
const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="65%">
      <stop offset="0%"   stop-color="#0f1a2e"/>
      <stop offset="100%" stop-color="#080c14"/>
    </radialGradient>
    <radialGradient id="planet" cx="38%" cy="32%" r="68%">
      <stop offset="0%"   stop-color="#60a5fa"/>
      <stop offset="55%"  stop-color="#2563eb"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softglow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="256" height="256" rx="52" fill="url(#bg)"/>

  <!-- Stars (blue-white tones only) -->
  <circle cx="36"  cy="42"  r="1.5" fill="#93c5fd" opacity="0.9"/>
  <circle cx="210" cy="68"  r="1"   fill="#bfdbfe" opacity="0.8"/>
  <circle cx="190" cy="32"  r="1.5" fill="#60a5fa" opacity="0.7"/>
  <circle cx="48"  cy="190" r="1"   fill="#bfdbfe" opacity="0.6"/>
  <circle cx="220" cy="195" r="1.5" fill="#93c5fd" opacity="0.8"/>
  <circle cx="72"  cy="218" r="1"   fill="#bfdbfe" opacity="0.5"/>
  <circle cx="160" cy="215" r="1"   fill="#60a5fa" opacity="0.6"/>
  <circle cx="30"  cy="148" r="1"   fill="#93c5fd" opacity="0.5"/>
  <circle cx="228" cy="130" r="1.5" fill="#bfdbfe" opacity="0.4"/>

  <!-- Outer orbit ring (behind planet) -->
  <ellipse cx="128" cy="128" rx="94" ry="30"
           fill="none" stroke="#1d4ed8" stroke-width="2.5" opacity="0.4"
           transform="rotate(-22 128 128)"/>

  <!-- Planet -->
  <circle cx="128" cy="128" r="52" fill="url(#planet)" filter="url(#glow)"/>

  <!-- Planet specular highlight -->
  <ellipse cx="108" cy="106" rx="20" ry="13"
           fill="white" opacity="0.14" transform="rotate(-18 108 106)"/>

  <!-- Equator band on planet -->
  <ellipse cx="128" cy="128" rx="52" ry="15"
           fill="none" stroke="rgba(147,197,253,0.2)" stroke-width="1.5"/>

  <!-- Inner orbit detail -->
  <ellipse cx="128" cy="128" rx="70" ry="20"
           fill="none" stroke="#3b82f6" stroke-width="1.5" opacity="0.3"
           transform="rotate(-22 128 128)"/>

  <!-- Outer orbit ring (in front of planet) -->
  <ellipse cx="128" cy="128" rx="94" ry="30"
           fill="none" stroke="#3b82f6" stroke-width="2.5" opacity="0.7"
           stroke-dasharray="148 432"
           transform="rotate(-22 128 128)"/>

  <!-- Orbiting satellite / moon -->
  <circle cx="208" cy="112" r="7" fill="#93c5fd" opacity="0.95" filter="url(#softglow)"/>
  <!-- Satellite shine -->
  <circle cx="206" cy="110" r="2" fill="white" opacity="0.5"/>
</svg>`;

// ── Write SVG ─────────────────────────────────────────────────────────────────

const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const svgPath = path.join(iconsDir, 'icon.svg');
fs.writeFileSync(svgPath, SVG_ICON, 'utf-8');
console.log('[icons] Wrote icon.svg');

// ── Generate PNGs via sharp ────────────────────────────────────────────────────

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.warn('[icons] sharp not installed. Run: npm install sharp --save-dev');
  console.warn('[icons] Skipping PNG/ICO generation. SVG written at:', svgPath);
  process.exit(0);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/**
 * Builds a proper Windows ICO file from an SVG buffer.
 * Embeds PNG payloads at each requested size – this satisfies NSIS / makensis
 * which rejects plain PNG files that have been renamed to .ico.
 *
 * ICO binary layout:
 *   ICONDIR         (6 bytes)
 *   ICONDIRENTRY[]  (count × 16 bytes)
 *   PNG data        (one blob per size, in order)
 */
async function generateIco(svgBuffer, outPath) {
  const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

  // Render each size as a PNG buffer
  const pngBuffers = await Promise.all(
    ICO_SIZES.map(s => sharp(svgBuffer).resize(s, s).png().toBuffer())
  );

  const count      = ICO_SIZES.length;
  const headerSize = 6 + count * 16;   // ICONDIR + all ICONDIRENTRYs

  // Compute total file size
  const totalSize  = headerSize + pngBuffers.reduce((a, b) => a + b.length, 0);
  const ico        = Buffer.alloc(totalSize);

  // ICONDIR
  ico.writeUInt16LE(0,     0);  // reserved
  ico.writeUInt16LE(1,     2);  // type = 1 (icon)
  ico.writeUInt16LE(count, 4);  // number of images

  // ICONDIRENTRYs
  let dataOffset = headerSize;
  for (let i = 0; i < count; i++) {
    const size = ICO_SIZES[i];
    const base = 6 + i * 16;
    ico.writeUInt8(size >= 256 ? 0 : size, base);      // width  (0 = 256)
    ico.writeUInt8(size >= 256 ? 0 : size, base + 1);  // height (0 = 256)
    ico.writeUInt8(0,  base + 2);  // color count
    ico.writeUInt8(0,  base + 3);  // reserved
    ico.writeUInt16LE(1,  base + 4);  // planes
    ico.writeUInt16LE(32, base + 6);  // bit count
    ico.writeUInt32LE(pngBuffers[i].length, base + 8);  // bytes in image
    ico.writeUInt32LE(dataOffset,           base + 12); // offset to image data
    dataOffset += pngBuffers[i].length;
  }

  // Image data
  let writePos = headerSize;
  for (const buf of pngBuffers) {
    buf.copy(ico, writePos);
    writePos += buf.length;
  }

  await fs.promises.writeFile(outPath, ico);
}

async function generateIcons() {
  const svgBuffer = Buffer.from(SVG_ICON);

  for (const size of SIZES) {
    const outPath = path.join(iconsDir, `icon_${size}.png`);
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath);
    console.log(`[icons] Generated ${outPath}`);
  }

  // Main icon.png (256×256)
  await sharp(svgBuffer).resize(256, 256).png().toFile(path.join(iconsDir, 'icon.png'));
  console.log('[icons] Generated icon.png (256×256)');

  // macOS icon – must be a real ICNS file; here we write a 512×512 PNG as a
  // placeholder. To produce a proper .icns, use iconutil (macOS only) or
  // the png2icons package. electron-builder on macOS handles PNG→ICNS automatically
  // when the "mac.icon" field points to a 1024×1024 PNG instead of an .icns file.
  await sharp(svgBuffer).resize(512, 512).png().toFile(path.join(iconsDir, 'icon.icns'));
  console.log('[icons] Generated icon.icns placeholder (512×512 PNG)');

  // Windows ICO – NSIS requires a genuine ICO binary, NOT a renamed PNG.
  // We build a multi-resolution ICO manually by embedding the PNG payloads
  // for standard Windows icon sizes (16, 24, 32, 48, 64, 128, 256).
  await generateIco(svgBuffer, path.join(iconsDir, 'icon.ico'));
  console.log('[icons] Generated icon.ico (multi-resolution: 16/24/32/48/64/128/256 px)');

  console.log('\n✓ Icon generation complete. Icons are in:', iconsDir);
}

generateIcons().catch(err => {
  console.error('[icons] Error:', err);
  process.exit(1);
});
