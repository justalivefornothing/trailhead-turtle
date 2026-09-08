import type { Expr, Program, Stmt } from './ast';
import { TurtleError, type Span } from './errors';

export interface TurtleState {
  x: number;
  y: number;
  /** Degrees, 0 = up, clockwise, always in [0, 360). */
  heading: number;
  pen: boolean;
  color: string;
  width: number;
  visible: boolean;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface StyledSegment extends Segment {
  color: string;
  width: number;
}

/** What the generator yields after each turtle-changing command. */
export type Step =
  | { type: 'move'; from: TurtleState; to: TurtleState; segment: StyledSegment | null; span: Span }
  | { type: 'turn'; from: TurtleState; to: TurtleState; span: Span }
  | { type: 'clear'; span: Span }
  | { type: 'style'; span: Span };

export interface InterpreterOptions {
  /** Maximum nesting of procedure calls before a clear error. */
  maxDepth?: number;
  /** Maximum number of steps before giving up (guards against runaway loops). */
  maxSteps?: number;
  /** Source of randomness in [0, 1); injectable for deterministic tests. */
  random?: () => number;
  /** Colours addressed by SETCOLOR 0..15. */
  palette?: string[];
}

export const DEFAULT_PALETTE = [
  '#f3e9d2', '#f2c14e', '#e8735a', '#7fb7d9', '#8fd6a8', '#c3a6e1', '#f0a6c0', '#f29e4c',
  '#b8d96b', '#6fd3c7', '#f6c9a0', '#d9b64a', '#b07a4c', '#9fb0b7', '#ffffff', '#1a2a24',
];

export function initialState(color = DEFAULT_PALETTE[0]): TurtleState {
  return { x: 0, y: 0, heading: 0, pen: true, color, width: 2, visible: true };
}

type Value = number | string;

/** Scoped variables. Procedure frames chain to their caller (dynamic scope, like Logo). */
class Env {
  private readonly vars = new Map<string, Value>();
  private readonly parent: Env | undefined;

  constructor(parent?: Env) {
    this.parent = parent;
  }

  lookup(name: string): Value | undefined {
    return this.vars.has(name) ? this.vars.get(name) : this.parent?.lookup(name);
  }

