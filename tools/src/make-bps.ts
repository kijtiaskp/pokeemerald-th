import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

// Creates a BPS patch (beat format, used by Floating IPS / Rom Patcher JS) and verifies it round-trips.
// Usage: node src/make-bps.ts <source.gba> <target.gba> <out.bps>
const MIN_MATCH = 24;
const HASH_WINDOW = 16;
const HASH_BITS = 22;


const SOURCE_READ = 0;
const TARGET_READ = 1;
const SOURCE_COPY = 2;

function encodeNumber(value: number, out: number[]): void {
  let data = value;
  while (true) {
    const x = data & 0x7f;
    data = Math.floor(data / 128);
    if (data === 0) {
      out.push(0x80 | x);
      return;
    }
    out.push(x);
    data -= 1;
  }
}

function decodeNumber(patch: Uint8Array, cursor: { offset: number }): number {
  let data = 0;
  let shift = 1;
  while (true) {
    const x = patch[cursor.offset++];
    data += (x & 0x7f) * shift;
    if (x & 0x80) return data;
    shift *= 128;
    data += shift;
  }
}

function hashAt(bytes: Uint8Array, offset: number): number {
  let hash = 2166136261;
  for (let i = 0; i < HASH_WINDOW; i++) hash = Math.imul(hash ^ bytes[offset + i], 16777619);
  return (hash >>> 0) >>> (32 - HASH_BITS);
}

function matchLength(a: Uint8Array, aOffset: number, b: Uint8Array, bOffset: number): number {
  let length = 0;
  while (aOffset + length < a.length && bOffset + length < b.length && a[aOffset + length] === b[bOffset + length]) length++;
  return length;
}

function createPatch(source: Uint8Array, target: Uint8Array): Uint8Array {
  const table = new Int32Array(1 << HASH_BITS).fill(-1);
  for (let offset = 0; offset + HASH_WINDOW <= source.length; offset += 4) table[hashAt(source, offset)] = offset;

  const out: number[] = [0x42, 0x50, 0x53, 0x31];
  encodeNumber(source.length, out);
  encodeNumber(target.length, out);
  encodeNumber(0, out);

  let sourceRelative = 0;
  let literalStart = -1;
  const flushLiteral = (end: number) => {
    if (literalStart < 0) return;
    encodeNumber(((end - literalStart - 1) << 2) | TARGET_READ, out);
    for (let i = literalStart; i < end; i++) out.push(target[i]);
    literalStart = -1;
  };

  for (let t = 0; t < target.length; ) {
    const inPlace = t < source.length ? matchLength(source, t, target, t) : 0;
    let copyOffset = -1;
    let copyLength = 0;
    if (t + HASH_WINDOW <= target.length) {
      const candidate = table[hashAt(target, t)];
      if (candidate >= 0) {
        copyOffset = candidate;
        copyLength = matchLength(source, candidate, target, t);
      }
    }

    if (inPlace >= MIN_MATCH && inPlace >= copyLength) {
      flushLiteral(t);
      encodeNumber(((inPlace - 1) * 4) | SOURCE_READ, out);
      t += inPlace;
    } else if (copyLength >= MIN_MATCH) {
      flushLiteral(t);
      encodeNumber(((copyLength - 1) * 4) | SOURCE_COPY, out);
      const delta = copyOffset - sourceRelative;
      encodeNumber((Math.abs(delta) * 2) | (delta < 0 ? 1 : 0), out);
      sourceRelative = copyOffset + copyLength;
      t += copyLength;
    } else {
      if (literalStart < 0) literalStart = t;
      t++;
    }
  }
  flushLiteral(target.length);

  const appendCrc = (value: number) => {
    for (let i = 0; i < 4; i++) out.push((value >>> (8 * i)) & 0xff);
  };
  appendCrc(crc32(source) >>> 0);
  appendCrc(crc32(target) >>> 0);
  appendCrc(crc32(Uint8Array.from(out)) >>> 0);
  return Uint8Array.from(out);
}

function applyPatch(source: Uint8Array, patch: Uint8Array): Uint8Array {
  const cursor = { offset: 4 };
  decodeNumber(patch, cursor);
  const target = new Uint8Array(decodeNumber(patch, cursor));
  const metadataSize = decodeNumber(patch, cursor);
  cursor.offset += metadataSize;
  let outputOffset = 0;
  let sourceRelative = 0;
  let targetRelative = 0;
  while (cursor.offset < patch.length - 12) {
    const data = decodeNumber(patch, cursor);
    const action = data & 3;
    const length = Math.floor(data / 4) + 1;
    if (action === SOURCE_READ) {
      target.set(source.subarray(outputOffset, outputOffset + length), outputOffset);
    } else if (action === TARGET_READ) {
      target.set(patch.subarray(cursor.offset, cursor.offset + length), outputOffset);
      cursor.offset += length;
    } else {
      const encoded = decodeNumber(patch, cursor);
      const delta = (encoded & 1 ? -1 : 1) * Math.floor(encoded / 2);
      if (action === SOURCE_COPY) {
        sourceRelative += delta;
        target.set(source.subarray(sourceRelative, sourceRelative + length), outputOffset);
        sourceRelative += length;
      } else {
        targetRelative += delta;
        for (let i = 0; i < length; i++) target[outputOffset + i] = target[targetRelative++];
      }
    }
    outputOffset += length;
  }
  return target;
}

function main(): void {
  const [sourcePath, targetPath, outPath] = process.argv.slice(2);
  if (!outPath) throw new Error('usage: make-bps.ts <source> <target> <out.bps>');
  const source = new Uint8Array(readFileSync(sourcePath));
  const target = new Uint8Array(readFileSync(targetPath));
  const patch = createPatch(source, target);
  const roundTrip = applyPatch(source, patch);
  if (Buffer.compare(Buffer.from(roundTrip), Buffer.from(target)) !== 0) throw new Error('patch verification failed');
  writeFileSync(outPath, patch);
  console.log(`${outPath}: ${patch.length} bytes, verified`);
}

main();
