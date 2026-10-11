// Every game config and conformance script in the repository can be read by the tools.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERBS = new Set(['wait', 'gone', 'objects', 'shot', 'click', 'key', 'eval', 'seed', 'quit', 'upscaler', 'console']);

for (const file of fs.readdirSync(path.join(root, 'Games')).filter(f => f.endsWith('.json'))) {
  test(`Games/${file} has a title, a repo and an index page that exist`, () => {
    const game = JSON.parse(fs.readFileSync(path.join(root, 'Games', file), 'utf8'));
    for (const key of ['title', 'repo']) assert.equal(typeof game[key], 'string', key);
    const repo = path.resolve(root, game.repo);
    if (!fs.existsSync(repo)) return; // a game kept outside this repository
    assert.ok(fs.existsSync(path.join(repo, game.index ?? 'index.html')), 'index page');
  });
}

for (const file of fs.readdirSync(path.join(root, 'Tests/scripts')).filter(f => f.endsWith('.txt'))) {
  test(`Tests/scripts/${file} uses only known steps, in time order`, () => {
    let last = -Infinity;
    for (const raw of fs.readFileSync(path.join(root, 'Tests/scripts', file), 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const [when, verb] = line.split(/\s+/);
      assert.ok(Number.isFinite(+when), `time in "${line}"`);
      assert.ok(VERBS.has(verb), `step "${verb}" in "${line}"`);
      assert.ok(+when >= last, `time order at "${line}"`);
      last = +when;
    }
  });
}
