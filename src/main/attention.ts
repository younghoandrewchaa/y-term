/** Count tabs waiting for the user across all windows for the Dock badge. */
export class AttentionBadge {
  private counts = new Map<number, number>();
  private publish: (text: string) => void;

  constructor(publish: (text: string) => void) { this.publish = publish; }

  set(owner: number, count: unknown): void {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 32) return;
    if (count) this.counts.set(owner, count);
    else if (!this.counts.delete(owner)) return;
    const total = [...this.counts.values()].reduce((sum, value) => sum + value, 0);
    this.publish(total ? String(total) : '');
  }

  clear(owner: number): void { this.set(owner, 0); }
}
