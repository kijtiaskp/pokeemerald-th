import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from '../lib/paths.ts';

export type Rows = number[];

export interface FontLayout {
  sheet: string;
  widthTable: string;
  bodyRows: 6 | 7;
  lowerMarkTop: number;
  height: number;
  narrow: boolean;
}

export interface ThaiGlyph {
  slot: number;
  char: string;
  isMark: boolean;
  shiftLeft: number;
  shadowBelow: boolean;
  rows: (layout: FontLayout) => Rows;
}

const GLYPH_ROWS = 16;
const RIGHTMOST_COLUMN_BIT = 0x01;
const UNIFONT_PATH = path.join(TOOLS_DIR, 'vendor/unifont-16.0.04.hex');
const TALL_SHIFT = 2;

const TALL_CONSONANTS = new Set(['ป', 'ฝ', 'ฟ', 'ฬ']);
const SPACING_VOWELS = ['ฯ', 'ะ', 'า', 'เ', 'แ', 'โ', 'ใ', 'ไ', 'ๅ', 'ๆ'];
const UPPER_VOWELS = ['ั', 'ิ', 'ี', 'ึ', 'ื'];
const LOWER_VOWELS = ['ุ', 'ู'];
const TONES = ['่', '้', '๊', '๋', '์'];

const SPACING_SLOTS = [
  ...range(0x01, 0x1a),
  ...range(0x1c, 0x2b),
  ...range(0x2f, 0x33),
  ...range(0x5e, 0x66),
];
const MARK_SLOTS = [...range(0x38, 0x4f), ...range(0x87, 0x92)];

const HIGH_TONE_CODEPOINT = 0xf701;
const SHIFTED_UPPER_CODEPOINT = 0xf710;
const SHIFTED_LOW_TONE_CODEPOINT = 0xf717;
const SHIFTED_HIGH_TONE_CODEPOINT = 0xf71c;

const HIGH_TONE_ROWS: Record<string, [string, string]> = {
  '่': ['.....#..', '.....#..'],
  '้': ['...##.#.', '....##..'],
  '๊': ['..#.#.#.', '..##.##.'],
  '๋': ['.....#..', '....###.'],
  '์': ['....###.', '....##..'],
};

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function popcount(value: number): number {
  let count = 0;
  for (let v = value; v; v &= v - 1) count++;
  return count;
}

function parseRowStrings(rows: string[]): Rows {
  return rows.map((row) => [...row].reduce((mask, pixel, x) => (pixel === '#' ? mask | (0x80 >> x) : mask), 0));
}

function loadUnifont(): Map<string, Rows> {
  const glyphs = new Map<string, Rows>();
  for (const line of readFileSync(UNIFONT_PATH, 'utf8').split('\n')) {
    const [codeHex, bitmap] = line.split(':');
    const code = parseInt(codeHex, 16);
    if (code < 0x0e00 || code > 0x0e7f || bitmap?.length !== 32) continue;
    glyphs.set(String.fromCodePoint(code), bitmap.match(/../g)!.map((byte) => parseInt(byte, 16)));
  }
  return glyphs;
}

