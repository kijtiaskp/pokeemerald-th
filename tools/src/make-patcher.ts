import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from './lib/paths.ts';

// Builds a self-contained browser patcher (BPS embedded as base64) for Windows/Mac users.
// Usage: node src/make-patcher.ts <patch.bps> <target.gba> <version> <out.html>...
const SOURCE_SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';

function main(): void {
  const [patchPath, targetPath, version, ...outPaths] = process.argv.slice(2);
  if (outPaths.length === 0) throw new Error('usage: make-patcher.ts <patch.bps> <target.gba> <version> <out.html>...');
  const patch = readFileSync(patchPath);
  const targetSha1 = createHash('sha1').update(readFileSync(targetPath)).digest('hex');
  const html = readFileSync(path.join(TOOLS_DIR, 'patcher/template.html'), 'utf8')
    .replaceAll('__SOURCE_SHA1__', SOURCE_SHA1)
    .replaceAll('__TARGET_SHA1__', targetSha1)
    .replaceAll('__VERSION__', version)
    .replace('__BPS_BASE64__', () => patch.toString('base64'));
  for (const outPath of outPaths) {
    mkdirSync(path.dirname(outPath), { recursive: true });
    writeFileSync(outPath, html);
    console.log(`${outPath}: ${html.length} bytes, target SHA-1 ${targetSha1}`);
  }
}

main();
