import './style.css';
import { bounds, toSVG, type Span } from './lang';
import { Editor } from './ui/editor';
import { EXAMPLES } from './ui/examples';
import { Renderer } from './ui/renderer';
import { Runner, type RunnerStatus } from './ui/runner';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('canvas');
const message = $<HTMLParagraphElement>('message');
const status = $<HTMLParagraphElement>('status');
const empty = $<HTMLDivElement>('empty');
const zoomReadout = $<HTMLSpanElement>('zoom');
const runBtn = $<HTMLButtonElement>('run');
const stepBtn = $<HTMLButtonElement>('step');
const stopBtn = $<HTMLButtonElement>('stop');
const resetBtn = $<HTMLButtonElement>('reset');
const speedInput = $<HTMLInputElement>('speed');
const speedValue = $<HTMLSpanElement>('speed-value');
const gallery = $<HTMLDivElement>('gallery');

const editor = new Editor($('editor'));
const renderer = new Renderer(canvas);

let loadedSource: string | null = null;
// The runner reports the active statement on every step; at high speed that is
// thousands per frame, so the editor highlight is applied once per frame instead.
let activeSpan: Span | null = null;

const say = (text: string, isError = false) => {
  message.textContent = text;
  message.classList.toggle('message--error', isError);
};

const runner = new Runner(renderer, {
  onStatus(s: RunnerStatus) {
    runBtn.innerHTML = `<span class="btn__icon" aria-hidden="true">&#9654;</span> ${s === 'paused' ? 'Resume' : 'Run'}`;
    stopBtn.disabled = s !== 'running';
    stepBtn.disabled = false;
    empty.hidden = s !== 'idle';
    if (s === 'running') say('Running…');
    else if (s === 'paused') say('Paused — Step through it or Resume.');
    else if (s === 'done') {
      say(`Done: ${runner.segments.length} segments in ${runner.steps} steps.`);
      // If the follow-cam left part of the drawing off-screen, ease out to show it all.
      const b = bounds(runner.segments);
      if (b && !renderer.contains(b)) fit();
    } else if (s === 'ready' || s === 'idle') say('');
  },
  onError(err) {
    editor.setError(err.span);
    say(`${err.detail} (line ${err.span.line}, column ${err.span.col})`, true);
  },
  onActive(span) {
    activeSpan = span;
  },
});

// ---------- gallery ----------

for (const ex of EXAMPLES) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = ex.name;
  chip.title = ex.blurb;
  chip.setAttribute('aria-pressed', 'false');
  chip.addEventListener('click', () => {
    editor.value = ex.source;
    markChip(ex.id);
    start();
  });
  gallery.appendChild(chip);
}

function markChip(id: string | null): void {
  gallery.querySelectorAll<HTMLButtonElement>('.chip').forEach((c, i) => {
    c.setAttribute('aria-pressed', String(EXAMPLES[i].id === id));
  });
}

editor.onChange(() => markChip(null));

// ---------- run controls ----------

function load(): boolean {
  editor.setError(null);
  loadedSource = editor.value;
  if (loadedSource.trim() === '') {
    runner.reset();
    say('The program is empty — pick an example above or write a command like FD 100.');
    return false;
  }
  return runner.load(loadedSource);
}

function needsReload(): boolean {
  return runner.status === 'idle' || runner.status === 'done' || runner.status === 'error' || editor.value !== loadedSource;
}

function start(): void {
  // Run always starts over unless we are resuming a pause of the same program.
  if ((needsReload() || runner.status !== 'paused') && !load()) return;
  runner.follow = true;
  runner.play();
}

function stepOnce(): void {
  if (needsReload() && !load()) return;
  runner.step();
}

function resetAll(): void {
  runner.reset();
  editor.setError(null);
  loadedSource = null;
  say('');
}

runBtn.addEventListener('click', start);
stepBtn.addEventListener('click', stepOnce);
stopBtn.addEventListener('click', () => runner.pause());
resetBtn.addEventListener('click', resetAll);

const applySpeed = () => {
  runner.speed = Number(speedInput.value);
  speedValue.textContent = runner.speed >= 10 ? 'max' : String(runner.speed);
};
speedInput.addEventListener('input', applySpeed);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    start();
  } else if (e.key === 'Escape' && runner.status === 'running') {
    runner.pause();
  }
});

// ---------- canvas: pan, zoom, fit, keyboard ----------

const pointers = new Map<number, { x: number; y: number }>();
let pinchDistance = 0;

const userMovedView = () => {
  runner.follow = false;
};

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.classList.add('is-panning');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const rect = canvas.getBoundingClientRect();
  if (pointers.size === 1) {
    renderer.panBy(e.clientX - prev.x, e.clientY - prev.y);
    userMovedView();
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDistance > 0) {
      renderer.zoomAt(dist / pinchDistance, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
      userMovedView();
    }
    pinchDistance = dist;
  }
});

const endPointer = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinchDistance = 0;
  if (pointers.size === 0) canvas.classList.remove('is-panning');
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    userMovedView();
  },
  { passive: false },
);

function fit(): void {
  renderer.fit(runner.segments, runner.turtle);
  runner.follow = true;
}

canvas.addEventListener('dblclick', fit);
$('fit').addEventListener('click', fit);
$('zoom-in').addEventListener('click', () => {
  renderer.zoomAt(1.25);
  userMovedView();
});
$('zoom-out').addEventListener('click', () => {
  renderer.zoomAt(0.8);
  userMovedView();
});

canvas.addEventListener('keydown', (e) => {
  const pan = 40;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [pan, 0], ArrowRight: [-pan, 0], ArrowUp: [0, pan], ArrowDown: [0, -pan],
  };
  if (e.key in moves) {
    renderer.panBy(...moves[e.key]);
    userMovedView();
  } else if (e.key === '+' || e.key === '=') {
    renderer.zoomAt(1.25);
    userMovedView();
  } else if (e.key === '-' || e.key === '_') {
    renderer.zoomAt(0.8);
    userMovedView();
  } else if (e.key === 'f' || e.key === 'F') {
    fit();
  } else if (e.key === '0') {
    renderer.setView({ cx: 0, cy: 0, zoom: 1 });
    runner.follow = true;
  } else {
    return;
  }
  e.preventDefault();
});

// ---------- export ----------

$('export').addEventListener('click', () => {
  const segments = runner.segments;
  if (segments.length === 0) {
    say('Nothing to export yet — run a program first.');
    return;
  }
  const svg = toSVG(segments);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trailhead.svg';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say(`Exported ${segments.length} segments as trailhead.svg`);
});

// ---------- status readout ----------

let lastStatusUpdate = 0;
function updateStatus(time: number): void {
  requestAnimationFrame(updateStatus);
  editor.setActive(activeSpan);
  if (time - lastStatusUpdate < 100) return;
  lastStatusUpdate = time;
  const t = runner.turtle;
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  status.textContent = `x ${fmt(t.x)}  y ${fmt(t.y)}  heading ${fmt(t.heading)}°  ·  ${runner.segments.length} segments  ·  ${runner.status}`;
  zoomReadout.textContent = `${Math.round(renderer.view.zoom * 100)}%`;
}
requestAnimationFrame(updateStatus);

// ---------- boot ----------

applySpeed();
editor.value = EXAMPLES[0].source;
markChip(EXAMPLES[0].id);
start();
