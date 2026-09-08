# Trailhead — plan

A turtle-graphics language with procedures, REPEAT loops, variables, and
arithmetic, interpreted step by step onto a canvas with an animated turtle and
a trail you can export as SVG.

## Goal

Type `REPEAT 36 [ REPEAT 4 [ FD 100 RT 90 ] RT 10 ]`, watch the turtle draw a
spinning square rosette line by line, then hit Export and get a clean SVG of
exactly what was drawn.

## Features

- Tokenizer + recursive-descent parser: `FD BK RT LT PU PD HOME CLEAR SETCOLOR
  SETWIDTH`, `REPEAT n [ ... ]`, `IF cond [ ... ]`, `TO name :args ... END`,
  `MAKE "name value`, plus `STOP`, `SETXY`, `SETHEADING`, `;` comments.
- Expressions: `+ - * /`, parentheses, unary minus, comparisons for `IF`,
  `:variables`, functions `RANDOM SIN COS SQRT REPCOUNT`.
- User procedures with parameters and recursion (depth-limited, clear error)
  for fractal trees, Koch curves, Sierpinski triangles.
- Generator-based interpreter that yields after each turtle-changing command,
  so the UI can animate one step per tick (or hundreds at high speed).
- Turtle sprite rotates and glides between positions; speed slider; Step,
  Run, Stop, Reset.
- Segment list is the single source for canvas redraw and SVG export.
- Syntax/runtime errors underline the offending token in the editor.
- Pan (drag), zoom (wheel / keyboard), fit-to-drawing, gentle follow-cam.
- Example gallery: rosette, spiral, fractal tree, Koch snowflake, Sierpinski.

## Architecture

```
src/lang/           DOM-free core (vitest)
  scanner.ts        source -> Token[] with line/col/offset positions
  parser.ts         Token[] -> Program AST (statements + expression trees)
  interpreter.ts    generator: Program -> Step*  (turtle state, segments, env chain)
  svg.ts            segments -> <svg> with <path> elements grouped by style
  index.ts          run / runToSegments / finalState / toSVG helpers
src/ui/
  editor.ts         lined-paper textarea with error underline overlay
  renderer.ts       canvas view transform, trail drawing, turtle sprite
  runner.ts         rAF animation loop consuming interpreter steps
  examples.ts       gallery programs
src/main.ts         wires everything together
```

## Milestones

1. Plan, license, scaffold (vite vanilla-ts, vitest).
2. Core language: scanner, parser, interpreter, SVG — tests green.
3. Canvas renderer + animated runner with speed control.
4. Editor with error underlines, gallery, pan/zoom/fit, SVG export.
5. Build, smoke test, screenshot, README, publish.
