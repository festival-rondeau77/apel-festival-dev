// Encodeur QR code minimal, sans dépendance (mode octets, versions 1 à 40,
// niveaux de correction L/M/Q/H). D'après l'algorithme de référence de
// Project Nayuki (qrcodegen, licence MIT), réécrit en ES module.
// Sortie : une matrice de booléens (true = module sombre). Pur : servi au téléphone
// (le QR de l'écran « Vous avez gagné », grand-defi 07) et importé par les scripts
// (bin/lib/qr.mjs : Cartes du jeu, QR des questions).

const ECC = { L: { ord: 0, fmt: 1 }, M: { ord: 1, fmt: 0 }, Q: { ord: 2, fmt: 3 }, H: { ord: 3, fmt: 2 } };

const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 26, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function numRawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const numDataCodewords = (ver, ecl) => Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver] * NUM_ECC_BLOCKS[ecl.ord][ver];

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = ver * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
  return r;
}

// Reed-Solomon sur GF(2^8), polynôme 0x11D.
function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree - 1).fill(0).concat([1]);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = rsMultiply(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = rsMultiply(root, 2);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((c, i) => { r[i] ^= rsMultiply(c, factor); });
  }
  return r;
}

function addEccAndInterleave(data, ver, ecl) {
  const numBlocks = NUM_ECC_BLOCKS[ecl.ord][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl.ord][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blocks = [];
  const rsDiv = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => { if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]); });
  }
  return result;
}

export function encoderQR(texte, niveau = 'M', { versionMin = 1, versionMax = 40 } = {}) {
  const ecl = ECC[niveau];
  if (!ecl) throw new Error(`niveau de correction inconnu : ${niveau}`);
  const octets = [...new TextEncoder().encode(texte)];
  let ver;
  for (ver = versionMin; ; ver++) {
    const capaciteBits = numDataCodewords(ver, ecl) * 8;
    const bitsNecessaires = 4 + (ver < 10 ? 8 : 16) + octets.length * 8;
    if (bitsNecessaires <= capaciteBits) break;
    if (ver >= versionMax) throw new Error('texte trop long pour un QR code');
  }
  // Bits de données : mode octets (0100), longueur, octets, terminateur, bourrage.
  const bits = [];
  const pousser = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  pousser(4, 4);
  pousser(octets.length, ver < 10 ? 8 : 16);
  for (const o of octets) pousser(o, 8);
  const capacite = numDataCodewords(ver, ecl) * 8;
  pousser(0, Math.min(4, capacite - bits.length));
  pousser(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacite; pad ^= 0xec ^ 0x11) pousser(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  const codewords = addEccAndInterleave(data, ver, ecl);
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

  // Motifs fonctionnels.
  const drawFinder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < size && yy >= 0 && yy < size) set(xx, yy, d !== 2 && d !== 4);
    }
  };
  const drawAlign = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); };
  const drawFormat = (mask) => {
    const dataBits = (ecl.fmt << 3) | mask;
    let rem = dataBits;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((dataBits << 10) | rem) ^ 0x5412;
    const bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  const drawVersion = () => {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((b >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
      set(a, c, bit); set(c, a, bit);
    }
  };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  drawFinder(3, 3); drawFinder(size - 4, 3); drawFinder(3, size - 4);
  const align = alignmentPositions(ver);
  for (let i = 0; i < align.length; i++) for (let j = 0; j < align.length; j++) {
    if (!((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0))) drawAlign(align[i], align[j]);
  }
  drawFormat(0); drawVersion();

  // Placement des données en zigzag.
  const allBits = [];
  for (const c of codewords) for (let i = 7; i >= 0; i--) allBits.push((c >>> i) & 1);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < allBits.length) { modules[y][x] = allBits[i] === 1; i++; }
      }
    }
  }

  // Masque : on essaie les huit, on garde la pénalité minimale.
  const applyMask = (mask) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (!isFunction[y][x] && inv) modules[y][x] = !modules[y][x];
    }
  };
  const penalty = () => {
    let result = 0;
    const addHistory = (len, hist) => { if (hist[0] === 0) len += size; hist.pop(); hist.unshift(len); };
    const countPatterns = (hist) => {
      const n = hist[1];
      const core = n > 0 && hist[2] === n && hist[3] === n * 3 && hist[4] === n && hist[5] === n;
      return (core && hist[0] >= n * 4 && hist[6] >= n ? 1 : 0) + (core && hist[6] >= n * 4 && hist[0] >= n ? 1 : 0);
    };
    const terminate = (color, len, hist) => { if (color) { addHistory(len, hist); len = 0; } addHistory(len + size, hist); return countPatterns(hist); };
    const ligne = (lire) => {
      let runColor = false, run = 0; const hist = [0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < size; i++) {
        const c = lire(i);
        if (c === runColor) { run++; if (run === 5) result += 3; else if (run > 5) result++; }
        else { addHistory(run, hist); if (!runColor) result += countPatterns(hist) * 40; runColor = c; run = 1; }
      }
      result += terminate(runColor, run, hist) * 40;
    };
    for (let y = 0; y < size; y++) ligne((x) => modules[y][x]);
    for (let x = 0; x < size; x++) ligne((y) => modules[y][x]);
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
    let dark = 0;
    for (const row of modules) for (const m of row) if (m) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    return result + k * 10;
  };
  let bestMask = 0, bestPenalty = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m); drawFormat(m);
    const p = penalty();
    if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
    applyMask(m);
  }
  applyMask(bestMask); drawFormat(bestMask);
  return { version: ver, taille: size, modules };
}

// Rendu SVG (planche imprimable, écran « Vous avez gagné ») : un chemin par QR.
export function qrEnSvg({ modules, taille }, { marge = 4, echelle = 4 } = {}) {
  const dim = (taille + 2 * marge) * echelle;
  let d = '';
  for (let y = 0; y < taille; y++) for (let x = 0; x < taille; x++) if (modules[y][x]) d += `M${(x + marge) * echelle} ${(y + marge) * echelle}h${echelle}v${echelle}h-${echelle}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
