import { Interpreter, TurtleError, initialState, parse, type Span, type Step, type StyledSegment, type TurtleState } from '../lang';
import type { Renderer } from './renderer';

export type RunnerStatus = 'idle' | 'ready' | 'running' | 'paused' | 'done' | 'error';

export interface RunnerEvents {
  onStatus(status: RunnerStatus): void;
  onError(error: TurtleError): void;
  /** The statement currently being animated (for editor highlighting). */
  onActive(span: Span | null): void;
}

const MAX_STEPS_PER_FRAME = 4000;
const MAX_FRAME_BUDGET_MS = 12;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

/**
 * Drives the interpreter's generator from requestAnimationFrame. Each step is
 * given a duration derived from the speed; the turtle glides/rotates through
 * the step and the segment being drawn grows with it. At very high speeds many
 * steps are consumed per frame within a time budget.
 */
export class Runner {
  status: RunnerStatus = 'idle';
  speed = 7;
  follow = true;

  private readonly renderer: Renderer;
  private readonly events: RunnerEvents;
  private interp: Interpreter | null = null;
  private gen: Generator<Step, void, undefined> | null = null;
  private current: Step | null = null;
  private progress = 0; // 0..1 through the current step
  private lastTime = 0;
  private frameHandle = 0;
  private restTurtle: TurtleState = initialState();

  constructor(renderer: Renderer, events: RunnerEvents) {
    this.renderer = renderer;
    this.events = events;
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  get segments(): StyledSegment[] {
    return this.interp?.segments ?? [];
  }

  get turtle(): TurtleState {
    return this.interp?.state ?? this.restTurtle;
  }

  get steps(): number {
    return this.interp?.steps ?? 0;
  }

  /** Parse `source` and get ready to run it. Returns false on a syntax error. */
  load(source: string): boolean {
    this.reset();
    try {
      this.interp = new Interpreter(parse(source));
      this.gen = this.interp.run();
      this.setStatus('ready');
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }

  play(): void {
    if (this.status === 'ready' || this.status === 'paused') {
      this.lastTime = 0;
      this.setStatus('running');
    }
  }

  pause(): void {
    if (this.status === 'running') this.setStatus('paused');
  }

  /** Finish the in-flight step (if any) and execute exactly one more, instantly. */
  step(): void {
    if (!this.gen || this.status === 'done' || this.status === 'error') return;
    if (this.current) this.commit();
    else this.advance();
    if (this.current) this.commit();
    if (this.status === 'running') this.setStatus('paused');
  }

  reset(): void {
    this.interp = null;
    this.gen = null;
    this.current = null;
    this.progress = 0;
    this.events.onActive(null);
    this.setStatus('idle');
  }

  destroy(): void {
    cancelAnimationFrame(this.frameHandle);
  }

  private setStatus(status: RunnerStatus): void {
    this.status = status;
    this.events.onStatus(status);
  }

  private fail(e: unknown): void {
    this.current = null;
    this.gen = null;
    this.setStatus('error');
    this.events.onActive(null);
    if (e instanceof TurtleError) this.events.onError(e);
    else throw e;
  }

  /** Pull the next step from the generator. */
  private advance(): void {
    if (!this.gen) return;
    try {
      const r = this.gen.next();
      if (r.done) {
        this.current = null;
        this.gen = null;
        this.events.onActive(null);
        this.setStatus('done');
        return;
      }
      this.current = r.value;
      this.progress = 0;
      this.events.onActive(r.value.span);
    } catch (e) {
      this.fail(e);
    }
  }

  private commit(): void {
    this.current = null;
    this.progress = 0;
    this.advance();
  }

  /** Milliseconds a step takes at the current speed; 0 means "as fast as possible". */
  private stepDuration(step: Step): number {
    if (this.speed >= 10) return 0;
    const base = 900 * 0.56 ** (this.speed - 1);
    if (step.type === 'move') {
      const len = Math.hypot(step.to.x - step.from.x, step.to.y - step.from.y);
      return base * Math.min(1.6, Math.max(0.35, len / 60));
    }
    if (step.type === 'turn') return base * 0.5;
    return 0;
  }

  private frame(time: number): void {
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
    if (this.status === 'running') this.tick(time);
    this.render();
  }

  private tick(time: number): void {
    const dt = this.lastTime ? Math.min(time - this.lastTime, 100) : 16;
    this.lastTime = time;
    const started = performance.now();
    let budget = dt;

    for (let n = 0; n < MAX_STEPS_PER_FRAME && this.status === 'running'; n++) {
      if (!this.current) {
        this.advance();
        if (!this.current) break;
      }
      const duration = this.stepDuration(this.current);
      if (duration === 0) {
        this.commit();
        if (performance.now() - started > MAX_FRAME_BUDGET_MS) break;
        continue;
      }
      const remaining = (1 - this.progress) * duration;
      if (budget < remaining) {
        this.progress += budget / duration;
        break;
      }
      budget -= remaining;
      this.commit();
    }
  }

  private render(): void {
    const r = this.renderer;
    const interp = this.interp;
    if (!interp) {
      r.draw([], 0, null, this.restTurtle);
      return;
    }

    const cur = this.current;
    let partial: StyledSegment | null = null;
    let turtle = interp.state;
    let committed = interp.segments.length;

    if (cur && (cur.type === 'move' || cur.type === 'turn')) {
      const t = easeInOut(Math.min(1, this.progress));
      const heading = lerpAngle(cur.from.heading, cur.to.heading, t);
      if (cur.type === 'move') {
        const x = cur.from.x + (cur.to.x - cur.from.x) * t;
        const y = cur.from.y + (cur.to.y - cur.from.y) * t;
        turtle = { ...cur.to, x, y, heading };
        if (cur.segment) {
          committed -= 1; // the interpreter already recorded it; draw it growing instead
          if (t > 0) partial = { ...cur.segment, x2: x, y2: y };
        }
      } else {
        turtle = { ...cur.to, heading };
      }
    }

    if (this.follow && this.status === 'running') r.follow(turtle.x, turtle.y);
    r.draw(interp.segments, committed, partial, turtle);
  }
}
