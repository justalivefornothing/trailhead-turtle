import type { Expr, ProcDef, Program, Stmt } from './ast';
import { TurtleError } from './errors';
import { scan, type Token } from './scanner';

/** Built-in commands: alias -> [canonical name, number of arguments]. */
export const COMMANDS: Record<string, [string, number]> = {
  FD: ['FD', 1], FORWARD: ['FD', 1],
  BK: ['BK', 1], BACK: ['BK', 1],
  RT: ['RT', 1], RIGHT: ['RT', 1],
  LT: ['LT', 1], LEFT: ['LT', 1],
  PU: ['PU', 0], PENUP: ['PU', 0],
  PD: ['PD', 0], PENDOWN: ['PD', 0],
  HOME: ['HOME', 0],
  CLEAR: ['CLEAR', 0], CS: ['CLEAR', 0], CLEARSCREEN: ['CLEAR', 0],
  SETCOLOR: ['SETCOLOR', 1], SETPC: ['SETCOLOR', 1],
  SETWIDTH: ['SETWIDTH', 1], SETPENSIZE: ['SETWIDTH', 1],
  SETXY: ['SETXY', 2],
  SETHEADING: ['SETHEADING', 1], SETH: ['SETHEADING', 1],
  HT: ['HT', 0], HIDETURTLE: ['HT', 0],
  ST: ['ST', 0], SHOWTURTLE: ['ST', 0],
};

/** Built-in functions usable inside expressions: name -> arity. */
export const FUNCTIONS: Record<string, number> = {
  RANDOM: 1, SIN: 1, COS: 1, SQRT: 1, ROUND: 1, REPCOUNT: 0,
};

const KEYWORDS = new Set(['TO', 'END', 'REPEAT', 'IF', 'MAKE', 'STOP']);

function describe(t: Token): string {
  switch (t.type) {
    case 'eof': return 'end of input';
    case 'number': return `number ${t.value}`;
    case 'variable': return `:${t.value}`;
    case 'quoted': return `"${t.value}`;
    default: return `"${t.value}"`;
  }
}

/**
 * Recursive-descent parser. Procedure signatures are collected in a pre-pass
 * so calls may appear before their `TO ... END` definition (and procedures can
 * call each other), which is what makes the arity of a call site knowable.
 */
