import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationText, parseOsc777, parseOsc9 } from '../src/shared/attention.ts';
import { AttentionBadge } from '../src/main/attention.ts';

test('recognises iTerm2 and rxvt notifications but not ConEmu subcommands', () => {
  assert.deepEqual(parseOsc9('Claude needs your permission to use Bash'), { body: 'Claude needs your permission to use Bash' });
  assert.deepEqual(parseOsc9(''), { body: '' });
  for (const data of ['4;1;50', '4', '9;C:\\path']) assert.equal(parseOsc9(data), undefined);
  assert.deepEqual(parseOsc777('notify;Codex;Approve command; ls -la'), { title: 'Codex', body: 'Approve command; ls -la' });
  assert.equal(parseOsc777('precmd'), undefined);
});

test('keeps notification text short and printable', () => {
  assert.equal(notificationText('  waiting\x1b[31m\nfor\tinput ', 'fallback'), 'waiting [31m for input');
  assert.equal(notificationText('\x07\x00', 'fallback'), 'fallback');
  assert.equal(notificationText(42, 'fallback'), 'fallback');
  assert.equal(notificationText('x'.repeat(500), 'fallback').length, 200);
});

test('sums waiting tabs across windows for the Dock badge', () => {
  const badges: string[] = [];
  const badge = new AttentionBadge(text => badges.push(text));
  badge.set(1, 2);
  badge.set(2, 1);
  badge.set(1, -1);
  badge.set(1, 1.5);
  badge.set(1, '3');
  badge.set(1, 33);
  badge.clear(1);
  badge.clear(1);
  badge.set(2, 0);
  assert.deepEqual(badges, ['2', '3', '1', '']);
});
