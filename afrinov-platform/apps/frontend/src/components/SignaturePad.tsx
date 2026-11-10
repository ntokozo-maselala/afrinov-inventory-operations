// A signature drawn with a finger, a pen or a mouse (ADR-034). The ink is a
// dark blue on a transparent background, whatever the theme, so the saved PNG
// reads the same on the printed slip.
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

export interface SignaturePadHandle {
  /** The signature as a PNG, base64 without the data: prefix; null when nothing is drawn. */
  toBase64: () => string | null;
  clear: () => void;
}

const INK = '#1a2a4a';

export function SignaturePad({ signer, onInk, ref }: {
  /** Shown under the line: "Sign above · Sabelo Mkhize". */
  signer: string;
  /** Whether anything has been drawn, as it changes. */
  onInk: (inked: boolean) => void;
  ref?: Ref<SignaturePadHandle>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const inked = useRef(false);

  useImperativeHandle(ref, () => ({
    toBase64: () => (inked.current && canvas.current ? canvas.current.toDataURL('image/png').split(',')[1] ?? null : null),
    clear: () => {
      const c = canvas.current;
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      inked.current = false;
      onInk(false);
    },
  }), [onInk]);

  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    // Sized to its box at the screen's density, so the line is sharp. Kept small: a signature is at most 200 KB.
    const box = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round((box.width || 480) * dpr);
    c.height = Math.round((box.height || 170) * dpr);
    g.scale(dpr, dpr);
    g.strokeStyle = INK;
    g.lineWidth = 2.2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    let drawing = false;
    const at = (e: PointerEvent) => { const b = c.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top] as const; };
    const down = (e: PointerEvent) => { drawing = true; c.setPointerCapture?.(e.pointerId); const [x, y] = at(e); g.beginPath(); g.moveTo(x, y); };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = at(e);
      g.lineTo(x, y);
      g.stroke();
      if (!inked.current) { inked.current = true; onInk(true); }
    };
    const up = () => { drawing = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
  }, [onInk]);

  return (
    <div className="relative h-[170px] rounded-md border border-surface-200 bg-white touch-none">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full cursor-crosshair" aria-label={`Signature pad for ${signer}: draw with a finger, pen or mouse`} />
      <div className="pointer-events-none absolute left-4 right-4 bottom-9 border-t border-dashed border-slate-400" />
      <div className="pointer-events-none absolute left-4 bottom-3 text-xs text-slate-500">Sign above · {signer}</div>
    </div>
  );
}
