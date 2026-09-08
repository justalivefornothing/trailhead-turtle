import { DEFAULT_PALETTE, type Segment } from './interpreter';

export type SvgSegment = Segment & { color?: string; width?: number };

export interface SvgOptions {
  /** Space around the drawing, in turtle units. */
  padding?: number;
  /** Fill for a background rect; `null` for a transparent export. */
  background?: string | null;
  /** Style used for segments that carry none. */
  color?: string;
  width?: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(segments: Segment[]): Bounds | null {
  if (segments.length === 0) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of segments) {
    b.minX = Math.min(b.minX, s.x1, s.x2);
    b.maxX = Math.max(b.maxX, s.x1, s.x2);
    b.minY = Math.min(b.minY, s.y1, s.y2);
    b.maxY = Math.max(b.maxY, s.y1, s.y2);
  }
  return b;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Serialises the trail as SVG. Consecutive segments that share a colour and
 * width are merged into one <path>; a segment that starts where the previous
 * one ended continues the sub-path with `L`, otherwise a new `M` begins.
 */
export function toSVG(segments: SvgSegment[], opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 16;
  const defColor = opts.color ?? DEFAULT_PALETTE[0];
  const defWidth = opts.width ?? 2;
  const background = opts.background === undefined ? '#1f4d3a' : opts.background;

  const maxWidth = segments.reduce((m, s) => Math.max(m, s.width ?? defWidth), 0);
  const b = bounds(segments) ?? { minX: -50, minY: -50, maxX: 50, maxY: 50 };
  const margin = pad + maxWidth / 2;
  const x = b.minX - margin;
  const y = b.minY - margin;
  const w = b.maxX - b.minX + margin * 2;
  const h = b.maxY - b.minY + margin * 2;

  const paths: string[] = [];
  let color = '';
  let width = -1;
  let d = '';
  let lastX = NaN;
  let lastY = NaN;

  const flush = () => {
    if (d) paths.push(`<path stroke="${escapeAttr(color)}" stroke-width="${fmt(width)}" d="${d.trim()}"/>`);
    d = '';
  };

  for (const s of segments) {
    const c = s.color ?? defColor;
    const wd = s.width ?? defWidth;
    if (c !== color || wd !== width) {
      flush();
      color = c;
      width = wd;
      lastX = NaN;
    }
    if (s.x1 !== lastX || s.y1 !== lastY) d += ` M${fmt(s.x1)} ${fmt(s.y1)}`;
    d += ` L${fmt(s.x2)} ${fmt(s.y2)}`;
    lastX = s.x2;
    lastY = s.y2;
  }
  flush();

  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}">`,
  ];
  if (background) {
    lines.push(`  <rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w)}" height="${fmt(h)}" fill="${escapeAttr(background)}"/>`);
  }
  lines.push('  <g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const p of paths) lines.push(`    ${p}`);
  lines.push('  </g>', '</svg>');
  return lines.join('\n');
}
