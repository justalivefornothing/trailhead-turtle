export interface Example {
  id: string;
  name: string;
  blurb: string;
  source: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'rosette',
    name: 'Rosette',
    blurb: 'Thirty-six squares, each turned ten degrees.',
    source: `; Spinning square rosette
; Each square starts 10 degrees on from the last.
SETWIDTH 1.5
REPEAT 36 [
  REPEAT 4 [ FD 100 RT 90 ]
  RT 10
]
`,
  },
  {
    id: 'spiral',
    name: 'Spiral',
    blurb: 'A MAKE variable grows the step each turn.',
    source: `; Square spiral that slowly opens up.
; REPCOUNT is the current loop iteration,
; so the colour changes every ten steps.
MAKE "step 4
REPEAT 110 [
  SETCOLOR 1 + REPCOUNT / 10
  FD :step
  RT 91
  MAKE "step :step + 2.2
]
`,
  },
  {
    id: 'tree',
    name: 'Fractal tree',
    blurb: 'Recursion: every branch grows two smaller ones.',
    source: `; Fractal tree: each branch grows two
; smaller branches until they get too short.
TO tree :size
  IF :size < 5 [ STOP ]
  SETWIDTH :size / 12
  SETCOLOR 12
  IF :size < 14 [ SETCOLOR 4 ]
  FD :size
  LT 22
  tree :size * 0.74
  RT 47
  tree :size * 0.74
  LT 25
  PU BK :size PD
END

PU BK 170 PD
tree 120
`,
  },
  {
    id: 'koch',
    name: 'Koch snowflake',
    blurb: 'Each side becomes four smaller sides.',
    source: `; Koch snowflake: every straight side is
; replaced by four sides with a bump.
TO koch :len :depth
  IF :depth = 0 [ FD :len STOP ]
  koch :len / 3 :depth - 1
  LT 60
  koch :len / 3 :depth - 1
  RT 120
  koch :len / 3 :depth - 1
  LT 60
  koch :len / 3 :depth - 1
END

PU SETXY -150 -87 PD
RT 90
SETCOLOR 3
REPEAT 3 [ koch 300 4 RT 120 ]
`,
  },
  {
    id: 'sierpinski',
    name: 'Sierpinski',
    blurb: 'Three half-size copies of itself, five levels deep.',
    source: `; Sierpinski triangle: a triangle made of
; three half-size Sierpinski triangles.
TO sier :len :depth
  IF :depth = 0 [ REPEAT 3 [ FD :len LT 120 ] STOP ]
  sier :len / 2 :depth - 1
  PU FD :len / 2 PD
  sier :len / 2 :depth - 1
  PU BK :len / 2 LT 60 FD :len / 2 RT 60 PD
  sier :len / 2 :depth - 1
  PU LT 60 BK :len / 2 RT 60 PD
END

PU SETXY -140 81 PD
RT 90
SETCOLOR 1
sier 280 5
`,
  },
];
