import { crc32, deflateSync, inflateSync } from 'node:zlib';

export interface IndexedImage {
  width: number;
  height: number;
  bitDepth: number;
  palette: Buffer;
  transparency?: Buffer;
  pixels: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOR_TYPE_INDEXED = 3;

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dLeft = Math.abs(estimate - left);
  const dUp = Math.abs(estimate - up);
  const dUpLeft = Math.abs(estimate - upLeft);
  if (dLeft <= dUp && dLeft <= dUpLeft) return left;
  return dUp <= dUpLeft ? up : upLeft;
}

function unfilter(raw: Buffer, stride: number, height: number): Uint8Array {
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x > 0 ? out[dst + x - 1] : 0;
      const up = y > 0 ? out[dst - stride + x] : 0;
      const upLeft = x > 0 && y > 0 ? out[dst - stride + x - 1] : 0;
      const value = raw[src + x];
      const predictors = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)];
      if (filter > 4) throw new Error(`unknown PNG filter ${filter}`);
      out[dst + x] = (value + predictors[filter]) & 0xff;
    }
  }
  return out;
}

export function decodeIndexedPng(data: Buffer): IndexedImage {
  if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let palette = Buffer.alloc(0);
  let transparency: Buffer | undefined;
  const idat: Buffer[] = [];

  for (let offset = 8; offset < data.length; ) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('latin1', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      if (body[9] !== COLOR_TYPE_INDEXED) throw new Error('PNG is not palette-indexed');
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'PLTE') {
      palette = Buffer.from(body);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(body);
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
  }

  const stride = Math.ceil((width * bitDepth) / 8);
  const packed = unfilter(inflateSync(Buffer.concat(idat)), stride, height);
  const pixelsPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  const pixels = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = packed[y * stride + Math.floor(x / pixelsPerByte)];
      const shift = 8 - bitDepth * ((x % pixelsPerByte) + 1);
      pixels[y * width + x] = (byte >> shift) & mask;
    }
  }

  return { width, height, bitDepth, palette, transparency, pixels };
}

function chunk(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length, 0);
  header.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([header, body, crc]);
}

export function encodeIndexedPng(image: IndexedImage): Buffer {
  const { width, height, bitDepth } = image;
  const stride = Math.ceil((width * bitDepth) / 8);
  const pixelsPerByte = 8 / bitDepth;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const shift = 8 - bitDepth * ((x % pixelsPerByte) + 1);
      raw[y * (stride + 1) + 1 + Math.floor(x / pixelsPerByte)] |= image.pixels[y * width + x] << shift;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = COLOR_TYPE_INDEXED;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', image.palette),
    ...(image.transparency ? [chunk('tRNS', image.transparency)] : []),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
