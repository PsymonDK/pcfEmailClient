import { describe, it, expect } from 'vitest';
import { createSerialQueue } from '../serialQueue';

const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, resolve: () => release() };
};

describe('createSerialQueue', () => {
  it('starts a task only after the one ahead of it has finished', async () => {
    const run = createSerialQueue();
    const log: string[] = [];
    const gate = deferred();

    const first = run(async () => { log.push('first:start'); await gate.promise; log.push('first:end'); });
    const second = run(() => { log.push('second:start'); return Promise.resolve(); });

    await Promise.resolve();
    expect(log).toEqual(['first:start']);

    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('gives each caller its own result', async () => {
    const run = createSerialQueue();
    const [a, b] = await Promise.all([run(() => Promise.resolve(1)), run(() => Promise.resolve('two'))]);
    expect(a).toBe(1);
    expect(b).toBe('two');
  });

  it('keeps going after a task rejects, and rejects only that caller', async () => {
    const run = createSerialQueue();
    const failed = run(() => Promise.reject(new Error('boom')));
    const next = run(() => Promise.resolve('still runs'));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('still runs');
  });
});
