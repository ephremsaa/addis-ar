#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

console.log('Building Addis AR static distribution...');

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const itemsToCopy = [
  'index.html',
  'aframe',
  'apps',
  'data',
  'three.js',
  'AR.js-1920-1080-HD.png',
  'README.md',
  'CHANGELOG.md'
];

for (const item of itemsToCopy) {
  const src = path.join(__dirname, item);
  const dest = path.join(distDir, item);
  if (fs.existsSync(src)) {
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
    console.log(`Copied: ${item}`);
  }
}

console.log('Build complete! Output in dist/');
