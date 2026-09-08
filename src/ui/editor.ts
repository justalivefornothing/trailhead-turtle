import type { Span } from '../lang';

export interface Highlight {
  span: Span;
  kind: 'error' | 'active';
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A plain <textarea> with a mirrored <pre> behind it. The mirror carries the
 * same text (transparent) plus <mark> elements, which is how error underlines
 * and the "currently executing" highlight line up with the real text.
 */
export class Editor {
  readonly textarea: HTMLTextAreaElement;
  private readonly backdrop: HTMLElement;
  private highlights: Highlight[] = [];
  private changeListeners: Array<() => void> = [];

  constructor(root: HTMLElement) {
    this.textarea = root.querySelector('textarea')!;
    this.backdrop = root.querySelector('.editor__backdrop')!;

    this.textarea.addEventListener('input', () => {
      this.highlights = this.highlights.filter((h) => h.kind !== 'error');
      this.renderBackdrop();
      this.changeListeners.forEach((fn) => fn());
    });
    this.textarea.addEventListener('scroll', () => this.syncScroll());
    this.textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.insert('  ');
      }
    });
    this.renderBackdrop();
  }

  get value(): string {
    return this.textarea.value;
  }

  set value(text: string) {
    this.textarea.value = text;
    this.highlights = [];
    this.renderBackdrop();
    this.textarea.scrollTop = 0;
    this.syncScroll();
  }

  onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  setError(span: Span | null): void {
    this.highlights = this.highlights.filter((h) => h.kind !== 'error');
    if (span) {
      this.highlights.push({ span, kind: 'error' });
      this.textarea.focus({ preventScroll: true });
      this.textarea.setSelectionRange(span.start, span.end);
    }
    this.renderBackdrop();
  }

  setActive(span: Span | null): void {
    const prev = this.highlights.find((h) => h.kind === 'active');
    if (prev?.span === span) return;
    this.highlights = this.highlights.filter((h) => h.kind !== 'active');
    if (span) this.highlights.push({ span, kind: 'active' });
    this.renderBackdrop();
  }

  private insert(text: string): void {
    const { selectionStart, selectionEnd } = this.textarea;
    this.textarea.setRangeText(text, selectionStart, selectionEnd, 'end');
    this.textarea.dispatchEvent(new Event('input'));
  }

  private renderBackdrop(): void {
    const text = this.textarea.value;
    const marks = this.highlights
      .map((h) => ({ ...h, start: Math.min(h.span.start, text.length), end: Math.min(h.span.end, text.length) }))
      .filter((h) => h.end > h.start)
      .sort((a, b) => a.start - b.start);

    let html = '';
    let pos = 0;
    for (const m of marks) {
      if (m.start < pos) continue; // overlapping marks: keep the first
      html += escapeHtml(text.slice(pos, m.start));
      html += `<mark class="mark--${m.kind}">${escapeHtml(text.slice(m.start, m.end))}</mark>`;
      pos = m.end;
    }
    html += escapeHtml(text.slice(pos));
    // keep the mirror as tall as the textarea when the text ends in a newline
    this.backdrop.innerHTML = html + (text.endsWith('\n') || text === '' ? ' ' : '');
    this.syncScroll();
  }

  private syncScroll(): void {
    this.backdrop.scrollTop = this.textarea.scrollTop;
    this.backdrop.scrollLeft = this.textarea.scrollLeft;
  }
}
