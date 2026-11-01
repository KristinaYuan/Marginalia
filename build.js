#!/usr/bin/env node
/**
 * build.js — assemble the single installable userscript from the modular source.
 *
 * Reads src/*.js in sorted (alphabetical) order and concatenates them verbatim
 * into `marginalia.user.js`. Zero dependencies, no bundler.
 *
 * The Userscript metadata header lives in src/00-meta.js, which sorts first, so
 * the generated file starts with `// ==UserScript==` exactly as Tampermonkey
 * (and compatible managers) require.
 *
 * Usage:  node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'marginalia.user.js');

const files = fs.readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.js'))
  .sort();

let out = '';
for (const f of files) {
  const content = fs.readFileSync(path.join(SRC_DIR, f), 'utf8');
  out += content.replace(/\s*$/, '\n') + '\n';
}

if (!out.trimStart().startsWith('// ==UserScript==')) {
  console.error('ERROR: merged output does not start with the Userscript metadata header.');
  process.exit(1);
}

fs.writeFileSync(OUT, out);
console.log(`Built ${path.basename(OUT)} from ${files.length} modules:`);
for (const f of files) console.log(`  - ${f}`);
