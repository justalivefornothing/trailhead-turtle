import type { Span } from './errors';

export type Expr =
  | { kind: 'num'; value: number; span: Span }
  | { kind: 'str'; value: string; span: Span }
  | { kind: 'var'; name: string; span: Span }
  | { kind: 'neg'; operand: Expr; span: Span }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; span: Span }
  | { kind: 'func'; name: string; args: Expr[]; span: Span };

export type Stmt =
  | { kind: 'command'; name: string; args: Expr[]; span: Span }
  | { kind: 'repeat'; count: Expr; body: Stmt[]; span: Span }
  | { kind: 'if'; cond: Expr; body: Stmt[]; span: Span }
  | { kind: 'make'; name: string; value: Expr; span: Span }
  | { kind: 'call'; name: string; args: Expr[]; span: Span }
  | { kind: 'stop'; span: Span };

export interface ProcDef {
  name: string;
  params: string[];
  body: Stmt[];
  span: Span;
}

export interface Program {
  body: Stmt[];
  procs: Map<string, ProcDef>;
}
