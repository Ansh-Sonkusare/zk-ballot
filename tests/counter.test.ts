import { describe, it, expect } from 'vitest';
import { CounterSimulator } from './counter-simulator.js';

describe('Counter contract', () => {
  it('initializes the ledger deterministically to zeros', () => {
    const sim0 = new CounterSimulator();
    const sim1 = new CounterSimulator();
    expect(sim0.getLedger()).toEqual(sim1.getLedger());
    expect(sim0.getLedger().total).toBe(0n);
    expect(sim0.getLedger().lastNote).toBe('');
  });

  it('readTotal returns the public total without changing state', () => {
    const sim = new CounterSimulator();
    expect(sim.readTotal()).toBe(0n);
    expect(sim.getLedger().total).toBe(0n);
  });

  it('increment transitions the ledger by the secret delta', () => {
    const sim = new CounterSimulator();
    const ledger1 = sim.increment(3n, 'first');
    expect(ledger1.total).toBe(3n);
    expect(ledger1.lastNote).toBe('first');

    const ledger2 = sim.increment(7n, 'second');
    expect(ledger2.total).toBe(10n);
    expect(ledger2.lastNote).toBe('second');
  });

  it('enforces the lower bound of the range check (circuit logic)', () => {
    const sim = new CounterSimulator();
    expect(() => sim.increment(0n, 'zero')).toThrow();
    expect(sim.getLedger().total).toBe(0n);
  });

  it('enforces the upper bound of the range check (circuit logic)', () => {
    const sim = new CounterSimulator();
    expect(() => sim.increment(11n, 'too large')).toThrow();
    expect(sim.getLedger().total).toBe(0n);
  });

  it('never exposes the private delta in public or private state', () => {
    const sim = new CounterSimulator();
    sim.increment(5n, 'hello');

    const publicState = sim.getLedger();
    // Public ledger only contains the deliberately disclosed values.
    expect(Object.keys(publicState).sort()).toEqual(['lastNote', 'total']);
    expect(publicState.total).toBe(5n);
    expect(publicState.lastNote).toBe('hello');

    // The private witness (secretDelta = 5) is not retained anywhere.
    const privateState = sim.getPrivateState();
    expect(privateState).toEqual({});
    expect(Object.values(privateState)).not.toContain(5n);
  });
});
