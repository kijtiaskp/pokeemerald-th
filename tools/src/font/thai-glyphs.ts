import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from '../lib/paths.ts';

export type Rows = number[];

export interface FontLayout {
  sheet: string;
  widthTable: string;
  bodyTop: number;
  bodyRows: 5 | 6;
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
const TALL_ASCENDER_ROWS = 3;
const UPPER_MARK_BOTTOM = 4;

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

// Unifont draws ข and บ (and ป) as one shape, so their reduced bodies are hand-drawn in Unifont columns.
// บ gets a wider, flat bottom stroke so it does not read as ข. Hand-drawn bodies skip small-font narrowing.
const BAW_BAIMAI_BODY: Record<FontLayout['bodyRows'], string[]> = {
  6: ['.##...#.', '.##...#.', '..#...#.', '..#...#.', '..#...#.', '..#####.'],
  5: ['.##...#.', '..#...#.', '..#...#.', '..#...#.', '..#####.'],
};
const BODY_OVERRIDES: Record<string, Record<FontLayout['bodyRows'], string[]>> = {
  'ข': {
    6: ['.##..#..', '.##..#..', '..#..#..', '.#...#..', '.#...#..', '..###...'],
    5: ['.##..#..', '..#..#..', '.#...#..', '.#...#..', '..###...'],
  },
  'บ': BAW_BAIMAI_BODY,
  'ป': BAW_BAIMAI_BODY,
};

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

// Unifont bodies span rows 6-13 (7-13 for tall consonants, whose ascender is the row 6 stem).
// The game font shrinks the body so a blank row separates it from upper marks and tones.
function deriveBaseRows(char: string, source: Rows, layout: FontLayout): Rows {
  const isTall = TALL_CONSONANTS.has(char);
  const bodyStart = isTall ? 7 : 6;
  const override = BODY_OVERRIDES[char]?.[layout.bodyRows];
  const body = override ? parseRowStrings(override) : removeRows(source.slice(bodyStart, 14), 14 - bodyStart - layout.bodyRows);
  const above = isTall ? Array(TALL_ASCENDER_ROWS).fill(source[6]) : source.slice(1, 6);
  return shiftRows([...above, ...body, ...source.slice(14)], layout.bodyTop - above.length);
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

function alignBottom(source: Rows, bottom: number): Rows {
  const lastRow = source.findLastIndex((mask) => mask !== 0);
  return shiftRows(source, bottom - lastRow);
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
    rows: (layout) => deriveBaseRows(char, source(char), layout),
  }));

  const upperRows = (char: string): Rows => {
    const s = source(char);
    const rows = char === '็' ? [s[1], s[3], s[4]] : s;
    return alignMarkToBaseStem(alignBottom(rows, UPPER_MARK_BOTTOM));
  };
  const lowToneRows = (char: string): Rows => alignMarkToBaseStem(alignBottom(source(char), UPPER_MARK_BOTTOM));
  const highToneRows = (char: string): Rows => padRows(parseRowStrings(HIGH_TONE_ROWS[char]));
  const lowerRows = (char: string, layout: FontLayout): Rows =>
    alignMarkToBaseStem(shiftRows(source(char).slice(14), layout.lowerMarkTop));

  const upperMarks = [...UPPER_VOWELS, 'ํ', '็'];
  const marks: Omit<ThaiGlyph, 'slot'>[] = [
    ...UPPER_VOWELS.map((char) => mark(char, () => upperRows(char), 0, false)),
    ...LOWER_VOWELS.map((char) => mark(char, (layout) => lowerRows(char, layout))),
    mark('็', () => upperRows('็'), 0, false),
    ...TONES.map((char) => mark(char, () => lowToneRows(char), 0, false)),
    mark('ํ', () => upperRows('ํ'), 0, false),
    ...TONES.map((char, i) => mark(String.fromCodePoint(HIGH_TONE_CODEPOINT + i), () => highToneRows(char), 0, false)),
    ...upperMarks.map((char, i) => mark(String.fromCodePoint(SHIFTED_UPPER_CODEPOINT + i), () => upperRows(char), TALL_SHIFT, false)),
    ...TONES.map((char, i) => mark(String.fromCodePoint(SHIFTED_LOW_TONE_CODEPOINT + i), () => lowToneRows(char), TALL_SHIFT, false)),
    ...TONES.map((char, i) =>
      mark(String.fromCodePoint(SHIFTED_HIGH_TONE_CODEPOINT + i), () => highToneRows(char), TALL_SHIFT, false),
    ),
  ];
  if (marks.length > MARK_SLOTS.length) throw new Error('not enough mark slots');

  return [...glyphs, ...marks.map((glyph, i) => ({ ...glyph, slot: MARK_SLOTS[i] }))].map((glyph) => ({
    ...glyph,
    rows: (layout: FontLayout) =>
      layout.narrow && !BODY_OVERRIDES[glyph.char] ? narrowRows(glyph.rows(layout), glyph.isMark) : glyph.rows(layout),
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