class Parser {
  private pos = 0;
  private readonly procs = new Map<string, ProcDef>();
  private readonly procArity = new Map<string, number>();
  private inProc = false;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === 'word' && t.value === 'TO' && tokens[i + 1]?.type === 'word') {
        let arity = 0;
        for (let j = i + 2; tokens[j]?.type === 'variable'; j++) arity++;
        this.procArity.set(tokens[i + 1].value, arity);
      }
    }
  }

  parseProgram(): Program {
    const body: Stmt[] = [];
    while (this.peek().type !== 'eof') {
      const t = this.peek();
      if (t.type === 'word' && t.value === 'TO') this.parseProcedure();
      else body.push(this.parseStatement());
    }
    return { body, procs: this.procs };
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private next(): Token {
    return this.tokens[this.pos++];
  }

  private fail(detail: string, t: Token = this.peek()): never {
    throw new TurtleError(detail, t.span);
  }

  private expect(type: Token['type'], what: string): Token {
    if (this.peek().type !== type) this.fail(`Expected ${what}`);
    return this.next();
  }

  private parseProcedure(): void {
    const to = this.next();
    if (this.inProc) this.fail('TO cannot be nested inside another procedure', to);
    const nameTok = this.peek();
    if (nameTok.type !== 'word') this.fail('Expected a procedure name after TO');
    if (nameTok.value in COMMANDS || nameTok.value in FUNCTIONS || KEYWORDS.has(nameTok.value)) {
      this.fail(`Cannot redefine built-in "${nameTok.value}"`);
    }
    if (this.procs.has(nameTok.value)) this.fail(`Procedure "${nameTok.value}" is already defined`);
    this.next();

    const params: string[] = [];
    while (this.peek().type === 'variable') params.push(this.next().value);

    this.inProc = true;
    const body: Stmt[] = [];
    for (;;) {
      const t = this.peek();
      if (t.type === 'eof') this.fail(`Expected END to close procedure "${nameTok.value}"`);
      if (t.type === 'word' && t.value === 'END') break;
      if (t.type === 'word' && t.value === 'TO') this.fail('TO cannot be nested inside another procedure');
      body.push(this.parseStatement());
    }
    this.next(); // END
    this.inProc = false;
    this.procs.set(nameTok.value, { name: nameTok.value, params, body, span: nameTok.span });
  }

  private parseBlock(): Stmt[] {
    this.expect('[', '"["');
    const body: Stmt[] = [];
    while (this.peek().type !== ']') {
      if (this.peek().type === 'eof') this.fail('Expected "]"');
      body.push(this.parseStatement());
    }
    this.next();
    return body;
  }

  private parseStatement(): Stmt {
    const t = this.next();
    if (t.type !== 'word') this.fail(`Unexpected ${describe(t)}`, t);

    switch (t.value) {
      case 'REPEAT': {
        const count = this.parseExpr();
        return { kind: 'repeat', count, body: this.parseBlock(), span: t.span };
      }
      case 'IF': {
        const cond = this.parseExpr();
        return { kind: 'if', cond, body: this.parseBlock(), span: t.span };
      }
      case 'MAKE': {
        const name = this.expect('quoted', 'a quoted name like "size after MAKE');
        return { kind: 'make', name: name.value.toUpperCase(), value: this.parseExpr(), span: t.span };
      }
      case 'STOP':
        return { kind: 'stop', span: t.span };
      case 'END':
        return this.fail('Unexpected END outside of a procedure', t);
      case 'TO':
        return this.fail('TO cannot be nested inside another procedure', t);
    }

    const builtin = COMMANDS[t.value];
    if (builtin) {
      return { kind: 'command', name: builtin[0], args: this.parseArgs(builtin[1]), span: t.span };
    }
    const arity = this.procArity.get(t.value);
    if (arity !== undefined) {
      return { kind: 'call', name: t.value, args: this.parseArgs(arity), span: t.span };
    }
    if (t.value in FUNCTIONS) this.fail(`${t.value} produces a value; use it inside an expression`, t);
    return this.fail(`Unknown command "${t.value}"`, t);
  }

  private parseArgs(n: number): Expr[] {
    const args: Expr[] = [];
    for (let i = 0; i < n; i++) args.push(this.parseExpr());
    return args;
  }

  // ---- expressions: comparison < additive < term < unary < primary ----

  private parseExpr(): Expr {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t.type === 'op' && ['<', '>', '=', '<=', '>=', '<>'].includes(t.value)) {
      this.next();
      return { kind: 'binary', op: t.value, left, right: this.parseAdditive(), span: t.span };
    }
    return left;
  }

  private parseAdditive(): Expr {
    let left = this.parseTerm();
    while (this.peek().type === 'op' && (this.peek().value === '+' || (this.peek().value === '-' && !this.peek().unary))) {
      const op = this.next();
      left = { kind: 'binary', op: op.value, left, right: this.parseTerm(), span: op.span };
    }
    return left;
  }

  private parseTerm(): Expr {
    let left = this.parseUnary();
    while (this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next();
      left = { kind: 'binary', op: op.value, left, right: this.parseUnary(), span: op.span };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.type === 'op' && t.value === '-') {
      this.next();
      return { kind: 'neg', operand: this.parseUnary(), span: t.span };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'number':
        return { kind: 'num', value: parseFloat(t.value), span: t.span };
      case 'quoted':
        return { kind: 'str', value: t.value, span: t.span };
      case 'variable':
        return { kind: 'var', name: t.value, span: t.span };
      case '(': {
        const inner = this.parseExpr();
        this.expect(')', '")"');
        return inner;
      }
      case 'word': {
        const arity = FUNCTIONS[t.value];
        if (arity !== undefined) {
          // Functions bind tightly, like unary operators: SIN :a * 2 is (SIN :a) * 2.
          const args: Expr[] = [];
          for (let i = 0; i < arity; i++) args.push(this.parseUnary());
          return { kind: 'func', name: t.value, args, span: t.span };
        }
        return this.fail(`Expected a value, found ${describe(t)}`, t);
      }
      default:
        return this.fail(`Expected a value, found ${describe(t)}`, t);
    }
  }
}

export function parse(source: string): Program {
  return new Parser(scan(source)).parseProgram();
}
