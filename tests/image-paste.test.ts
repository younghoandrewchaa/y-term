import test from 'node:test';
import assert from 'node:assert/strict';
import { attachTerminalImagePaste } from '../src/renderer/image-paste.ts';

test('image pastes send one raw clipboard shortcut instead of pasted text', () => {
  const host = new EventTarget();
  const input: string[] = [];
  let available = true;
  const cleanup = attachTerminalImagePaste(host as HTMLElement, {
    canPaste: () => available,
    input: data => input.push(data),
  });
  const paste = (items: { kind: string; type: string }[]) => {
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items } });
    host.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(paste([{ kind: 'file', type: 'image/png' }]), true);
  assert.equal(paste([{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/jpeg' }]), true);
  assert.deepEqual(input, ['\x16', '\x16']);
  assert.equal(paste([{ kind: 'string', type: 'text/plain' }]), false);
  assert.equal(paste([{ kind: 'file', type: 'application/pdf' }]), false);
  assert.equal(paste([]), false);
  available = false;
  assert.equal(paste([{ kind: 'file', type: 'image/png' }]), true);
  assert.deepEqual(input, ['\x16', '\x16']);
  cleanup();
  available = true;
  assert.equal(paste([{ kind: 'file', type: 'image/png' }]), false);
  assert.deepEqual(input, ['\x16', '\x16']);
});
