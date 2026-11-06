// Deactivating or reactivating an item (ADR-032): the change takes a reason from
// the list, and a note when the reason is Other. It adds its own row to Movements.
import { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Field, Input, Select } from './Field';
import { useToast } from './Toast';
import { api, type ApiError } from '../api/client';
import { DEACTIVATE_REASONS, REACTIVATE_REASONS } from '../lib/itemStatus';

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
    } finally {
      setSaving(false);
    }
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
          <Button variant={active ? 'primary' : 'danger'} onClick={() => void save()} loading={saving}>{active ? 'Reactivate' : 'Deactivate'}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        <p className="text-sm text-surface-700">
          {active
            ? 'The item can be received, issued, transferred and adjusted again. This adds a row to Movements.'
            : 'While the item is inactive it cannot be received, issued, transferred or adjusted, and it drops off Stock status. Its history stays, and this adds a row to Movements. You can reactivate it at any time.'}
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
