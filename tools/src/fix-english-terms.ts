import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.ts';
import { readJsonl, type Translation } from './validate.ts';

// Replaces Thai move/item/type names left from the first glossary with the English originals.
// Usage: node src/fix-english-terms.ts [--apply] data/translations/text-01.jsonl ...
const TYPE_CONTEXT = '(ประเภท|ธาตุ|ชนิด|ท่า|สาย)\\s*';
const MOVE_CONTEXT = '(ท่า|ใช้|วิชา|สอน|จำ|ลืม|“)\\s*';
// Item names that are also everyday Thai words; replacing them would break normal sentences.
const GENERIC_ITEM_WORDS = new Set(['จักรยาน', 'เหรียญ', 'ไข่', 'จดหมาย']);
const THAI_CHAR = /[\u0E00-\u0E7F]/;

// Puts spaces between an inserted English term and adjacent Thai text, as Thai typesetting expects.
function spaced(text: string, match: RegExpExecArray, prefix: string, english: string): string {
  const start = match.index;
  const end = start + match[0].length;
  const before = text[start + prefix.length - 1] ?? (start > 0 ? text[start - 1] : '');
  const leading = prefix ? prefix : '';
  const needsLeadingSpace = (prefix ? THAI_CHAR.test(prefix.at(-1)!) : start > 0 && THAI_CHAR.test(text[start - 1])) && !/\s$/.test(leading);
  const needsTrailingSpace = end < text.length && THAI_CHAR.test(text[end]);
  void before;
  return `${leading}${needsLeadingSpace ? ' ' : ''}${english}${needsTrailingSpace ? ' ' : ''}`;
}

function replaceAll(text: string, pattern: RegExp, english: string, hasPrefix: boolean): string {
  let output = '';
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    output += text.slice(last, match.index) + spaced(text, match as RegExpExecArray, hasPrefix ? match[1] + (match[0].slice(match[1].length).match(/^\s*/)?.[0] ?? '') : '', english);
    last = match.index + match[0].length;
  }
  return output + text.slice(last);
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildReplacers(): [RegExp, string, boolean][] {
  const map = JSON.parse(readFileSync(path.join(DATA_DIR, 'work/english-terms-map.json'), 'utf8')) as Record<string, Record<string, string>>;
  const replacers: [RegExp, string, boolean][] = [];
  const byLength = (entries: [string, string][]) => entries.sort((a, b) => b[0].length - a[0].length);

  for (const [thai, english] of byLength(Object.entries({ ...map.item, ...map.berry_name }))) {
    if ([...thai].length >= 3 && !GENERIC_ITEM_WORDS.has(thai)) replacers.push([new RegExp(escapeRegex(thai), 'g'), english, false]);
  }
  for (const [thai, english] of byLength(Object.entries(map.move ?? {}))) {
    replacers.push([new RegExp(`${MOVE_CONTEXT}${escapeRegex(thai)}`, 'g'), english, true]);
  }
  for (const [thai, english] of byLength(Object.entries(map.type ?? {}))) {
    replacers.push([new RegExp(`${TYPE_CONTEXT}${escapeRegex(thai)}(?![ก-ฮ])`, 'g'), english, true]);
  }
  return replacers;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const files = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const replacers = buildReplacers();
  let total = 0;

  for (const file of files) {
    const rows = readJsonl<Translation>(file);
    let changed = 0;
    for (const row of rows) {
      const before = row.th;
      for (const [pattern, english, hasPrefix] of replacers) row.th = replaceAll(row.th, pattern, english, hasPrefix);
      if (row.th !== before) {
        changed++;
        if (!apply) console.log(`${row.id}\n  - ${before}\n  + ${row.th}`);
      }
    }
    if (apply) writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    console.log(`${file}: ${changed} entries ${apply ? 'updated' : 'would change'}`);
    total += changed;
  }
  console.log(`total ${total}`);
}

main();
