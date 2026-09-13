import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './lib/paths.ts';
import { readJsonl, type Translation } from './validate.ts';

// Unifies terms that parallel translators rendered differently (data/work/normalize-terms.json: variant -> canonical).
// Usage: node src/normalize-terms.ts [--apply]
function main(): void {
  const apply = process.argv.includes('--apply');
  const variants = Object.entries(JSON.parse(readFileSync(path.join(DATA_DIR, 'work/normalize-terms.json'), 'utf8')) as Record<string, string>)
    .sort((a, b) => b[0].length - a[0].length);
  const translationDir = path.join(DATA_DIR, 'translations');
  const counts = new Map<string, number>();

  for (const name of readdirSync(translationDir).filter((file) => file.startsWith('text-') && file.endsWith('.jsonl')).sort()) {
    const file = path.join(translationDir, name);
    const rows = readJsonl<Translation>(file);
    let changed = 0;
    for (const row of rows) {
      const before = row.th;
      for (const [variant, canonical] of variants) {
        if (!row.th.includes(variant)) continue;
        row.th = row.th.split(variant).join(canonical);
        counts.set(variant, (counts.get(variant) ?? 0) + 1);
      }
      if (row.th !== before) changed++;
    }
    if (apply && changed) writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    if (changed) console.log(`${name}: ${changed} entries`);
  }
  for (const [variant, count] of counts) console.log(`  ${variant} → ${variants.find(([v]) => v === variant)![1]}: ${count}`);
  if (!apply) console.log('dry run; pass --apply to write');
}

main();
