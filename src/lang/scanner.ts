import { TurtleError, type Span } from './errors';

export type TokenType =
  | 'number'
  | 'word' // FD, REPEAT, tree ... (upper-cased)
  | 'variable' // :size  (name upper-cased, without the colon)
  | 'quoted' // "k  or  "coral  (raw text, without the quote)
  | 'op' // + - * / < > = <= >= <>
  | '['
  | ']'
  | '('
  | ')'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  span: Span;
}

const isDigit = (c: string) => c >= '0' && c <= '9';
const isWordStart = (c: string) => /[A-Za-z_]/.test(c);
const isWordChar = (c: string) => /[A-Za-z0-9_.?]/.test(c);

/**
 * Turns source text into tokens with positions. Words and variables are
 * case-insensitive, so they are normalised to upper case here; quoted words
 * keep their spelling because they may be CSS colour names or hex codes.
 * Comments run from `;` to the end of the line.
 */
export function scan(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;

  const push = (type: TokenType, start: number, value: string) => {
    tokens.push({ type, value, span: { line, col: start - lineStart + 1, start, end: i } });
  };

  while (i < source.length) {
    const c = source[i];

    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === ';') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    const start = i;

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      while (i < source.length && isDigit(source[i])) i++;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++;
        while (i < source.length && isDigit(source[i])) i++;
      }
      push('number', start, source.slice(start, i));
      continue;
    }

    if (isWordStart(c)) {
      while (i < source.length && isWordChar(source[i])) i++;
      push('word', start, source.slice(start, i).toUpperCase());
      continue;
    }

    if (c === ':' || c === '"') {
      i++;
      while (i < source.length && (isWordChar(source[i]) || source[i] === '#')) i++;
      const text = source.slice(start + 1, i);
      if (text.length === 0) {
        throw new TurtleError(`Expected a name after "${c}"`, {
          line,
          col: start - lineStart + 1,
          start,
          end: i,
        });
      }
      if (c === ':') push('variable', start, text.toUpperCase());
      else push('quoted', start, text);
      continue;
    }

    if (c === '[' || c === ']' || c === '(' || c === ')') {
      i++;
      push(c, start, c);
      continue;
    }

    if ('+-*/=<>'.includes(c)) {
      i++;
      // two-character comparison operators
      if ((c === '<' || c === '>') && (source[i] === '=' || (c === '<' && source[i] === '>'))) i++;
      push('op', start, source.slice(start, i));
      continue;
    }

    i++;
    throw new TurtleError(`Unexpected character "${c}"`, {
      line,
      col: start - lineStart + 1,
      start,
      end: i,
    });
  }

  // The end-of-input token sits on the last character of the last real token,
  // so an "expected ]" error underlines something visible in the editor.
  const last = tokens[tokens.length - 1];
  const eofSpan: Span = last
    ? {
        line: last.span.line,
        col: last.span.col + (last.span.end - last.span.start) - 1,
        start: Math.max(0, last.span.end - 1),
        end: last.span.end,
      }
    : { line: 1, col: 1, start: 0, end: 0 };
  tokens.push({ type: 'eof', value: '', span: eofSpan });
  return tokens;
}
