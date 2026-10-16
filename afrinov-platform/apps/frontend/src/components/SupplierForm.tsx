// The form for adding a supplier (POST /suppliers). Used in a drawer on the
// Suppliers page and on Receive stock, where a delivery from a new supplier
// can be booked without leaving the page (ADR-018).
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';

export interface CreatedSupplier { id: string; name: string }

export function SupplierForm({ onCancel, onSaved, onError, onSuccess }: {
  onCancel: () => void;
  /** Called with the new supplier once it is saved. */
  onSaved: (supplier: CreatedSupplier) => void;
  onError: (e: ApiError) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [contactName, setContact] = useState('');
  const [contactEmail, setEmail] = useState('');
  const [contactPhone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!name.trim()) { setValidation('Name is required.'); return; }
    if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) { setValidation('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const created = await api.post<CreatedSupplier>('/suppliers', {
        name: name.trim(),
        contactName: contactName || undefined,
        contactEmail: contactEmail || undefined,
        contactPhone: contactPhone || undefined,
        notes: notes || undefined,
      });
      onSuccess();
      onSaved(created);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Field label="Name" htmlFor="sup-name" required error={validation && !name.trim() ? validation : null}>
        <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} required invalid={!!validation && !name.trim()} />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contact name" htmlFor="sup-contact"><Input id="sup-contact" value={contactName} onChange={(e) => setContact(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="sup-phone"><Input id="sup-phone" value={contactPhone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Email" htmlFor="sup-email" error={validation && contactEmail ? validation : null}>
        <Input id="sup-email" type="email" value={contactEmail} onChange={(e) => setEmail(e.target.value)} invalid={!!validation && !!contactEmail} />
      </Field>
      <Field label="Notes" htmlFor="sup-notes"><Input id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {validation && (validation !== 'Name is required.' || !name.trim()) && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>Save supplier</Button>
      </div>
    </form>
  );
}
