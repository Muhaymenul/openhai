'use strict';
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

try {
  const root = path.resolve(__dirname, '..');
  const source = nativeImage.createFromPath(path.join(root, 'assets/logo.png'));
  if (source.isEmpty()) throw new Error('Application logo is missing.');
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = sizes.map((size) => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(buffers[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += buffers[index].length;
  });
  fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...buffers]));
  app.exit(0);
} catch (error) { console.error(error.message); app.exit(1); }