// Drops the least detailed row, preferring one that duplicates its neighbour (a plain stem).
function removeOneRow(region: Rows): Rows {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 1; i < region.length - 1; i++) {
    const duplicatePenalty = region[i] === region[i + 1] ? 0 : 100;
    const score = duplicatePenalty + popcount(region[i]);
    if (score <= bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return region.filter((_, i) => i !== best);
}

function removeRows(region: Rows, count: number): Rows {
  let reduced = region;
  for (let i = 0; i < count; i++) reduced = removeOneRow(reduced);
  return reduced;
}

function padRows(rows: Rows): Rows {
  return [...rows, ...Array(GLYPH_ROWS).fill(0)].slice(0, GLYPH_ROWS);
}

// Unifont bodies span rows 6-13; the game font puts the body at rows 5-11 (tall) or 5-10 (small).
function deriveBaseRows(source: Rows, layout: FontLayout, isTall: boolean): Rows {
  if (!isTall) {
    const body = removeRows(source.slice(6, 14), 8 - layout.bodyRows);
    return padRows([...source.slice(1, 6), ...body, ...source.slice(14)]);
  }

  const body = removeRows(source.slice(7, 14), 7 - layout.bodyRows);
  const rows = padRows([...source.slice(2, 7), ...body, ...source.slice(14)]);
  rows[2] |= rows[3];
  return rows;
}

function shiftRows(source: Rows, offset: number): Rows {
  const rows = Array(GLYPH_ROWS).fill(0);
  source.forEach((mask, y) => {
    if (mask && y + offset >= 0 && y + offset < GLYPH_ROWS) rows[y + offset] = mask;
  });
  return rows;
}

const NARROWING_MIN_WIDTH = 6;

function columnMask(rows: Rows, column: number): number {
  return rows.reduce((mask, row, y) => (row & (0x80 >> column) ? mask | (1 << y) : mask), 0);
}

// Removes one interior column, preferring a column identical to its neighbour, so small fonts fit name slots.
// Marks keep their right edge (they are right-aligned to the base glyph), bases keep their left edge.
function narrowRows(rows: Rows, isMark: boolean): Rows {
  const columns = [...Array(8).keys()].filter((x) => columnMask(rows, x) !== 0);
  if (columns.length === 0) return rows;
  const left = Math.min(...columns);
  const right = Math.max(...columns);
  if (right - left + 1 < NARROWING_MIN_WIDTH) return rows;

  let best = -1;
  let bestScore = Infinity;
  for (let x = left + 1; x < right; x++) {
    const duplicatePenalty = columnMask(rows, x) === columnMask(rows, x + 1) || columnMask(rows, x) === columnMask(rows, x - 1) ? 0 : 100;
    const score = duplicatePenalty + popcount(columnMask(rows, x));
    if (score < bestScore) {
      best = x;
      bestScore = score;
    }
  }

  const keepMask = 0x80 >> best;
  const leftMask = (0xff << (8 - best)) & 0xff;
  const rightMask = 0xff >> (best + 1);
  return rows.map((row) =>
    isMark ? ((row & leftMask) >> 1) | (row & rightMask) : (row & leftMask) | ((row & rightMask) << 1) & ~keepMask & 0xff,
  );
}

function alignMarkToBaseStem(rows: Rows): Rows {
  const overflows = rows.some((mask) => mask & RIGHTMOST_COLUMN_BIT);
  return overflows ? rows.map((mask) => (mask << 1) & 0xff) : rows;
}

export function buildThaiGlyphs(): ThaiGlyph[] {
  const unifont = loadUnifont();
  const source = (char: string): Rows => {
    const rows = unifont.get(char);
    if (!rows) throw new Error(`Unifont is missing ${char}`);
    return rows;
  };

  const consonants = range(0x0e01, 0x0e2e).map((code) => String.fromCodePoint(code));
  const spacingChars = [...consonants, ...SPACING_VOWELS];
  if (spacingChars.length > SPACING_SLOTS.length) throw new Error('not enough spacing slots');

  const glyphs: ThaiGlyph[] = spacingChars.map((char, i) => ({
    slot: SPACING_SLOTS[i],
    char,
    isMark: false,
    shiftLeft: 0,
    shadowBelow: true,
    rows: (layout) => deriveBaseRows(source(char), layout, TALL_CONSONANTS.has(char)),
  }));

  const upperRows = (char: string): Rows => {
    if (char === 'ํ') return alignMarkToBaseStem(shiftRows(source(char), 1));
    if (char === '็') {
      const s = source(char);
      return alignMarkToBaseStem(shiftRows([0, s[1], s[3], s[4]], 0));
    }
    return alignMarkToBaseStem(shiftRows(source(char), -1));
  };
  const lowToneRows = (char: string): Rows => alignMarkToBaseStem(shiftRows(source(char), 1));
  const highToneRows = (char: string): Rows => padRows(parseRowStrings(HIGH_TONE_ROWS[char]));
  const lowerRows = (char: string, layout: FontLayout): Rows =>
    alignMarkToBaseStem(shiftRows(source(char).slice(14), layout.lowerMarkTop));

  const upperMarks = [...UPPER_VOWELS, 'ํ', '็'];
  const marks: Omit<ThaiGlyph, 'slot'>[] = [
    ...UPPER_VOWELS.map((char) => mark(char, () => upperRows(char))),
    ...LOWER_VOWELS.map((char) => mark(char, (layout) => lowerRows(char, layout))),
    mark('็', () => upperRows('็')),
    ...TONES.map((char) => mark(char, () => lowToneRows(char))),
    mark('ํ', () => upperRows('ํ')),
    ...TONES.map((char, i) => mark(String.fromCodePoint(HIGH_TONE_CODEPOINT + i), () => highToneRows(char), 0, false)),
    ...upperMarks.map((char, i) => mark(String.fromCodePoint(SHIFTED_UPPER_CODEPOINT + i), () => upperRows(char), TALL_SHIFT)),
    ...TONES.map((char, i) => mark(String.fromCodePoint(SHIFTED_LOW_TONE_CODEPOINT + i), () => lowToneRows(char), TALL_SHIFT)),
    ...TONES.map((char, i) =>
      mark(String.fromCodePoint(SHIFTED_HIGH_TONE_CODEPOINT + i), () => highToneRows(char), TALL_SHIFT, false),
    ),
  ];
  if (marks.length > MARK_SLOTS.length) throw new Error('not enough mark slots');

  return [...glyphs, ...marks.map((glyph, i) => ({ ...glyph, slot: MARK_SLOTS[i] }))].map((glyph) => ({
    ...glyph,
    rows: (layout: FontLayout) => (layout.narrow ? narrowRows(glyph.rows(layout), glyph.isMark) : glyph.rows(layout)),
  }));
}

function mark(
  char: string,
  rows: (layout: FontLayout) => Rows,
  shiftLeft = 0,
  shadowBelow = true,
): Omit<ThaiGlyph, 'slot'> {
  return { char, isMark: true, shiftLeft, shadowBelow, rows };
}
