export class TargetLocks {
  private readonly held = new Set<string>();

  tryAcquire(target: string): boolean {
    if (this.held.has(target)) return false;
    this.held.add(target);
    return true;
  }

  release(target: string): void {
    this.held.delete(target);
  }
}
