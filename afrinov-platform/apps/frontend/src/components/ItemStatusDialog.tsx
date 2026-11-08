// Deactivating or reactivating an item (ADR-033): the change takes a reason from
// the list, and a note when the reason is Other. It adds its own row to Movements.
// An item is deactivated only when it is clear, so anything in the way is listed
// first, each with where to deal with it. There is no override.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Input, Select } from './Field';
import { useToast } from './Toast';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { DEACTIVATE_REASONS, REACTIVATE_REASONS, blockerAction, type DeactivationBlocker } from '../lib/itemStatus';

interface ItemStatusDialogProps {
  material: { id: string; sku: string };
  /** The status it is changing to. */
  active: boolean;
  onClose: () => void;
  /** Called once the change is saved. */
  onChanged: () => void;
}

export function ItemStatusDialog({ material, active, onClose, onChanged }: ItemStatusDialogProps) {
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  const [invalid, setInvalid] = useState<'reason' | 'note' | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const check = useApi<{ blockers?: DeactivationBlocker[] }>(active ? null : `/materials/${material.id}/deactivation-check`);
  const blockers = check.data?.blockers ?? [];
  const reasons = active ? REACTIVATE_REASONS : DEACTIVATE_REASONS;
  const noteNeeded = reasonCode === 'OTHER';

  async function save() {
    if (!reasonCode) return setInvalid('reason');
    if (noteNeeded && !note.trim()) return setInvalid('note');
    setSaving(true);
    try {
      await api.patch(`/materials/${material.id}/status`, { active, reasonCode, ...(note.trim() ? { note: note.trim() } : {}) });
      toast.success(active ? `${material.sku} reactivated` : `${material.sku} deactivated`);
      onChanged();
    } catch (err) {
      toast.error(active ? 'Could not reactivate item' : 'Could not deactivate item', (err as ApiError).message);
      // Something may have come in since the list was read.
      if (!active) check.reload();
    } finally {
      setSaving(false);
    }
  }

  if (blockers.length > 0) {
    return (
      <Modal open onClose={onClose} title={`${material.sku} is not clear yet`} size="sm" footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-surface-700">Clear these first, then deactivate it. Issue or write off what is on hand: a transfer only moves it.</p>
          <ul className="space-y-2">
            {blockers.map((b) => {
              const action = blockerAction(b, material.sku);
              return (
                <li key={b.text} className="flex items-center justify-between gap-3 rounded-md bg-danger-50 px-3 py-2 text-sm text-danger-700">
                  <span>{b.text}</span>
                  <Link to={action.to} className="btn-link whitespace-nowrap">{action.label}</Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={active ? `Reactivate ${material.sku}?` : `Deactivate ${material.sku}?`}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant={active ? 'primary' : 'danger'} onClick={() => void save()} loading={saving} disabled={!active && check.loading}>{active ? 'Reactivate' : 'Deactivate'}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm text-surface-700">
          {active
            ? 'Stock can move on this item again. This adds a row to Movements.'
            : 'Nothing can move on this item until someone reactivates it: no orders, deliveries, returns or counts. Its history stays, and this adds a row to Movements.'}
        </p>
        <Field label="Reason" htmlFor="status-reason" required error={invalid === 'reason' ? 'Choose a reason.' : undefined}>
          <Select id="status-reason" value={reasonCode} invalid={invalid === 'reason'} onChange={(e) => { setReasonCode(e.target.value); setInvalid(null); }}>
            <option value="">Choose a reason</option>
            {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Note" htmlFor="status-note" required={noteNeeded} error={invalid === 'note' ? 'Add a note saying why.' : undefined}>
          <Input id="status-note" value={note} maxLength={500} invalid={invalid === 'note'} onChange={(e) => { setNote(e.target.value); setInvalid(null); }} />
        </Field>
      </div>
    </Modal>
  );
}
