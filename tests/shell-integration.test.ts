import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCommandLine, parseOsc133 } from '../src/shared/shell-integration.ts';

test('parses OSC 133 marks', () => {
  assert.deepEqual(parseOsc133('A'), { kind: 'prompt' });
  assert.deepEqual(parseOsc133('B'), { kind: 'input' });
  assert.deepEqual(parseOsc133('C'), { kind: 'output' });
  assert.deepEqual(parseOsc133('D;1'), { kind: 'finished', exitCode: 1 });
  assert.deepEqual(parseOsc133('D'), { kind: 'finished' });
  for (const bad of ['', 'Z', 'D;x', 'D;-1', 'D;1234', 'D;' + '9'.repeat(400), 'A;extra=1;'.repeat(1000)]) assert.equal(parseOsc133(bad), undefined);
});

test('unescapes command lines and requires the session nonce', () => {
  assert.equal(parseCommandLine('E;git branch;n', 'n'), 'git branch');
  assert.equal(parseCommandLine(String.raw`E;a\x3bb\\c\x0ad 你好;n`, 'n'), 'a;b\\c\nd 你好');
  assert.equal(parseCommandLine('E;git branch;wrong', 'n'), undefined);
  assert.equal(parseCommandLine('E;git branch', 'n'), undefined);
  assert.equal(parseCommandLine('E;git branch;n', undefined), undefined);
  assert.equal(parseCommandLine('P;Cwd=/;n', 'n'), undefined);
});
