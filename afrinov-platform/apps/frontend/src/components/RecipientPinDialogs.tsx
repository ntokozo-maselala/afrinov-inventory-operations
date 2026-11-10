// Counter PINs on the Recipients page (ADR-034). A store controller starts
// each of these; the PIN itself is typed by the person it belongs to, twice,
// with the screen turned to them, so the store controller never sees it. A
// PIN already set is reset, with a reason, before a new one is chosen.
import { useState } from 'react';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { Button } from './Button';
import { Field, Input } from './Field';
import { PinPad, PIN_MIN } from './PinPad';
import { api, type ApiError } from '../api/client';
import { isWeakPin } from '../lib/receipts';

interface Who { id: string; name: string }

export function SetPinDialog({ recipient, onClose, onSaved }: { recipient: Who; onClose: () => void; onSaved: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const name = recipient.name.split(' ')[0] ?? recipient.name;

  async function enter(value: string) {
    setProblem(null);
    if (first === null) {
      if (isWeakPin(value)) { setProblem('That PIN is too easy to guess. Choose another.'); setPin(''); return; }
      setFirst(value);
      setPin('');
      return;
    }
    if (value !== first) { setProblem('The two PINs don’t match. Start again.'); setFirst(null); setPin(''); return; }
    setBusy(true);
    try {
      await api.put(`/recipients/${recipient.id}/pin`, { pin: value });
      setDone(true);
    } catch (err) {
      setProblem((err as ApiError).message);
      setFirst(null);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal open onClose={onSaved} title={`PIN set for ${recipient.name}`} size="sm" footer={<Button variant="primary" onClick={onSaved} autoFocus>Done</Button>}>
        <p className="text-sm text-surface-600">Hand the screen back. Only a coded copy is kept, so nobody can read the PIN, Admin included.</p>
      </Modal>
    );
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={first === null ? `${name}, choose a PIN` : 'Enter it again'}
      description={`Turn the screen to ${recipient.name}. They type it; you don’t need to see it.`}
      size="sm"
      footer={<Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>}
    >
      <div className="space-y-3">
        <PinPad
          value={pin}
          onChange={setPin}
          onSubmit={(v) => void enter(v)}
          disabled={busy}
          submitLabel={first === null ? 'Next' : 'Set PIN'}
          label={first === null ? `${PIN_MIN} to 6 digits` : 'The same PIN again'}
        />
        <p className="text-xs text-surface-500 text-center">Not 1234, 0000, 1212 or the same digit repeated.</p>
        {problem && <Alert tone="warning" title="Not set yet">{problem}</Alert>}
      </div>
    </Modal>
  );
}

export function ResetPinDialog({ recipient, onClose, onSaved }: { recipient: Who; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!reason.trim()) { setError('Say why the PIN is reset.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/recipients/${recipient.id}/pin/reset`, { reason: reason.trim() });
      onSaved();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset ${recipient.name}’s PIN`}
      description="They sign instead until a new PIN is set. The reason is kept in the activity log."
      size="sm"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void reset()} loading={busy}>Reset PIN</Button>
      </>}
    >
      <Field label="Why?" htmlFor="pin-reset-reason" required help="For example: forgot it, or someone else may know it.">
        <Input id="pin-reset-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      {error && <Alert tone="danger" title="Not reset" className="mt-3">{error}</Alert>}
    </Modal>
  );
}
