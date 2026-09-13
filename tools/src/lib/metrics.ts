import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from './paths.ts';
import { tokenize, type Charmap } from './charmap.ts';

export type FontName = 'normal' | 'short' | 'narrow' | 'small' | 'smallNarrow';

const widthTables = JSON.parse(readFileSync(path.join(TOOLS_DIR, 'font/widths.json'), 'utf8')) as Record<FontName, number[]>;

// Worst-case pixel widths of runtime-substituted text, sized for Thai names.
const PLACEHOLDER_WIDTHS: Record<string, number> = {
  PLAYER: 42,
  RIVAL: 42,
  KUN: 0,
  STR_VAR_1: 56,
  STR_VAR_2: 56,
  STR_VAR_3: 56,
  B_ATK_NAME_WITH_PREFIX: 84,
  B_DEF_NAME_WITH_PREFIX: 84,
  B_EFF_NAME_WITH_PREFIX: 84,
  B_SCR_ACTIVE_NAME_WITH_PREFIX: 84,
  B_ACTIVE_NAME_WITH_PREFIX: 84,
  B_OPPONENT_MON1_NAME: 56,
  B_OPPONENT_MON2_NAME: 56,
  B_PLAYER_MON1_NAME: 56,
  B_PLAYER_MON2_NAME: 56,
  B_CURRENT_MOVE: 70,
  B_LAST_ITEM: 70,
  B_TRAINER1_CLASS: 70,
  B_TRAINER1_NAME: 56,
  B_TRAINER2_CLASS: 70,
  B_TRAINER2_NAME: 56,
};
const DEFAULT_PLACEHOLDER_WIDTH = 56;
const CONTROL_CODE_NAMES = new Set(['COLOR', 'HIGHLIGHT', 'SHADOW', 'COLOR_HIGHLIGHT_SHADOW', 'PALETTE', 'FONT', 'RESET_FONT', 'PAUSE', 'PAUSE_UNTIL_PRESS', 'WAIT_SE', 'PLAY_BGM', 'ESCAPE', 'FILL_WINDOW', 'PLAY_SE', 'CLEAR', 'SKIP_TO', 'CLEAR_TO', 'MIN_LETTER_SPACING', 'JPN', 'ENG', 'PAUSE_MUSIC', 'RESUME_MUSIC', 'SHIFT_RIGHT', 'SHIFT_DOWN', 'NAME_END']);

export function isControlCode(name: string): boolean {
  return CONTROL_CODE_NAMES.has(name) || /^FONT_|^(RED|BLUE|GREEN|WHITE|DARK_GRAY|LIGHT_GRAY|TRANSPARENT|LIGHT_\w+|DYNAMIC_COLOR\d)$/.test(name);
}

export function textWidth(text: string, charmap: Charmap, font: FontName = 'normal'): number {
  const widths = widthTables[font];
  let width = 0;
  for (const token of tokenize(text, charmap)) {
    if (token.type === 'char') width += token.bytes.reduce((sum, byte) => sum + (widths[byte] ?? 0), 0);
    else if (token.type === 'constant' && !isControlCode(token.name)) {
      width += token.name in PLACEHOLDER_WIDTHS ? PLACEHOLDER_WIDTHS[token.name] : token.bytes[0] === 0xfd ? DEFAULT_PLACEHOLDER_WIDTH : token.bytes.reduce((sum, byte) => sum + (widths[byte] ?? 0), 0);
    }
  }
  return width;
}

export function splitLines(text: string): string[] {
  return text.replace(/\$$/, '').split(/\\[nlp]/);
}
