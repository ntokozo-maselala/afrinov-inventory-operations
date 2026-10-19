// The form for adding a supplier (POST /suppliers) or, given `initial`,
// editing one (PATCH /suppliers/:id). Used in a drawer on the Suppliers page,
// on Supplier detail and on Receive stock, where a delivery from a new
// supplier can be booked without leaving the page (ADR-018). The purchasing
// fields follow the vendor list in the AFRI-0000_x purchase order template.
import { useState } from 'react';
import { Button } from './Button';
import { Field, Input, Select, Textarea } from './Field';
import { Alert } from './Alert';
import { api, type ApiError } from '../api/client';
import type { Supplier } from '../api/types';

export interface CreatedSupplier { id: string; name: string }

export const SUPPLIER_CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const;
/** Suggested in the Payment terms box; anything else can be typed. */
export const PAYMENT_TERM_SUGGESTIONS = ['C.O.D', '30 DAYS NETT', '60 DAYS NETT', '100% ON ORDER PLACEMENT'] as const;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function SupplierForm({ initial, onCancel, onSaved, onError, onSuccess }: {
  /** The supplier to edit. Without it the form adds a new one. */
  initial?: Supplier;
  onCancel: () => void;
  /** Called with the saved supplier. */
  onSaved: (supplier: CreatedSupplier) => void;
  onError: (e: ApiError) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [vendorCode, setVendorCode] = useState(initial?.vendorCode ?? '');
  const [contactName, setContact] = useState(initial?.contactName ?? '');
  const [contactEmail, setEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setPhone] = useState(initial?.contactPhone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [currency, setCurrency] = useState(initial?.currency ?? 'ZAR');
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? '');
  const [website, setWebsite] = useState(initial?.website ?? '');
  const [services, setServices] = useState(initial?.services ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setValidation(null);
    if (!name.trim()) { setValidation('Name is required.'); return; }
    if (vendorCode.trim() && !/^[A-Za-z0-9-]+$/.test(vendorCode.trim())) { setValidation('A vendor code has letters, digits and dashes only, e.g. V001.'); return; }
    if (contactEmail.trim() && !EMAIL.test(contactEmail.trim())) { setValidation('Enter a valid email address.'); return; }
    // Adding leaves blank fields out; editing sends them as null, which clears them.
    const blank = initial ? null : undefined;
    const opt = (v: string) => v.trim() || blank;
    const body = {
      name: name.trim(),
      vendorCode: opt(vendorCode),
      contactName: opt(contactName),
      contactEmail: opt(contactEmail),
      contactPhone: opt(contactPhone),
      address: opt(address),
      currency,
      paymentTerms: opt(paymentTerms),
      website: opt(website),
      services: opt(services),
      notes: opt(notes),
    };
    setBusy(true);
    try {
      const saved = initial
        ? await api.patch<CreatedSupplier>(`/suppliers/${initial.id}`, body)
        : await api.post<CreatedSupplier>('/suppliers', body);
      onSuccess();
      onSaved(saved);
    } catch (err) { onError(err as ApiError); }
    finally { setBusy(false); }
  }

  const nameMissing = !!validation && !name.trim();
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name" htmlFor="sup-name" required className="sm:col-span-2" error={nameMissing ? validation : null}>
          <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} required invalid={nameMissing} />
        </Field>
        <Field label="Vendor code" htmlFor="sup-code" help="e.g. V001">
          <Input id="sup-code" value={vendorCode} onChange={(e) => setVendorCode(e.target.value)} className="text-mono" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Contact name" htmlFor="sup-contact"><Input id="sup-contact" value={contactName} onChange={(e) => setContact(e.target.value)} /></Field>
        <Field label="Phone" htmlFor="sup-phone"><Input id="sup-phone" value={contactPhone} onChange={(e) => setPhone(e.target.value)} /></Field>
      </div>
      <Field label="Email" htmlFor="sup-email">
        <Input id="sup-email" type="email" value={contactEmail} onChange={(e) => setEmail(e.target.value)} invalid={!!validation && !!contactEmail.trim() && !EMAIL.test(contactEmail.trim())} />
      </Field>
      <Field label="Address" htmlFor="sup-address"><Textarea id="sup-address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Currency" htmlFor="sup-currency">
          <Select id="sup-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {SUPPLIER_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Payment terms" htmlFor="sup-terms" className="sm:col-span-2" help="Copied onto new purchase orders.">
          <Input id="sup-terms" list="sup-terms-list" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
          <datalist id="sup-terms-list">{PAYMENT_TERM_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
      </div>
      <Field label="Services and supplies" htmlFor="sup-services" help="What they provide, e.g. Compressor hire, Fasteners.">
        <Input id="sup-services" value={services} onChange={(e) => setServices(e.target.value)} />
      </Field>
      <Field label="Website" htmlFor="sup-website"><Input id="sup-website" value={website} onChange={(e) => setWebsite(e.target.value)} /></Field>
      <Field label="Notes" htmlFor="sup-notes"><Input id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      {validation && !nameMissing && <Alert tone="danger" title="Cannot save">{validation}</Alert>}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-200 -mx-5 px-5">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" type="submit" loading={busy}>{initial ? 'Save changes' : 'Save supplier'}</Button>
      </div>
    </form>
  );
}
