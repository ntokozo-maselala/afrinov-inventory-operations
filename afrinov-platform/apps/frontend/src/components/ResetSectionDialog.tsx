// Resetting one settings section, after seeing what it changes (system audit
// C10): the server lists each setting not at its default, with its value now
// and the default it goes back to. Nothing to change, nothing to confirm.
import { useApi } from '../hooks/useApi';
import type { SettingCategory } from '../hooks/useSettings';
import { Modal } from './Modal';
import { Button } from './Button';
import { Alert } from './Alert';
import { Skeleton } from './Skeleton';
import { presentError } from '../lib/errorPresentation';

export interface ResetChange { key: string; description: string; from: unknown; to: unknown }

/** A setting's value as a person reads it. */
export function shownValue(v: unknown): string {
  if (v === true) return 'On';
  if (v === false) return 'Off';
  if (v === null || v === undefined || v === '') return '(empty)';
  const text = String(v);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function ResetSectionDialog({ category, label, onClose, onReset, resetting }: {
  category: SettingCategory;
  label: string;
  onClose: () => void;
  onReset: () => void;
  resetting: boolean;
}) {
  const preview = useApi<ResetChange[]>(`/settings/reset-preview?category=${encodeURIComponent(category)}`);
  const changes = preview.data ?? [];
  const none = !!preview.data && changes.length === 0;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset ${label} to defaults?`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={resetting}>{none ? 'Close' : 'Cancel'}</Button>
          {!none && (
            <Button variant="danger" onClick={onReset} loading={resetting} disabled={!preview.data}>
              Reset {changes.length} setting{changes.length === 1 ? '' : 's'}
            </Button>
          )}
        </>
      }
    >
      {preview.error && <Alert tone="danger" title="Couldn't work out what would change">{presentError(preview.error).message}</Alert>}
      {preview.loading && !preview.data && <div className="space-y-2"><Skeleton h={24} /><Skeleton h={24} /></div>}
      {none && <p className="text-sm text-surface-600">Every setting in {label} is at its default already. Other sections are left as they are.</p>}
      {changes.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-surface-600">
            Only {label} changes; other sections are left as they are. Each change is recorded in Change history, and is put back by hand.
          </p>
          <ul className="divide-y divide-surface-200 surface-card p-0 overflow-hidden" aria-label="What would change">
            {changes.map((c) => (
              <li key={c.key} className="px-3 py-2 text-sm">
                <div className="text-surface-900">{c.description}</div>
                <div className="text-xs text-surface-500 mt-0.5">
                  <span className="line-through">{shownValue(c.from)}</span> → <span className="font-medium text-surface-700">{shownValue(c.to)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
