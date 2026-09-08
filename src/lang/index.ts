import { Interpreter, type InterpreterOptions, type Segment, type StyledSegment, type TurtleState } from './interpreter';
import { parse } from './parser';

export { parse } from './parser';
export { scan } from './scanner';
export { TurtleError, type Span } from './errors';
export { Interpreter, DEFAULT_PALETTE, initialState } from './interpreter';
export type { InterpreterOptions, Segment, StyledSegment, Step, TurtleState } from './interpreter';
export { toSVG, bounds } from './svg';
export type { Program, Stmt, Expr } from './ast';

export interface RunResult {
  segments: StyledSegment[];
  state: TurtleState;
  steps: number;
}

/** Parses and runs a whole program synchronously. Throws TurtleError. */
export function run(source: string, opts?: InterpreterOptions): RunResult {
  const interp = new Interpreter(parse(source), opts);
  for (const _step of interp.run()) {
    /* drain */
  }
  return { segments: interp.segments, state: interp.state, steps: interp.steps };
}

/** The trail geometry only (no colour/width), handy for assertions. */
export function runToSegments(source: string, opts?: InterpreterOptions): Segment[] {
  return run(source, opts).segments.map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 }));
}

/** Where the turtle ends up after running the program. */
export function finalState(source: string, opts?: InterpreterOptions): TurtleState {
  return run(source, opts).state;
}
