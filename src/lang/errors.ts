/** A location in the source: 1-based line/col for messages, offsets for underlining. */
export interface Span {
  line: number;
  col: number;
  start: number;
  end: number;
}

/** Any syntax or runtime error. `message` always ends with "at line:col". */
export class TurtleError extends Error {
  readonly span: Span;
  readonly detail: string;

  constructor(detail: string, span: Span) {
    super(`${detail} at ${span.line}:${span.col}`);
    this.name = 'TurtleError';
    this.detail = detail;
    this.span = span;
  }
}
