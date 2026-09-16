#!/usr/bin/env node

import {readFile, writeFile} from 'node:fs/promises';

const [destination, entryFile] = process.argv.slice(2);

if (!destination || !entryFile) {
  console.error('Usage: update-entry.mjs <https://...trycloudflare.com/workspace/> <index.html>');
  process.exit(2);
}

const tunnelPattern = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/workspace\/$/;
if (!tunnelPattern.test(destination)) {
  console.error(`Invalid Open Lab destination: ${destination}`);
  process.exit(2);
}

const source = await readFile(entryFile, 'utf8');
const currentPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/workspace\//g;
const matches = source.match(currentPattern) || [];

if (matches.length === 0) {
  console.error(`No Quick Tunnel destination found in ${entryFile}`);
  process.exit(1);
}

const updated = source.replace(currentPattern, destination);
if (updated === source) {
  console.log('Entry destination is already current.');
  process.exit(0);
}

await writeFile(entryFile, updated);
console.log(`Entry destination updated to ${destination}`);