  define(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  /** Assign to the nearest frame that has the name, else create a global. */
  assign(name: string, value: Value): void {
    let env: Env | undefined = this;
    while (env) {
      if (env.vars.has(name) || !env.parent) {
        env.vars.set(name, value);
        return;
      }
      env = env.parent;
    }
  }
}

class StopSignal {}

const snap = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // "+ 0" turns -0 into 0
const normalize = (deg: number) => snap(((deg % 360) + 360) % 360);

/** Unit direction for a heading, exact on the four compass points. */
function direction(heading: number): [number, number] {
  switch (heading) {
    case 0: return [0, -1];
    case 90: return [1, 0];
    case 180: return [0, 1];
    case 270: return [-1, 0];
  }
  const r = (heading * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

/**
 * Executes a program as a generator. The segment list is the single source
 * of truth for both the canvas and the SVG export; `state` is the live turtle.
 */
export class Interpreter {
  readonly segments: StyledSegment[] = [];
  state: TurtleState;
  steps = 0;

  private readonly maxDepth: number;
  private readonly maxSteps: number;
  private readonly random: () => number;
  private readonly palette: string[];
  private readonly repCounts: number[] = [];
  private readonly program: Program;

  constructor(program: Program, opts: InterpreterOptions = {}) {
    this.program = program;
    this.maxDepth = opts.maxDepth ?? 400;
    this.maxSteps = opts.maxSteps ?? 200_000;
    this.random = opts.random ?? Math.random;
    this.palette = opts.palette ?? DEFAULT_PALETTE;
    this.state = initialState(this.palette[0]);
  }

  *run(): Generator<Step, void, undefined> {
    try {
      yield* this.execBlock(this.program.body, new Env(), 0);
    } catch (e) {
      if (!(e instanceof StopSignal)) throw e; // top-level STOP just ends the program
    }
  }

  private *execBlock(stmts: Stmt[], env: Env, depth: number): Generator<Step, void, undefined> {
    for (const stmt of stmts) yield* this.exec(stmt, env, depth);
  }

  private *exec(stmt: Stmt, env: Env, depth: number): Generator<Step, void, undefined> {
    switch (stmt.kind) {
      case 'command':
        yield* this.command(stmt.name, stmt.args.map((a) => this.evaluate(a, env)), stmt.args, stmt.span);
        return;

      case 'repeat': {
        const n = Math.floor(this.number(stmt.count, env));
        if (n < 0) throw new TurtleError(`REPEAT count must not be negative (got ${n})`, stmt.count.span);
        this.repCounts.push(0);
        try {
          for (let i = 1; i <= n; i++) {
            this.repCounts[this.repCounts.length - 1] = i;
            yield* this.execBlock(stmt.body, env, depth);
          }
        } finally {
          this.repCounts.pop();
        }
        return;
      }

      case 'if':
        if (this.number(stmt.cond, env) !== 0) yield* this.execBlock(stmt.body, env, depth);
        return;

      case 'make':
        env.assign(stmt.name, this.evaluate(stmt.value, env));
        return;

      case 'stop':
        throw new StopSignal();

      case 'call': {
        const proc = this.program.procs.get(stmt.name);
        if (!proc) throw new TurtleError(`Unknown procedure "${stmt.name}"`, stmt.span);
        if (depth + 1 > this.maxDepth) {
          throw new TurtleError(
            `Recursion too deep: "${stmt.name}" is nested ${this.maxDepth} calls deep. Does it have a base case (IF ... [ STOP ])?`,
            stmt.span,
          );
        }
        const frame = new Env(env);
        proc.params.forEach((p, i) => frame.define(p, this.evaluate(stmt.args[i], env)));
        try {
          yield* this.execBlock(proc.body, frame, depth + 1);
        } catch (e) {
          if (!(e instanceof StopSignal)) throw e;
        }
        return;
      }
    }
  }

  private *command(name: string, args: Value[], exprs: Expr[], span: Span): Generator<Step, void, undefined> {
    const s = this.state;
    const num = (i: number) => this.asNumber(args[i], exprs[i].span);
    this.countStep(span);

    switch (name) {
      case 'FD':
      case 'BK': {
        const d = num(0) * (name === 'BK' ? -1 : 1);
        const [dx, dy] = direction(s.heading);
        yield this.moveTo(snap(s.x + dx * d), snap(s.y + dy * d), s.heading, span);
        return;
      }
      case 'RT':
      case 'LT':
        yield this.turnTo(s.heading + num(0) * (name === 'LT' ? -1 : 1), span);
        return;
      case 'SETHEADING':
        yield this.turnTo(num(0), span);
        return;
      case 'SETXY':
        yield this.moveTo(snap(num(0)), snap(num(1)), s.heading, span);
        return;
      case 'HOME':
        yield this.moveTo(0, 0, 0, span);
        return;
      case 'PU':
      case 'PD':
        this.state = { ...s, pen: name === 'PD' };
        yield { type: 'style', span };
        return;
      case 'HT':
      case 'ST':
        this.state = { ...s, visible: name === 'ST' };
        yield { type: 'style', span };
        return;
      case 'SETWIDTH': {
        const w = num(0);
        if (w <= 0) throw new TurtleError(`SETWIDTH needs a positive width (got ${w})`, exprs[0].span);
        this.state = { ...s, width: w };
        yield { type: 'style', span };
        return;
      }
      case 'SETCOLOR': {
        const v = args[0];
        const color =
          typeof v === 'number'
            ? this.palette[((Math.floor(v) % this.palette.length) + this.palette.length) % this.palette.length]
            : v;
        this.state = { ...s, color };
        yield { type: 'style', span };
        return;
      }
      case 'CLEAR':
        this.segments.length = 0;
        yield { type: 'clear', span };
        return;
    }
    throw new TurtleError(`Unknown command "${name}"`, span);
  }

  private moveTo(x: number, y: number, heading: number, span: Span): Step {
    const from = this.state;
    const to = { ...from, x, y, heading: normalize(heading) };
    let segment: StyledSegment | null = null;
    if (from.pen) {
      segment = { x1: from.x, y1: from.y, x2: x, y2: y, color: from.color, width: from.width };
      this.segments.push(segment);
    }
    this.state = to;
    return { type: 'move', from, to, segment, span };
  }

  private turnTo(heading: number, span: Span): Step {
    const from = this.state;
    this.state = { ...from, heading: normalize(heading) };
    return { type: 'turn', from, to: this.state, span };
  }

  private countStep(span: Span): void {
    if (++this.steps > this.maxSteps) {
      throw new TurtleError(`Stopped after ${this.maxSteps} steps; is a loop running away?`, span);
    }
  }

  // ---- expressions ----

  private number(expr: Expr, env: Env): number {
    return this.asNumber(this.evaluate(expr, env), expr.span);
  }

  private asNumber(v: Value, span: Span): number {
    if (typeof v !== 'number') throw new TurtleError(`Expected a number but got "${v}"`, span);
    if (!Number.isFinite(v)) throw new TurtleError('Result is not a finite number', span);
    return v;
  }

  private evaluate(expr: Expr, env: Env): Value {
    switch (expr.kind) {
      case 'num':
      case 'str':
        return expr.value;
      case 'var': {
        const v = env.lookup(expr.name);
        if (v === undefined) throw new TurtleError(`:${expr.name} has no value`, expr.span);
        return v;
      }
      case 'neg':
        return -this.number(expr.operand, env);
      case 'binary': {
        const a = this.number(expr.left, env);
        const b = this.number(expr.right, env);
        switch (expr.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) throw new TurtleError('Division by zero', expr.span);
            return a / b;
          case '<': return a < b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '=': return a === b ? 1 : 0;
          case '<>': return a !== b ? 1 : 0;
        }
        throw new TurtleError(`Unknown operator "${expr.op}"`, expr.span);
      }
      case 'func': {
        const arg = () => this.number(expr.args[0], env);
        switch (expr.name) {
          case 'RANDOM': return Math.floor(this.random() * Math.max(0, Math.floor(arg())));
          case 'SIN': return snap(Math.sin((arg() * Math.PI) / 180));
          case 'COS': return snap(Math.cos((arg() * Math.PI) / 180));
          case 'SQRT': {
            const v = arg();
            if (v < 0) throw new TurtleError(`SQRT of a negative number (${v})`, expr.span);
            return Math.sqrt(v);
          }
          case 'ROUND': return Math.round(arg());
          case 'REPCOUNT': return this.repCounts[this.repCounts.length - 1] ?? 0;
        }
        throw new TurtleError(`Unknown function "${expr.name}"`, expr.span);
      }
    }
  }
}
