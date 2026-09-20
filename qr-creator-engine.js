/* ============================================================
   QR Creator — encoding engine
   Vanilla JS, zero dependencies, implements ISO/IEC 18004 (the QR
   Code spec) directly: Reed-Solomon error correction, version/mask
   selection, module placement. No library, no CDN script — this
   file IS the QR encoder, so styling (dots, rounded corners, logos)
   in qr-creator.js can never be blocked by, or drift out of sync
   with, someone else's black-box output.
   ------------------------------------------------------------
   SCOPE, DELIBERATE: byte mode (UTF-8) only — no numeric/
   alphanumeric mode optimization. This is fully spec-correct and
   can encode anything (it just doesn't always produce the smallest
   possible code for pure-digit input) — see QR_CREATOR_NOTES.md's
   KIV list. Versions 1-40, all four ECC levels, exactly as spec'd.

   This file has ONE job: turn a string into a matrix of true/false
   (dark/light) modules, plus which of those modules are "function"
   modules (finder/timing/alignment/format/version/dark-module) so
   the rendering layer can style data modules and finder eyes
   differently. It never touches the DOM, a <canvas>, or localStorage
   — that split is what makes it testable under plain Node (see
   qr-creator-engine.test.js) before a single pixel is ever drawn.
   ============================================================ */

