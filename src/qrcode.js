// QR code rendered as an inline SVG. Deliberately limited to what the robot id
// needs: version 1 (21 x 21), error correction level M, byte mode, which holds
// up to 14 characters. Mask 0 is used for every code; the mask is written in
// the format information, so any reader decodes it.

const SIZE = 21;
const DATA_CODEWORDS = 16; // version 1-M
const ECC_CODEWORDS = 10;
const MAX_LENGTH = 14; // DATA_CODEWORDS minus mode and length header
const ECC_LEVEL_M = 0; // format bits of level M
const MASK = 0;
const QUIET_ZONE = 4; // modules of white on each side, as the standard requires

// Multiplication in GF(256) with the QR reducing polynomial 0x11d.
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function reedSolomon(data, degree) {
  // Generator polynomial (x - 2^0)(x - 2^1)...(x - 2^(degree-1)).
  const divisor = new Array(degree).fill(0);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      divisor[j] = gfMul(divisor[j], root);
      if (j + 1 < degree) divisor[j] ^= divisor[j + 1];
    }
    root = gfMul(root, 0x02);
  }

  const rem = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift();
    rem.push(0);
    divisor.forEach((coef, i) => { rem[i] ^= gfMul(coef, factor); });
  }
  return rem;
}

/** Data codewords followed by their error correction codewords. */
function codewords(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_LENGTH) throw new Error(`too long for a version 1-M QR code: ${text}`);

  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, DATA_CODEWORDS * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  for (let pad = 0xec; data.length < DATA_CODEWORDS; pad ^= 0xec ^ 0x11) data.push(pad);

  return data.concat(reedSolomon(data, ECC_CODEWORDS));
}

/** The module matrix, true for dark, indexed [row][column]. */
function matrix(text) {
  const dark = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  const reserved = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  const set = (row, col, value) => {
    dark[row][col] = value;
    reserved[row][col] = true;
  };

  // Timing patterns, then the three finder patterns with their separators.
  for (let i = 0; i < SIZE; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  for (const [cr, cc] of [[3, 3], [3, SIZE - 4], [SIZE - 4, 3]]) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr;
        const c = cc + dc;
        if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        set(r, c, dist !== 2 && dist !== 4);
      }
    }
  }

  // Format information: level and mask, BCH protected, written twice.
  const formatData = (ECC_LEVEL_M << 3) | MASK;
  let rem = formatData;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const format = ((formatData << 10) | rem) ^ 0x5412;
  const bit = (i) => ((format >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i++) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) set(8, SIZE - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) set(SIZE - 15 + i, 8, bit(i));
  set(SIZE - 8, 8, true); // dark module

  // Data in two-column strips, zigzagging up and down from the bottom right,
  // with mask 0 applied on the way.
  const data = codewords(text);
  let n = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing pattern
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < SIZE; v++) {
      const row = upward ? SIZE - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (reserved[row][col]) continue;
        const value = n < data.length * 8 && ((data[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
        n++;
        dark[row][col] = value !== ((row + col) % 2 === 0);
      }
    }
  }

  return dark;
}

/** SVG markup of the QR code, on its own white background. */
export function qrCodeSvg(text, { moduleSize = 2 } = {}) {
  const dark = matrix(text);
  let path = '';
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (dark[r][c]) path += `M${c + QUIET_ZONE},${r + QUIET_ZONE}h1v1h-1z`;
    }
  }

  const modules = SIZE + 2 * QUIET_ZONE;
  const px = modules * moduleSize;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"` +
    ` viewBox="0 0 ${modules} ${modules}" shape-rendering="crispEdges"` +
    ` role="img" aria-label="QR code ${text}">` +
    `<rect width="${modules}" height="${modules}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/>` +
    '</svg>';
}
