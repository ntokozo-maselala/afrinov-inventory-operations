// A report's Download button: opens a small menu to choose Excel (to work with
// the figures) or PDF (a fixed copy to send or file). It shows the download in
// progress and reports a failure, so pages only say how to make each file.
import { useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { useToast } from './Toast';

export type DownloadFormat = 'xlsx' | 'pdf';

const FORMATS: Array<{ format: DownloadFormat; label: string }> = [
  { format: 'xlsx', label: 'Excel (.xlsx)' },
  { format: 'pdf', label: 'PDF (.pdf)' },
];

export function DownloadMenu({ label = 'Download', onDownload, disabled }: {
  label?: string;
  onDownload: (format: DownloadFormat) => Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    wrapper.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent) => { if (!wrapper.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); wrapper.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus(); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, [open]);

  async function choose(format: DownloadFormat) {
    setOpen(false);
    setBusy(true);
    try {
      await onDownload(format);
    } catch (e) {
      toast.error('Download failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={wrapper} className="relative inline-block">
      <Button
        variant="primary"
        size="sm"
        leadingIcon={<Icon.Download size={14} />}
        trailingIcon={<Icon.ChevronDown size={12} />}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        loading={busy}
        disabled={disabled}
      >
        {label}
      </Button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 z-30 mt-1 min-w-full w-max rounded border border-surface-200 bg-surface-0 shadow-lg py-1">
          {FORMATS.map((f) => (
            <button
              key={f.format}
              type="button"
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm text-surface-800 hover:bg-surface-100 focus:bg-surface-100 focus:outline-none"
              onClick={() => choose(f.format)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
