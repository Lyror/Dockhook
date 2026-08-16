import { describe, expect, it } from 'vitest';
import { TargetLocks } from './lock.js';

describe('TargetLocks', () => {
  it('grants a free target', () => {
    expect(new TargetLocks().tryAcquire('a')).toBe(true);
  });

  it('refuses a target that is already held', () => {
    const locks = new TargetLocks();
    locks.tryAcquire('a');
    expect(locks.tryAcquire('a')).toBe(false);
  });

  it('allows different targets at the same time', () => {
    const locks = new TargetLocks();
    expect(locks.tryAcquire('a')).toBe(true);
    expect(locks.tryAcquire('b')).toBe(true);
  });

  it('grants the target again after release', () => {
    const locks = new TargetLocks();
    locks.tryAcquire('a');
    locks.release('a');
    expect(locks.tryAcquire('a')).toBe(true);
  });

  it('tolerates releasing a target that was never held', () => {
    expect(() => new TargetLocks().release('a')).not.toThrow();
  });
});
