// A QR code for short text: byte mode, error correction level M, the smallest version that fits and the mask with the lowest penalty.
const correctionPerBlock = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24];
const blockCounts = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10];
const masks: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
];

function rawBits(version: number) {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignments = Math.floor(version / 7) + 2;
    bits -= (25 * alignments - 10) * alignments - 55;
    if (version >= 7) bits -= 36;
  }
  return bits;
}

function multiply(a: number, b: number) {
  let product = 0;
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((b >>> bit) & 1) * a;
  }
  return product & 0xff;
}

function divisor(degree: number) {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let term = 0; term < degree; term += 1) {
      result[term] = multiply(result[term], root);
      if (term + 1 < degree) result[term] ^= result[term + 1];
    }
    root = multiply(root, 2);
  }
  return result;
}

function remainder(data: number[], generator: number[]) {
  const result = new Array<number>(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    generator.forEach((value, index) => { result[index] ^= multiply(value, factor); });
  }
  return result;
}

function codewords(text: string) {
  const bytes = [...new TextEncoder().encode(text)];
  const capacity = (version: number) => Math.floor(rawBits(version) / 8) - correctionPerBlock[version - 1] * blockCounts[version - 1];
  let version = 1;
  while (version <= blockCounts.length && 4 + (version < 10 ? 8 : 16) + bytes.length * 8 > capacity(version) * 8) version += 1;
  if (version > blockCounts.length) throw new Error("The text is too long for a QR code.");

  const bits: number[] = [];
  const append = (value: number, length: number) => { for (let bit = length - 1; bit >= 0; bit -= 1) bits.push((value >>> bit) & 1); };
  append(4, 4);
  append(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) append(byte, 8);
  const total = capacity(version) * 8;
  append(0, Math.min(4, total - bits.length));
  append(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < total; pad ^= 0xec ^ 0x11) append(pad, 8);
  const data = Array.from({ length: total / 8 }, (_, index) => bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => byte << 1 | bit, 0));

  const blocks = blockCounts[version - 1];
  const correction = correctionPerBlock[version - 1];
  const raw = Math.floor(rawBits(version) / 8);
  const shortBlocks = blocks - raw % blocks;
  const shortLength = Math.floor(raw / blocks) - correction;
  const generator = divisor(correction);
  const parts: { data: number[]; correction: number[] }[] = [];
  for (let block = 0, offset = 0; block < blocks; block += 1) {
    const length = shortLength + (block < shortBlocks ? 0 : 1);
    const part = data.slice(offset, offset + length);
    offset += length;
    parts.push({ data: part, correction: remainder(part, generator) });
  }
  const result: number[] = [];
  for (let index = 0; index <= shortLength; index += 1) for (const part of parts) if (index < part.data.length) result.push(part.data[index]);
  for (let index = 0; index < correction; index += 1) for (const part of parts) result.push(part.correction[index]);
  return { version, data: result };
}

function alignmentPositions(version: number) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let position = version * 4 + 10; positions.length < count; position -= step) positions.splice(1, 0, position);
  return positions;
}

function penalty(grid: boolean[][]) {
  const size = grid.length;
  let score = 0;
  for (const lines of [grid, grid.map((_, x) => grid.map((row) => row[x]))]) {
    for (const line of lines) {
      for (let start = 0; start < size;) {
        let end = start;
        while (end < size && line[end] === line[start]) end += 1;
        if (end - start >= 5) score += end - start - 2;
        start = end;
      }
      const text = line.map((dark) => dark ? "1" : "0").join("");
      for (let index = 0; index + 11 <= size; index += 1) {
        const window = text.slice(index, index + 11);
        if (window === "10111010000" || window === "00001011101") score += 40;
      }
    }
  }
  for (let y = 0; y + 1 < size; y += 1) for (let x = 0; x + 1 < size; x += 1) if (grid[y][x] === grid[y][x + 1] && grid[y][x] === grid[y + 1][x] && grid[y][x] === grid[y + 1][x + 1]) score += 3;
  const dark = grid.flat().filter(Boolean).length;
  return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}

export function qrMatrix(text: string): boolean[][] {
  const { version, data } = codewords(text);
  const size = version * 4 + 17;
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { grid[y][x] = dark; fixed[y][x] = true; };

  for (let index = 0; index < size; index += 1) { set(6, index, index % 2 === 0); set(index, 6, index % 2 === 0); }
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let y = -4; y <= 4; y += 1) for (let x = -4; x <= 4; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      if (centerX + x >= 0 && centerX + x < size && centerY + y >= 0 && centerY + y < size) set(centerX + x, centerY + y, distance !== 2 && distance !== 4);
    }
  }
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  positions.forEach((centerX, column) => positions.forEach((centerY, row) => {
    if (column === 0 && row === 0 || column === 0 && row === last || column === last && row === 0) return;
    for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) set(centerX + x, centerY + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
  }));
  if (version >= 7) {
    let check = version;
    for (let index = 0; index < 12; index += 1) check = (check << 1) ^ ((check >>> 11) * 0x1f25);
    const value = version << 12 | check;
    for (let index = 0; index < 18; index += 1) {
      const dark = (value >>> index & 1) === 1;
      const near = size - 11 + index % 3;
      const far = Math.floor(index / 3);
      set(near, far, dark);
      set(far, near, dark);
    }
  }
  const drawFormat = (mask: number) => {
    // Level M is encoded as zero, so the five data bits are the mask alone.
    let check = mask;
    for (let index = 0; index < 10; index += 1) check = (check << 1) ^ ((check >>> 9) * 0x537);
    const value = (mask << 10 | check) ^ 0x5412;
    const bit = (index: number) => (value >>> index & 1) === 1;
    for (let index = 0; index <= 5; index += 1) set(8, index, bit(index));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let index = 9; index < 15; index += 1) set(14 - index, 8, bit(index));
    for (let index = 0; index < 8; index += 1) set(size - 1 - index, 8, bit(index));
    for (let index = 8; index < 15; index += 1) set(8, size - 15 + index, bit(index));
    set(8, size - 8, true);
  };
  drawFormat(0);

  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) for (let column = 0; column < 2; column += 1) {
      const x = right - column;
      const y = (right + 1 & 2) === 0 ? size - 1 - step : step;
      if (fixed[y][x]) continue;
      grid[y][x] = bit < data.length * 8 && (data[bit >>> 3] >>> (7 - (bit & 7)) & 1) === 1;
      bit += 1;
    }
  }
  const apply = (mask: number) => { for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!fixed[y][x] && masks[mask](x, y)) grid[y][x] = !grid[y][x]; };
  const scores = masks.map((_, mask) => {
    apply(mask); drawFormat(mask);
    const score = penalty(grid);
    apply(mask);
    return score;
  });
  const best = scores.indexOf(Math.min(...scores));
  apply(best); drawFormat(best);
  return grid;
}

// One path for every dark run, with the four-module quiet zone included in the view box.
export function qrPath(text: string) {
  const grid = qrMatrix(text);
  let path = "";
  grid.forEach((row, y) => row.forEach((dark, x) => {
    if (dark && !row[x - 1]) {
      let end = x;
      while (row[end]) end += 1;
      path += `M${x + 4} ${y + 4}h${end - x}v1h${x - end}z`;
    }
  }));
  return { path, size: grid.length + 8 };
}
