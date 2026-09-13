import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from './lib/paths.ts';

// Builds the self-contained browser patcher (BPS + artwork embedded) and the share banner page.
// Usage: node src/make-patcher.ts <patch.bps> <target.gba> <version> <out.html>... [--banner <out.html>]
const SOURCE_SHA1 = 'f3ae088181bf583e55daf962a92bb46f4f1d07b7';
const PATCHER_DIR = path.join(TOOLS_DIR, 'patcher');
const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg' };

function dataUri(name: string): string {
  const file = path.join(PATCHER_DIR, 'assets', name);
  return `data:${MIME_BY_EXT[path.extname(name)]};base64,${readFileSync(file).toString('base64')}`;
}

function renderTemplate(name: string, values: Record<string, () => string>): string {
  let html = readFileSync(path.join(PATCHER_DIR, name), 'utf8');
  for (const [key, value] of Object.entries(values)) html = html.replaceAll(`__${key}__`, value);
  return html;
}

function writeOut(outPath: string, html: string): void {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, html);
  console.log(`${outPath}: ${html.length} bytes`);
}

function main(): void {
  const args = process.argv.slice(2);
  const bannerIndex = args.indexOf('--banner');
  const bannerOut = bannerIndex >= 0 ? args.splice(bannerIndex, 2)[1] : undefined;
  const [patchPath, targetPath, version, ...outPaths] = args;
  if (outPaths.length === 0) throw new Error('usage: make-patcher.ts <patch.bps> <target.gba> <version> <out.html>... [--banner <out.html>]');

  const targetSha1 = createHash('sha1').update(readFileSync(targetPath)).digest('hex');
  const heroValues = {
    VERSION: () => version,
    LOGO: () => dataUri('logo.png'),
    RAYQUAZA: () => dataUri('rayquaza.png'),
    BOXART: () => dataUri('boxart.jpg'),
  };
  const heroCss = renderTemplate('hero.css', heroValues);
  const hero = renderTemplate('hero.html', heroValues);
  const pageValues = {
    ...heroValues,
    HERO_CSS: () => heroCss,
    HERO: () => hero,
    SOURCE_SHA1: () => SOURCE_SHA1,
    TARGET_SHA1: () => targetSha1,
    SHOT_1: () => dataUri('shot-1.png'),
    SHOT_2: () => dataUri('shot-2.png'),
    SHOT_3: () => dataUri('shot-3.png'),
    SHOT_4: () => dataUri('shot-4.png'),
    BPS_BASE64: () => readFileSync(patchPath).toString('base64'),
  };

  const page = renderTemplate('template.html', pageValues);
  for (const outPath of outPaths) writeOut(outPath, page);
  if (bannerOut) writeOut(bannerOut, renderTemplate('banner.html', pageValues));
  console.log(`target SHA-1 ${targetSha1}`);
}

main();
