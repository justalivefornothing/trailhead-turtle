import { describe, expect, it } from 'vitest';
import { bounds, run } from '../lang';
import { EXAMPLES } from './examples';

describe('example gallery', () => {
  it.each(EXAMPLES.map((e) => [e.name, e.source]))('%s runs and draws something', (_name, source) => {
    const result = run(source);
    expect(result.segments.length).toBeGreaterThan(3);
    const b = bounds(result.segments)!;
    // every example should be roughly centred on the origin
    expect(Math.abs(b.minX + b.maxX) / 2).toBeLessThan(120);
    expect(Math.abs(b.minY + b.maxY) / 2).toBeLessThan(120);
  });

  it('has the five required examples', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['rosette', 'spiral', 'tree', 'koch', 'sierpinski']);
  });
});
