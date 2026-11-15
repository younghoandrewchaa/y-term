/** The Inbox: agents waiting for the user, oldest-blocked first. Ties keep sidebar order. */
export function inboxQueue<T>(items: readonly T[], blockedAt: (item: T) => number | undefined): T[] {
  return items.filter(item => blockedAt(item) !== undefined).sort((a, b) => blockedAt(a)! - blockedAt(b)!);
}

/** The next or previous queued item, wrapping round. A resolved item steps to the ends of the queue. */
export function inboxStep<T>(queue: readonly T[], current: T | undefined, direction: 1 | -1): T | undefined {
  if (!queue.length) return;
  const index = current === undefined ? -1 : queue.indexOf(current);
  if (index === -1) return direction === 1 ? queue[0] : queue[queue.length - 1];
  return queue[(index + direction + queue.length) % queue.length];
}

/** "2 of 5" for the header, or nothing when the item is not waiting. */
export function inboxPosition<T>(queue: readonly T[], current: T | undefined): { position: number; count: number } | undefined {
  const index = current === undefined ? -1 : queue.indexOf(current);
  return index === -1 ? undefined : { position: index + 1, count: queue.length };
}
