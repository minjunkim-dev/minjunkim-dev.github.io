import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snippet } from './snippet.ts';

const source = [
  'let a = 1',
  '    // snippet:start outer',
  '    func f() {',
  '        // snippet:start inner',
  '        g()',
  '        // snippet:end inner',
  '    }',
  '    // snippet:end outer',
].join('\n');

test('returns a dedented region without nested markers', () => {
  assert.equal(snippet(source, 'outer'), 'func f() {\n    g()\n}');
  assert.equal(snippet(source, 'inner'), 'g()');
});

test('returns the whole file without markers', () => {
  assert.equal(snippet(source), 'let a = 1\n    func f() {\n        g()\n    }');
});

test('fails the build on a missing region', () => {
  assert.throws(() => snippet(source, 'missing'), /missing/);
});
