// Code 128 (subset B) rendered as an inline SVG. Subset B covers printable
// ASCII, which is all the robot id ever contains (two letters and a number).

// Bar/space widths, in modules, of symbol values 0..106 (106 is STOP).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
const QUIET_ZONE = 10; // modules of white on each side, as the standard requires

/** Symbol values of the whole barcode: start, data, checksum, stop. */
function encode(text) {
  const codes = [START_B];
  for (const char of text) {
    const ascii = char.charCodeAt(0);
    if (ascii < 32 || ascii > 127) throw new Error(`not encodable in Code 128B: ${char}`);
    codes.push(ascii - 32);
  }
  const checksum = codes.reduce((sum, code, i) => sum + code * Math.max(i, 1), 0) % 103;
  codes.push(checksum, STOP);
  return codes;
}

/**
 * SVG markup of the barcode, with the text printed underneath. Drawn on its own
 * white background so a scanner reads it whatever the page theme.
 */
export function code128Svg(text, { moduleWidth = 2, barHeight = 50 } = {}) {
  let x = QUIET_ZONE;
  let bars = '';

  for (const code of encode(text)) {
    const widths = PATTERNS[code];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      // Even positions are bars, odd ones spaces.
      if (i % 2 === 0) {
        bars += `<rect x="${x * moduleWidth}" y="0" width="${w * moduleWidth}" height="${barHeight}"/>`;
      }
      x += w;
    }
  }

  const width = (x + QUIET_ZONE) * moduleWidth;
  const height = barHeight + 14;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"` +
    ` role="img" aria-label="Code 128 barcode ${text}">` +
    `<rect width="${width}" height="${height}" fill="#fff"/>` +
    `<g fill="#000">${bars}</g>` +
    `<text x="${width / 2}" y="${height - 2}" text-anchor="middle" font-family="monospace"` +
    ` font-size="12" fill="#000">${text}</text>` +
    '</svg>';
}