(function (root) {
  'use strict';

  /* ================= SPEC CONSTANTS =================
     These two tables are the one part of the spec that's a genuine
     lookup table, not a formula — verified against a well-known
     reference implementation before being typed in here, then
     cross-checked again by round-trip encode->decode testing across
     all 160 (version, level) combinations (see the test file).
     Index 0 of each row is unused padding so version N reads at
     index N directly, matching the spec's own 1-based versioning. */
  var ECC_CODEWORDS_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  var NUM_EC_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  // The 2-bit value written into the format-info field for each
  // level — NOT alphabetical order, this is a real spec quirk.
  var LEVEL_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var LEVELS = ['L', 'M', 'Q', 'H'];

  var PENALTY_N1 = 3, PENALTY_N2 = 3, PENALTY_N3 = 40, PENALTY_N4 = 10;

  /* ================= GF(256) ARITHMETIC =================
     QR's Reed-Solomon runs over GF(2^8) reduced by 0x11D (the
     spec's chosen primitive polynomial, x^8+x^4+x^3+x^2+1). Every
     multiply below uses the "Russian peasant" shift-and-reduce
     method rather than precomputed log/antilog tables — one less
     table to get wrong, and it's cheap enough at these sizes that
     there's no real performance reason to prefer a table. */
  function gfMultiply(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = ((z << 1) ^ (((z >>> 7) & 1) * 0x11D)) & 0xFF;
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }

  // Builds the Reed-Solomon generator polynomial of the given
  // degree (= number of EC codewords wanted), as coefficients in
  // descending power order with an implicit leading 1 term dropped
  // — i.e. result.length === degree. Root element is 0x02.
  function rsGeneratorPolynomial(degree) {
    var coeffs = new Array(degree).fill(0);
    coeffs[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        coeffs[j] = gfMultiply(coeffs[j], root);
        if (j + 1 < degree) coeffs[j] ^= coeffs[j + 1];
      }
      root = gfMultiply(root, 0x02);
    }
    return coeffs;
  }

  // Polynomial long division of dataBytes by generator (GF(256)),
  // returning the remainder — the actual EC codewords. Length of
  // the result always equals generator.length (the EC count).
  function rsRemainder(dataBytes, generator) {
    var degree = generator.length;
    var result = new Array(degree).fill(0);
    for (var i = 0; i < dataBytes.length; i++) {
      var factor = dataBytes[i] ^ result[0];
      result.shift();
      result.push(0);
      for (var j = 0; j < degree; j++) {
        result[j] ^= gfMultiply(generator[j], factor);
      }
    }
    return result;
  }

  /* ================= VERSION-DEPENDENT GEOMETRY ================= */

  function matrixSize(version) { return version * 4 + 17; }

  // Total usable bits (data+EC, including any sub-byte "remainder"
  // bits) for a version, before any ECC-level split is applied —
  // i.e. everything that isn't a finder/timing/alignment/format/
  // version/dark-module function pattern. Closed-form formula, not
  // a lookup table: (16v+128)v+64, minus alignment-pattern overhead
  // for v>=2, minus the two version-info blocks for v>=7.
  function numRawDataModules(version) {
    var result = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var numAlign = Math.floor(version / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (version >= 7) result -= 36;
    }
    return result;
  }

  function numDataCodewords(version, level) {
    var raw = Math.floor(numRawDataModules(version) / 8);
    return raw - ECC_CODEWORDS_PER_BLOCK[level][version] * NUM_EC_BLOCKS[level][version];
  }

  // Ascending list of alignment-pattern CENTER coordinates, used on
  // both axes (every combination except the 3 that fall inside a
  // finder pattern). Version 1 has none. The step-spacing formula
  // has one documented special case at version 32.
  function alignmentPatternPositions(version) {
    if (version === 1) return [];
    var numAlign = Math.floor(version / 7) + 2;
    var step = (version === 32) ? 26 : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
    var positions = new Array(numAlign);
    positions[0] = 6;
    var pos = version * 4 + 10;
    for (var i = numAlign - 1; i >= 1; i--, pos -= step) positions[i] = pos;
    return positions;
  }

  /* ================= BIT BUFFER ================= */

  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.push = function (value, numBits) {
    for (var i = numBits - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };
  BitBuffer.prototype.length = function () { return this.bits.length; };
  // Packs the bit array into bytes, MSB-first, zero-padding the
  // final byte if the buffer doesn't end on a boundary (callers are
  // expected to have already padded to a full byte on purpose —
  // this is just a safety net, not the real padding step).
  BitBuffer.prototype.toBytes = function () {
    var bytes = [];
    for (var i = 0; i < this.bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
      bytes.push(b);
    }
    return bytes;
  };

  // Byte-mode character-count-indicator width: 8 bits for versions
  // 1-9, 16 bits for versions 10-40. (Numeric/alphanumeric/kanji
  // modes use different widths — not needed here, byte mode only.)
  function charCountBits(version) { return version <= 9 ? 8 : 16; }

  /* ================= DATA CODEWORD CONSTRUCTION ================= */

  function utf8Bytes(text) { return Array.from(new TextEncoder().encode(text)); }

  // Smallest version 1-40 (within [minVersion,40]) whose data
  // capacity, at the requested level, fits mode+count+data bits.
  // Returns null if nothing fits (input too long even at v40-L).
  function chooseVersion(byteLen, level, minVersion) {
    for (var v = Math.max(1, minVersion || 1); v <= 40; v++) {
      var neededBits = 4 + charCountBits(v) + 8 * byteLen;
      if (neededBits <= numDataCodewords(v, level) * 8) return v;
    }
    return null;
  }

  // Mode indicator (4 bits, 0100=byte) + count indicator + raw
  // bytes, terminator, bit-padding to a byte, then 0xEC/0x11
  // alternating pad bytes up to the version's full data capacity.
  function buildDataCodewords(bytes, version, level) {
    var buf = new BitBuffer();
    buf.push(0b0100, 4);
    buf.push(bytes.length, charCountBits(version));
    for (var i = 0; i < bytes.length; i++) buf.push(bytes[i], 8);

    var capacityBits = numDataCodewords(version, level) * 8;
    var terminatorLen = Math.min(4, capacityBits - buf.length());
    if (terminatorLen > 0) buf.push(0, terminatorLen);
    var padToByte = (8 - (buf.length() % 8)) % 8;
    if (padToByte > 0) buf.push(0, padToByte);

    var codewords = buf.toBytes();
    var padBytes = [0xEC, 0x11];
    var p = 0;
    while (codewords.length < capacityBits / 8) { codewords.push(padBytes[p % 2]); p++; }
    return codewords;
  }

  // Splits data codewords into their spec-defined blocks, computes
  // each block's EC codewords via Reed-Solomon, then interleaves
  // data and EC columns per spec (never concatenates blocks) —
  // reading column-by-column across blocks is what lets a scanner
  // recover from damage concentrated in one physical area rather
  // than one whole block going missing.
  function addEccAndInterleave(dataCodewords, version, level) {
    var numBlocks = NUM_EC_BLOCKS[level][version];
    var eccLen = ECC_CODEWORDS_PER_BLOCK[level][version];
    var rawCodewords = Math.floor(numRawDataModules(version) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - eccLen;

    var generator = rsGeneratorPolynomial(eccLen);
    var blocks = [];
    var offset = 0;
    for (var i = 0; i < numBlocks; i++) {
      var len = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
      var data = dataCodewords.slice(offset, offset + len);
      offset += len;
      blocks.push({ data: data, ec: rsRemainder(data, generator) });
    }

    var result = [];
    var maxDataLen = shortBlockDataLen + 1;
    for (var col = 0; col < maxDataLen; col++) {
      for (var b = 0; b < blocks.length; b++) {
        if (col < blocks[b].data.length) result.push(blocks[b].data[col]);
      }
    }
    for (var col2 = 0; col2 < eccLen; col2++) {
      for (var b2 = 0; b2 < blocks.length; b2++) result.push(blocks[b2].ec[col2]);
    }
    return result;
  }

  /* ================= MATRIX CONSTRUCTION ================= */

  // Returns {isFunction, isDark} — two size*size boolean grids.
  // isFunction marks every module a data-placement pass must skip
  // (finder+separator+format-info reserve, timing, alignment, dark
  // module, version-info reserve for v>=7). isDark is pre-filled
  // with the FINAL correct color for every function module and left
  // false (light) for every data module — the data placement pass
  // only ever touches isDark where isFunction is false.
  function buildFunctionPatterns(version) {
    var size = matrixSize(version);
    var isFunction = [], isDark = [];
    for (var y = 0; y < size; y++) { isFunction.push(new Array(size).fill(false)); isDark.push(new Array(size).fill(false)); }

    // Reserves the full 8x9 / 9x8 / 9x9 bounding box around a finder
    // corner (the 7x7 finder itself plus its 1-module light
    // separator) as off-limits for data placement, then fills in the
    // finder's own true pattern: dark outer 7x7 ring, light ring
    // inside that, dark 3x3 center. Everything in the bounding box
    // that isn't part of the 7x7 (the separator ring, and the format-
    // info strip along row/col 8) starts light and is corrected later
    // by drawFormatInfo() for the strip specifically.
    function markFinder(originX, originY) {
      for (var dy = -1; dy <= 7; dy++) {
        for (var dx = -1; dx <= 7; dx++) {
          var x = originX + dx, y = originY + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          isFunction[y][x] = true;
          isDark[y][x] = false;
          if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
            var onOuterRing = (dx === 0 || dx === 6 || dy === 0 || dy === 6);
            var inCenter = (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
            isDark[y][x] = onOuterRing || inCenter;
          }
        }
      }
    }
    markFinder(0, 0);
    markFinder(size - 7, 0);
    markFinder(0, size - 7);

    // Format-info reserve: the L-shaped strip around the top-left
    // finder (column 8 rows 0-8, row 8 columns 0-8, skipping row/col
    // 6 which the timing pattern owns) plus its redundant second copy
    // along the top-right and bottom-left edges. This has to be
    // reserved here, BEFORE codewords are placed — drawFormatInfo()
    // writes the real values in much later (mask selection needs to
    // trial-draw format info per candidate mask), but if these cells
    // aren't marked off-limits now, the zigzag placement pass below
    // will happily use them as ordinary data slots, corrupting the
    // bit-to-position mapping for every other data module too.
    var fi;
    for (fi = 0; fi <= 8; fi++) { if (fi !== 6) { isFunction[fi][8] = true; isFunction[8][fi] = true; } }
    for (fi = size - 8; fi < size; fi++) { isFunction[fi][8] = true; isFunction[8][fi] = true; }

    // Timing patterns: row 6 and column 6, alternating from an even
    // coordinate (dark at even positions), skipping anywhere already
    // claimed by a finder+separator reserve.
    for (var t = 8; t < size - 8; t++) {
      if (!isFunction[6][t]) { isFunction[6][t] = true; isDark[6][t] = (t % 2 === 0); }
      if (!isFunction[t][6]) { isFunction[t][6] = true; isDark[t][6] = (t % 2 === 0); }
    }

    // Alignment patterns: 5x5 bullseye at every (pos,pos) combination
    // except the three that coincide with a finder corner.
    var aligns = alignmentPatternPositions(version);
    for (var ai = 0; ai < aligns.length; ai++) {
      for (var aj = 0; aj < aligns.length; aj++) {
        var cx = aligns[ai], cy = aligns[aj];
        var isFinderCorner = (ai === 0 && aj === 0) || (ai === 0 && aj === aligns.length - 1) || (ai === aligns.length - 1 && aj === 0);
        if (isFinderCorner) continue;
        for (var dy2 = -2; dy2 <= 2; dy2++) {
          for (var dx2 = -2; dx2 <= 2; dx2++) {
            var x2 = cx + dx2, y2 = cy + dy2;
            isFunction[y2][x2] = true;
            var ring2 = Math.max(Math.abs(dx2), Math.abs(dy2));
            isDark[y2][x2] = (ring2 !== 1);
          }
        }
      }
    }

    // The one always-dark module, fixed regardless of content.
    isFunction[size - 8][8] = true;
    isDark[size - 8][8] = true;

    // Version-info reserve (v>=7 only) — content filled in later by
    // drawVersionInfo(); reserved here so data placement skips it.
    if (version >= 7) {
      for (var vy = 0; vy < 6; vy++) for (var vx = 0; vx < 3; vx++) {
        isFunction[vy][size - 11 + vx] = true;
        isFunction[size - 11 + vx][vy] = true;
      }
    }

    return { size: size, isFunction: isFunction, isDark: isDark };
  }

  // Snake/zigzag placement: sweeps column-pairs from the right edge,
  // alternating top-to-bottom / bottom-to-top, skipping column 6
  // (the vertical timing line already reserved above) and any
  // function-module cell. Runs out of codeword bits gracefully — any
  // trailing "remainder bit" positions the spec allows for certain
  // versions are simply left as their initialized light/false value,
  // which is spec-correct by construction (never needs its own table).
  function placeCodewords(size, isFunction, isDark, codewordBytes) {
    var bitIndex = 0;
    var totalBits = codewordBytes.length * 8;
    function nextBit() {
      if (bitIndex >= totalBits) return null;
      var byte = codewordBytes[bitIndex >> 3];
      var bit = (byte >>> (7 - (bitIndex & 7))) & 1;
      bitIndex++;
      return bit;
    }
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      var upward = ((right + 1) & 2) === 0;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var y = upward ? size - 1 - vert : vert;
          if (isFunction[y][x]) continue;
          var bit = nextBit();
          isDark[y][x] = bit === 1;
        }
      }
    }
    return bitIndex; // bits actually consumed, for a sanity assertion in tests
  }

  /* ================= MASKING ================= */

  function maskInvert(maskId, x, y) {
    switch (maskId) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      case 7: return (((x + y) % 2) + (x * y) % 3) % 2 === 0;
      default: throw new Error('bad mask id');
    }
  }

  // XOR-toggles every non-function module for the given mask.
  // Applying the same mask twice is a no-op by construction (XOR is
  // its own inverse), which is how trial masking gets "undone"
  // between candidates without needing a saved copy of the grid.
  function applyMaskToggle(size, isFunction, isDark, maskId) {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        if (maskInvert(maskId, x, y)) isDark[y][x] = !isDark[y][x];
      }
    }
  }

  /* ================= FORMAT / VERSION INFO ================= */

  // 15-bit format string: 5 data bits (2-bit level + 3-bit mask),
  // BCH-encoded with generator 0x537 (degree 10), XORed with the
  // spec's fixed mask 0x5412 so an all-zero data value never
  // produces an all-zero (easily confused with "no code here")
  // final string.
  function formatInfoBits(level, maskId) {
    var data = (LEVEL_FORMAT_BITS[level] << 3) | maskId;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  }
  function bitAt(value, i) { return (value >>> i) & 1; }

  function drawFormatInfo(size, isDark, level, maskId) {
    var bits = formatInfoBits(level, maskId);
    var i;
    for (i = 0; i <= 5; i++) isDark[i][8] = !!bitAt(bits, i);
    isDark[7][8] = !!bitAt(bits, 6);
    isDark[8][8] = !!bitAt(bits, 7);
    isDark[8][7] = !!bitAt(bits, 8);
    for (i = 9; i < 15; i++) isDark[8][14 - i] = !!bitAt(bits, i);
    for (i = 0; i < 8; i++) isDark[8][size - 1 - i] = !!bitAt(bits, i);
    for (i = 8; i < 15; i++) isDark[size - 15 + i][8] = !!bitAt(bits, i);
    isDark[size - 8][8] = true; // the fixed dark module, re-asserted defensively
  }

  // 18-bit version string (v>=7 only): 6 data bits (version number)
  // + BCH ECC with generator 0x1F25 (degree 12). Two identical 6x3
  // copies, placed adjacent to the top-right and bottom-left finders.
  function versionInfoBits(version) {
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1F25);
    return (version << 12) | rem;
  }
  function drawVersionInfo(size, isDark, version) {
    if (version < 7) return;
    var bits = versionInfoBits(version);
    var k = 0;
    for (var i = 0; i < 6; i++) {
      for (var j = 0; j < 3; j++) {
        var bit = !!bitAt(bits, k);
        isDark[i][size - 11 + j] = bit;
        isDark[size - 11 + j][i] = bit;
        k++;
      }
    }
  }

  /* ================= PENALTY SCORING (mask selection) =================
     All four rules from the spec, including the "finder-like
     pattern" rule implemented via a 7-slot run-length history rather
     than a naive substring search — this is what correctly requires
     at least 4 modules of clear space on ONE side of the 1:1:3:1:1
     shape (a plain substring match would over- or under-count at
     grid edges). */

  function scanLinePenalty(getColor, length) {
    var result = 0;
    var runHistory = [0, 0, 0, 0, 0, 0, 0];
    var color = false, runLen = 0;
    function pushHistory(run) { runHistory.unshift(run); runHistory.pop(); }
    function isFinderLike() {
      var n = runHistory[1];
      return n > 0 && runHistory[2] === n && runHistory[4] === n && runHistory[5] === n
        && runHistory[3] === n * 3 && (runHistory[0] >= n * 4 || runHistory[6] >= n * 4);
    }
    for (var i = 0; i < length; i++) {
      var c = getColor(i);
      if (c === color) {
        runLen++;
        if (runLen === 5) result += PENALTY_N1;
        else if (runLen > 5) result += 1;
      } else {
        pushHistory(runLen);
        if (!color && isFinderLike()) result += PENALTY_N3;
        color = c; runLen = 1;
      }
    }
    pushHistory(runLen);
    if (color) pushHistory(0);
    if (isFinderLike()) result += PENALTY_N3;
    return result;
  }

  function computePenalty(size, isDark) {
    var total = 0;
    for (var y = 0; y < size; y++) total += scanLinePenalty(function (x) { return isDark[y][x]; }, size);
    for (var x = 0; x < size; x++) total += scanLinePenalty(function (y) { return isDark[y][x]; }, size);

    for (var y2 = 0; y2 < size - 1; y2++) {
      for (var x2 = 0; x2 < size - 1; x2++) {
        var c = isDark[y2][x2];
        if (c === isDark[y2][x2 + 1] && c === isDark[y2 + 1][x2] && c === isDark[y2 + 1][x2 + 1]) total += PENALTY_N2;
      }
    }

    var dark = 0;
    for (var y3 = 0; y3 < size; y3++) for (var x3 = 0; x3 < size; x3++) if (isDark[y3][x3]) dark++;
    var totalModules = size * size;
    var k = Math.floor((Math.abs(dark * 20 - totalModules * 10) + totalModules - 1) / totalModules) - 1;
    total += Math.max(0, k) * PENALTY_N4;
    return total;
  }

  /* ================= TOP-LEVEL ENCODE ================= */

  // options: { eccLevel: 'L'|'M'|'Q'|'H' (default 'M'), minVersion,
  //            boostEcl (default true), forceMask (0-7, else auto) }
  // Returns { version, size, level, mask, matrix } where matrix[y][x]
  // is true for a dark module. Throws if the text is too long even
  // at version 40 with the requested level.
  function encode(text, options) {
    options = options || {};
    var requestedLevel = options.eccLevel || 'M';
    if (LEVELS.indexOf(requestedLevel) === -1) throw new Error('Unknown ECC level: ' + requestedLevel);
    var bytes = utf8Bytes(text == null ? '' : String(text));

    var version = chooseVersion(bytes.length, requestedLevel, options.minVersion);
    if (version === null) throw new Error('Text is too long to encode, even at version 40 with ECC level ' + requestedLevel + '.');

    var level = requestedLevel;
    if (options.boostEcl !== false) {
      var neededBits = 4 + charCountBits(version) + 8 * bytes.length;
      for (var li = LEVELS.indexOf(requestedLevel); li < LEVELS.length; li++) {
        var candidate = LEVELS[li];
        if (neededBits <= numDataCodewords(version, candidate) * 8) level = candidate;
      }
    }

    var dataCodewords = buildDataCodewords(bytes, version, level);
    var finalCodewords = addEccAndInterleave(dataCodewords, version, level);

    var skeleton = buildFunctionPatterns(version);
    var size = skeleton.size;

    // Trial every mask (or just the forced one), scoring the WHOLE
    // grid including that trial's own format-info bits, exactly as
    // the spec intends — format info is part of what a scanner reads
    // off the printed code, so it has to factor into which mask
    // actually looks cleanest.
    var candidateMasks = (typeof options.forceMask === 'number') ? [options.forceMask] : [0, 1, 2, 3, 4, 5, 6, 7];
    var bestMask = null, bestPenalty = Infinity, bestIsDark = null;
    candidateMasks.forEach(function (maskId) {
      var isDark = skeleton.isDark.map(function (row) { return row.slice(); });
      placeCodewords(size, skeleton.isFunction, isDark, finalCodewords);
      applyMaskToggle(size, skeleton.isFunction, isDark, maskId);
      drawFormatInfo(size, isDark, level, maskId);
      drawVersionInfo(size, isDark, version);
      var penalty = computePenalty(size, isDark);
      if (penalty < bestPenalty) { bestPenalty = penalty; bestMask = maskId; bestIsDark = isDark; }
    });

    return { version: version, size: size, level: level, mask: bestMask, matrix: bestIsDark, isFunctionModule: skeleton.isFunction };
  }

  var QRCreatorEngine = {
    encode: encode,
    // Exposed for the test suite / cross-checks only — page code
    // should only ever need encode().
    _internal: {
      numDataCodewords: numDataCodewords, numRawDataModules: numRawDataModules,
      alignmentPatternPositions: alignmentPatternPositions, chooseVersion: chooseVersion,
      rsGeneratorPolynomial: rsGeneratorPolynomial, rsRemainder: rsRemainder,
      ECC_CODEWORDS_PER_BLOCK: ECC_CODEWORDS_PER_BLOCK, NUM_EC_BLOCKS: NUM_EC_BLOCKS,
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = QRCreatorEngine;
  else root.QRCreatorEngine = QRCreatorEngine;
})(typeof window !== 'undefined' ? window : global);
