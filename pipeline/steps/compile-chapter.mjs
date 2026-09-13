#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { compileChapter } from '../lib/compile-chapter.mjs';

const [input, output, ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) {
  console.error('Usage: node pipeline/steps/compile-chapter.mjs input.json output.json');
  process.exitCode = 1;
} else {
  try {
    const recipe = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
    const chapter = compileChapter(recipe);
    await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await fs.writeFile(path.resolve(output), `${JSON.stringify(chapter, null, 2)}\n`);
    console.log(`Compiled ${chapter.scenes.length} reviewed scenes → ${path.resolve(output)}`);
    console.log(`${chapter.version}; static gate checks passed; dynamic resource-state reachability not checked.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
