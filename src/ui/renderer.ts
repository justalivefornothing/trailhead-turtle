import { bounds, type StyledSegment, type TurtleState } from '../lang';

export interface View {
  /** World point shown at the centre of the canvas. */
  cx: number;
  cy: number;
  zoom: number;
}

const BG = '#1f4d3a';
const GRID = 'rgba(243, 233, 210, 0.06)';
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 40;

/**
 * Draws the trail and the turtle. Committed segments are cached on an
 * offscreen canvas and only new ones are painted each frame; any change of
 * view (pan/zoom/resize) or a CLEAR triggers a full repaint of the cache.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  view: View = { cx: 0, cy: 0, zoom: 1 };

  private readonly ctx: CanvasRenderingContext2D;
  private readonly trail = document.createElement('canvas');
  private readonly trailCtx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private cachedCount = 0;
  private cacheDirty = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.trailCtx = this.trail.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (rect.width === this.width && rect.height === this.height && dpr === this.dpr) return;
    this.width = rect.width;
    this.height = rect.height;
    this.dpr = dpr;
    for (const c of [this.canvas, this.trail]) {
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
    }
    this.cacheDirty = true;
  }

  worldToScreen(x: number, y: number): [number, number] {
    const { cx, cy, zoom } = this.view;
    return [(x - cx) * zoom + this.width / 2, (y - cy) * zoom + this.height / 2];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    const { cx, cy, zoom } = this.view;
    return [(sx - this.width / 2) / zoom + cx, (sy - this.height / 2) / zoom + cy];
  }

  setView(view: Partial<View>): void {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom ?? this.view.zoom));
    this.view = { cx: view.cx ?? this.view.cx, cy: view.cy ?? this.view.cy, zoom };
    this.cacheDirty = true;
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.setView({ cx: this.view.cx - dxScreen / this.view.zoom, cy: this.view.cy - dyScreen / this.view.zoom });
  }

  /** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
  zoomAt(factor: number, sx = this.width / 2, sy = this.height / 2): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * factor));
    this.setView({
      zoom,
      cx: wx - (sx - this.width / 2) / zoom,
      cy: wy - (sy - this.height / 2) / zoom,
    });
  }

  /** Frame the whole drawing (and the turtle) with some breathing room. */
  fit(segments: StyledSegment[], turtle: TurtleState | null): void {
    const b = bounds(segments) ?? (turtle ? { minX: turtle.x, minY: turtle.y, maxX: turtle.x, maxY: turtle.y } : null);
    if (!b) {
      this.setView({ cx: 0, cy: 0, zoom: 1 });
      return;
    }
    if (turtle) {
      b.minX = Math.min(b.minX, turtle.x);
      b.maxX = Math.max(b.maxX, turtle.x);
      b.minY = Math.min(b.minY, turtle.y);
      b.maxY = Math.max(b.maxY, turtle.y);
    }
    const w = Math.max(b.maxX - b.minX, 1);
    const h = Math.max(b.maxY - b.minY, 1);
    const pad = 48;
    const zoom = Math.min((this.width - pad * 2) / w, (this.height - pad * 2) / h, 8);
    this.setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom: Math.max(zoom, MIN_ZOOM) });
  }

  /**
   * Gently pull the view so the world point stays inside the viewport
   * (inset by a margin). Called every frame while running, so the 12% ease
   * per call produces a smooth follow.
   */
  follow(x: number, y: number): void {
    const margin = Math.min(72, this.width / 5, this.height / 5);
    const [sx, sy] = this.worldToScreen(x, y);
    let dx = 0;
    let dy = 0;
    if (sx < margin) dx = sx - margin;
    else if (sx > this.width - margin) dx = sx - (this.width - margin);
    if (sy < margin) dy = sy - margin;
    else if (sy > this.height - margin) dy = sy - (this.height - margin);
    if (dx || dy) this.panBy(-dx * 0.12, -dy * 0.12);
  }

  draw(segments: StyledSegment[], committed: number, partial: StyledSegment | null, turtle: TurtleState | null): void {
    this.resize();
    const { ctx, dpr } = this;

    this.updateTrailCache(segments, committed);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(dpr, dpr);
    this.drawGrid(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.trail, 0, 0);
    ctx.scale(dpr, dpr);

    if (partial) this.strokeSegments(ctx, [partial]);
    if (turtle && turtle.visible) this.drawTurtle(ctx, turtle);
  }

  private updateTrailCache(segments: StyledSegment[], committed: number): void {
    const tctx = this.trailCtx;
    if (this.cacheDirty || committed < this.cachedCount) {
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.clearRect(0, 0, this.trail.width, this.trail.height);
      this.cachedCount = 0;
      this.cacheDirty = false;
    }
    if (committed > this.cachedCount) {
      tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.strokeSegments(tctx, segments.slice(this.cachedCount, committed));
      this.cachedCount = committed;
    }
  }

  /** Stroke runs of same-styled segments as single paths. */
  private strokeSegments(ctx: CanvasRenderingContext2D, segs: StyledSegment[]): void {
    const { zoom } = this.view;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    let i = 0;
    while (i < segs.length) {
      const { color, width } = segs[i];
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(width * zoom, 0.75);
      ctx.beginPath();
      let lastX = NaN;
      let lastY = NaN;
      for (; i < segs.length && segs[i].color === color && segs[i].width === width; i++) {
        const s = segs[i];
        if (s.x1 !== lastX || s.y1 !== lastY) ctx.moveTo(...this.worldToScreen(s.x1, s.y1));
        ctx.lineTo(...this.worldToScreen(s.x2, s.y2));
        lastX = s.x2;
        lastY = s.y2;
      }
      ctx.stroke();
    }
  }

  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const { zoom } = this.view;
    let step = 50;
    while (step * zoom < 40) step *= 2;
    while (step * zoom > 160) step /= 2;
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.width, this.height);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
      const [sx] = this.worldToScreen(x, 0);
      ctx.moveTo(Math.round(sx) + 0.5, 0);
      ctx.lineTo(Math.round(sx) + 0.5, this.height);
    }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = this.worldToScreen(0, y);
      ctx.moveTo(0, Math.round(sy) + 0.5);
      ctx.lineTo(this.width, Math.round(sy) + 0.5);
    }
    ctx.stroke();
  }

  /** A rounded, slightly wobbly turtle, always ~30px on screen. */
  private drawTurtle(ctx: CanvasRenderingContext2D, t: TurtleState): void {
    const [sx, sy] = this.worldToScreen(t.x, t.y);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate((t.heading * Math.PI) / 180);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#163126';

    const limb = (x: number, y: number, angle: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.2, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };

    ctx.fillStyle = '#7cc48f';
    limb(-8.5, -6, -0.6);
    limb(8.5, -6, 0.6);
    limb(-8.5, 6.5, 0.7);
    limb(8.5, 6.5, -0.7);
    // tail
    ctx.beginPath();
    ctx.moveTo(-2.5, 10);
    ctx.quadraticCurveTo(0, 16, 2.5, 10);
    ctx.fill();
    ctx.stroke();
    // head
    ctx.beginPath();
    ctx.ellipse(0, -13.5, 4.6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#163126';
    ctx.beginPath();
    ctx.arc(-2, -15, 0.9, 0, Math.PI * 2);
    ctx.arc(2, -15, 0.9, 0, Math.PI * 2);
    ctx.fill();
    // shell
    ctx.fillStyle = '#9ad8a6';
    ctx.beginPath();
    ctx.ellipse(0, 0, 9.5, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(22, 49, 38, 0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.2, 5, 0, 0, Math.PI * 2);
    ctx.moveTo(-3.6, -2.6);
    ctx.lineTo(-8.4, -5.8);
    ctx.moveTo(3.6, -2.6);
    ctx.lineTo(8.4, -5.8);
    ctx.moveTo(-4, 3);
    ctx.lineTo(-8.6, 6.2);
    ctx.moveTo(4, 3);
    ctx.lineTo(8.6, 6.2);
    ctx.stroke();
    // pen indicator: a small dot on the shell when the pen is up
    if (!t.pen) {
      ctx.fillStyle = '#f3e9d2';
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
