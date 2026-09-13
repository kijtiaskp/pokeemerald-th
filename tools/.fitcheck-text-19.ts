import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './src/lib/paths.ts';
import { loadCharmap } from './src/lib/charmap.ts';
import { splitLines, textWidth } from './src/lib/metrics.ts';
import { wrapParagraph } from './src/lib/reflow.ts';

const PROSE_KINDS = new Set(['item_desc', 'move_desc', 'ability_desc', 'dex', 'ribbon_desc', 'decoration_desc']);
const charmap = loadCharmap();
const sources = readFileSync(path.join(DATA_DIR, 'strings.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const byId = new Map(sources.map((entry) => [entry.id, entry]));
const limits = new Map<string, { width: number; lines: number }>();
for (const entry of sources) {
  if (!PROSE_KINDS.has(entry.kind)) continue;
  const lines = splitLines(entry.en);
  const limit = limits.get(entry.kind) ?? { width: 0, lines: 0 };
  limit.width = Math.max(limit.width, ...lines.map((line: string) => textWidth(line, charmap)));
  limit.lines = Math.max(limit.lines, lines.length);
  limits.set(entry.kind, limit);
}
console.log(Object.fromEntries(limits));
const file = process.argv[2];
let problems = 0;
for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
  const { id, th } = JSON.parse(line);
  const source = byId.get(id);
  const limit = limits.get(source.kind);
  if (!limit) continue;
  const wrapped = wrapParagraph(th, limit.width, charmap);
  const widest = Math.max(...wrapped.map((text) => textWidth(text, charmap)));
  if (wrapped.length > limit.lines || widest > limit.width) {
    problems++;
    console.log(`${id.split('#')[1]}: ${wrapped.length}/${limit.lines} lines, widest ${widest}/${limit.width}px`);
  }
}
console.log(`${problems} layout problems`);
