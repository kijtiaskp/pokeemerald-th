import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { TOOLS_DIR } from './lib/paths.ts';

// Downloads and shrinks the artwork embedded in the patcher page. Skips files that already exist.
// In-game screenshots (shot-*.png) are captured from mGBA and committed by hand.
const ASSETS_DIR = path.join(TOOLS_DIR, 'patcher/assets');
const REMOTE_ASSETS = [
  { name: 'logo.png', url: 'https://archives.bulbagarden.net/media/upload/8/83/Pokemon_Emerald_Logo_EN.png', width: 900 },
  { name: 'rayquaza.png', url: 'https://archives.bulbagarden.net/media/upload/8/80/0384Rayquaza.png', width: 700 },
  { name: 'boxart.jpg', url: 'https://archives.bulbagarden.net/media/upload/6/65/Emerald_EN_boxart.jpg', width: 480 },
];

function main(): void {
  mkdirSync(ASSETS_DIR, { recursive: true });
  for (const asset of REMOTE_ASSETS) {
    const target = path.join(ASSETS_DIR, asset.name);
    if (existsSync(target)) continue;
    execFileSync('curl', ['-sfL', '-A', 'Mozilla/5.0', '-o', target, asset.url]);
    execFileSync('sips', ['--resampleWidth', String(asset.width), target], { stdio: 'ignore' });
    console.log(`fetched ${asset.name}`);
  }
}

main();
