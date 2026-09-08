import { describe, expect, it } from 'vitest';
import { Interpreter, TurtleError, finalState, parse, run, runToSegments, scan, toSVG } from './index';

describe('spec', () => {
  it('draws FD/RT segments in screen coordinates (y up is negative)', () => {
    expect(runToSegments('FD 100 RT 90 FD 50')).toEqual([
      { x1: 0, y1: 0, x2: 0, y2: -100 },
      { x1: 0, y1: -100, x2: 50, y2: -100 },
    ]);
  });

  it('REPEAT runs its body n times', () => {
    expect(runToSegments('REPEAT 4 [ FD 10 RT 90 ]')).toHaveLength(4);
  });

  it('procedures with parameters leave the heading normalised', () => {
    expect(finalState('TO sq :n REPEAT 4 [ FD :n RT 90 ] END sq 30').heading).toBe(0);
  });

  it('MAKE variables take part in arithmetic', () => {
    expect(runToSegments('MAKE "k 3 FD :k * 10')[0].y2).toBe(-30);
  });

  it('reports a missing bracket with its position', () => {
    expect(() => run('REPEAT 3 [ FD 10')).toThrow(/Expected "\]" at 1:16/);
  });

  it('exports SVG paths', () => {
    expect(toSVG(runToSegments('FD 10'))).toContain('<path');
  });
});

describe('scanner', () => {
  it('tokenises words, numbers, variables, quoted words and operators with positions', () => {
    const tokens = scan('fd 10\n  make "k :n <= 2.5 ; comment');
    expect(tokens.map((t) => t.type)).toEqual([
      'word', 'number', 'word', 'quoted', 'variable', 'op', 'number', 'eof',
    ]);
    expect(tokens[0].value).toBe('FD');
    expect(tokens[3].span).toEqual({ line: 2, col: 8, start: 13, end: 15 });
    expect(tokens[5].value).toBe('<=');
  });

  it('rejects unknown characters', () => {
    expect(() => scan('FD 10 @')).toThrow(/Unexpected character "@" at 1:7/);
  });
});

describe('parser', () => {
  it('parses commands, blocks and procedures into an AST', () => {
    const p = parse('TO tri :s REPEAT 3 [ FD :s RT 120 ] END tri 40 IF 1 < 2 [ PU ]');
    expect(p.procs.get('TRI')?.params).toEqual(['S']);
    expect(p.body.map((s) => s.kind)).toEqual(['call', 'if']);
  });

  it('allows calling a procedure before it is defined', () => {
    expect(runToSegments('sq 10 TO sq :n REPEAT 4 [ FD :n RT 90 ] END')).toHaveLength(4);
  });

  it('gives clear errors for unknown commands and stray values', () => {
    expect(() => run('FD 10 BLORP 3')).toThrow(/Unknown command "BLORP" at 1:7/);
    expect(() => run('FD 10 20')).toThrow(/Unexpected number 20 at 1:7/);
    expect(() => run('RT')).toThrow(/Expected a value, found end of input at 1:2/);
    expect(() => run('TO fd END')).toThrow(/Cannot redefine built-in "FD"/);
  });
});

describe('expressions', () => {
  it('respects precedence, parentheses and unary minus', () => {
    expect(finalState('RT 2 + 3 * 4').heading).toBe(14);
    expect(finalState('RT (2 + 3) * 4').heading).toBe(20);
    expect(finalState('RT -90').heading).toBe(270);
    expect(finalState('RT 10 - -5').heading).toBe(15);
  });

  it('provides SIN, COS, SQRT, ROUND and RANDOM', () => {
    expect(runToSegments('FD SIN 30 * 100')[0].y2).toBe(-50);
    expect(runToSegments('FD COS 60 * 100')[0].y2).toBe(-50);
    expect(runToSegments('FD SQRT 16')[0].y2).toBe(-4);
    expect(runToSegments('FD ROUND 2.6')[0].y2).toBe(-3);
    expect(runToSegments('FD RANDOM 10', { random: () => 0.55 })[0].y2).toBe(-5);
  });

  it('REPCOUNT counts the innermost loop from 1', () => {
    expect(runToSegments('REPEAT 3 [ FD REPCOUNT ]').map((s) => s.y1 - s.y2)).toEqual([1, 2, 3]);
  });

  it('errors on undefined variables and division by zero', () => {
    expect(() => run('FD :nope')).toThrow(/:NOPE has no value at 1:4/);
    expect(() => run('FD 1 / 0')).toThrow(/Division by zero at 1:6/);
  });
});

describe('interpreter', () => {
  it('supports recursion with STOP as the base case', () => {
    const src = 'TO spiral :n IF :n > 50 [ STOP ] FD :n RT 90 spiral :n + 10 END spiral 10';
    expect(runToSegments(src)).toHaveLength(5);
  });

  it('limits recursion depth with a clear error', () => {
    expect(() => run('TO forever FD 1 forever END forever', { maxDepth: 20 })).toThrow(
      /Recursion too deep: "FOREVER" is nested 20 calls deep/,
    );
  });

  it('scopes parameters per call and lets MAKE update outer variables', () => {
    const src = 'MAKE "total 0 TO add :n MAKE "total :total + :n END add 5 add 7 FD :total';
    expect(runToSegments(src)[0].y2).toBe(-12);
  });

  it('lifts the pen, homes, clears and styles the trail', () => {
    const r = run('SETCOLOR 2 SETWIDTH 5 FD 10 PU FD 10 PD RT 90 FD 10 HOME');
    expect(r.segments).toHaveLength(3);
    expect(r.segments[0]).toMatchObject({ color: '#e8735a', width: 5 });
    expect(r.segments[2]).toMatchObject({ x1: 10, y1: -20, x2: 0, y2: 0 });
    expect(r.state).toMatchObject({ x: 0, y: 0, heading: 0 });
    expect(run('FD 10 CLEAR FD 5').segments).toHaveLength(1);
    expect(run('SETCOLOR "coral FD 1').segments[0].color).toBe('coral');
  });

  it('yields one step per turtle command so a UI can animate them', () => {
    const interp = new Interpreter(parse('FD 10 RT 90 PU'));
    const steps = [...interp.run()].map((s) => s.type);
    expect(steps).toEqual(['move', 'turn', 'style']);
  });

  it('stops runaway programs', () => {
    expect(() => run('REPEAT 1000 [ FD 1 ]', { maxSteps: 100 })).toThrow(TurtleError);
  });
});

describe('svg', () => {
  it('merges connected segments into one path and splits on style changes', () => {
    const svg = toSVG(run('FD 10 RT 90 FD 10 SETCOLOR 1 FD 10 PU FD 5 PD FD 5').segments, { background: null });
    const paths = svg.match(/<path[^>]*>/g) ?? [];
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('d="M0 0 L0 -10 L10 -10"');
    expect(paths[1]).toContain('stroke="#f2c14e"');
    expect(paths[1]).toContain('d="M10 -10 L20 -10 M25 -10 L30 -10"');
    expect(svg).not.toContain('<rect');
  });

  it('sizes the viewBox around the drawing with padding', () => {
    expect(toSVG([{ x1: 0, y1: 0, x2: 100, y2: -50 }], { padding: 10, width: 2 })).toContain(
      'viewBox="-11 -61 122 72"',
    );
  });
});
