// The hand-over step (ADR-034): after an issue or a tool check-out has posted,
// the screen turns to the person collecting, who confirms the slip with their
// counter PIN or a signature. If they can't, the reason is kept. Opened again
// later from the slip, it also takes a photo of the signed paper slip.
//
// It never moves stock: the slip has already posted. A worker or contractor
// confirms their own slip; for a machine or site, the person collecting is
// chosen first and confirms with their own PIN or signature.
import { useCallback, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Alert } from './Alert';
import { Button } from './Button';
import { Field, Select, Input } from './Field';
import { PinPad } from './PinPad';
import { SignaturePad, type SignaturePadHandle } from './SignaturePad';
import { api, type ApiError } from '../api/client';
import { useApi } from '../hooks/useApi';
import { useIdempotencyKey } from '../lib/idempotency';
import { holdsPin, imageHandle, NOTE_REASONS, SKIP_REASONS, type ReceiptMode } from '../lib/receipts';
import { readReceiptPhoto, type ReceiptPhoto } from '../lib/receiptPhoto';
import { cn } from '../lib/cn';
import type { ReceiptSkipReason, ReceiptSummary } from '../api/types';

/** What the panel shows of the slip being handed over. */
export interface HandoverSlip {
  id: string;
  kind: 'ISSUE' | 'LOAN';
  recipientId: string | null;
  recipientName: string | null;
  recipientType: string | null;
  lines: Array<{ key: string; sku: string; name: string; quantity: string; unit: string }>;
  /** "For AFRI-1325", "No project" or "Due back 17 Nov 2026". */
  note: string;
}

interface Person { id: string; name: string; type: string; pinSet?: boolean; pinLocked?: boolean }

type Method = 'PIN' | 'SIGN' | 'NONE' | 'PAPER';

export function HandoverPanel({ slip, mode, later = false, start, onClose }: {
  slip: HandoverSlip;
  mode: ReceiptMode;
  /** Opened from the slip afterwards, not straight after posting. */
  later?: boolean;
  /** PAPER: attach a photo of the signed slip. */
  start?: 'PAPER';
  /** With the receipt recorded, or null when closed without recording anything. */
  onClose: (receipt: ReceiptSummary | null) => void;
}) {
  const people = useApi<Person[]>('/recipients?active=true');
  const everyone = people.data ?? [];
  const own = holdsPin(slip.recipientType) ? slip.recipientId : null;
  const [signerId, setSignerId] = useState(own ?? '');
  const signer = everyone.find((p) => p.id === signerId) ?? (own ? { id: own, name: slip.recipientName ?? 'the recipient', type: slip.recipientType ?? 'WORKER' } : undefined);
  const [lockedNow, setLockedNow] = useState<Set<string>>(new Set());
  const locked = !!signer && (signer.pinLocked || lockedNow.has(signer.id));
  // Null until someone picks a tab: then PIN, or Sign for someone without a PIN to use.
  const [method, setMethod] = useState<Method | null>(start ?? null);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState<ReceiptSkipReason | ''>('');
  const [note, setNote] = useState('');
  const [inked, setInked] = useState(false);
  const [photo, setPhoto] = useState<ReceiptPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ReceiptSummary | null>(null);
  // Confirmed elsewhere meanwhile: nothing more to record here.
  const [settled, setSettled] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);
  const file = useRef<HTMLInputElement>(null);
  const idem = useIdempotencyKey('receipt-confirmation');
  const onInk = useCallback((v: boolean) => setInked(v), []);

  // Without a PIN to use, signing is where they start.
  const noPin = !!signer && (signer.pinSet === false || locked);
  const shown: Method = method ?? (noPin ? 'SIGN' : 'PIN');

  const firstName = (name: string) => name.split(' ')[0] ?? name;
  const first = firstName(signer?.name ?? slip.recipientName ?? 'them');
  const forThing = !holdsPin(slip.recipientType);
  const loan = slip.kind === 'LOAN';
  const canSkip = !later && mode !== 'require';

  // Closing without recording: Skip when the setting is Ask, Cancel when opened later.
  const dismiss = () => {
    if (busy) return;
    if (done) onClose(done);
    else if (later || canSkip || settled) onClose(null);
  };

  async function send(body: Record<string, unknown>, handle: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      // The key is for this confirmation, without the PIN or the image, so neither is kept in the browser.
      const receipt = await api.post<ReceiptSummary>(`/slips/${encodeURIComponent(slip.id)}/confirmation`, body, { idempotencyKey: idem.keyFor({ slipId: slip.id, ...handle }) });
      idem.confirm();
      setDone(receipt);
    } catch (err) {
      idem.resolve(err);
      const e = err as ApiError;
      setPin('');
      if (e.code === 'PIN_LOCKED' && signer) { setLockedNow((s) => new Set(s).add(signer.id)); setMethod('SIGN'); }
      if (e.code === 'ALREADY_CONFIRMED') setSettled(true);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmPin(value: string) {
    if (!signerId) return;
    void send({ method: 'PIN', signerId, pin: value }, { method: 'PIN', signerId });
  }
  function confirmSignature() {
    const data = pad.current?.toBase64();
    if (!signerId || !data) return;
    void send({ method: 'SIGNATURE', signerId, image: { contentType: 'image/png', data } }, { method: 'SIGNATURE', signerId, image: imageHandle(data) });
  }
  function confirmPaper() {
    if (!signerId || !photo) return;
    void send({ method: 'PAPER', signerId, image: { contentType: photo.contentType, data: photo.data } }, { method: 'PAPER', signerId, image: imageHandle(photo.data) });
  }
  function saveReason() {
    if (!reason) return;
    const text = note.trim();
    void send({ method: 'NONE', reason, ...(text ? { note: text } : {}) }, { method: 'NONE', reason, note: text });
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { setPhoto(await readReceiptPhoto(f)); setError(null); } catch (err) { setError((err as Error).message); }
  }

  const title = done
    ? done.method === 'NONE' ? 'Saved as not confirmed' : `Thank you, ${firstName(done.signerName ?? first)}`
    : start === 'PAPER' ? 'Attach the signed paper slip'
      : later ? `Confirm receipt: ${slip.recipientName ?? 'slip'}`
        : forThing ? `Who is collecting for ${slip.recipientName ?? 'this'}?`
          : `${slip.recipientName ?? 'Recipient'}, check what you’re ${loan ? 'borrowing' : 'taking'}`;
  const description = done ? undefined : later || start ? undefined : `${loan ? 'Checked out' : 'Issued'}: stock has left the shelf. Confirming proves the hand-over and doesn’t change stock.`;

  const reasonOk = !!reason && (!NOTE_REASONS.includes(reason) || !!note.trim());

  return (
    <Modal open onClose={dismiss} title={title} description={description} size="md" footer={done ? (
      <Button variant="primary" onClick={() => onClose(done)} autoFocus>Done</Button>
    ) : (
      <>
        {settled && <Button variant="primary" onClick={() => onClose(null)}>Close</Button>}
        {!settled && canSkip && <Button variant="ghost" onClick={() => onClose(null)} disabled={busy}>Skip</Button>}
        {!settled && later && <Button variant="ghost" onClick={() => onClose(null)} disabled={busy}>Cancel</Button>}
        {!settled && shown === 'SIGN' && <Button variant="primary" onClick={confirmSignature} disabled={!inked || !signerId} loading={busy}>Confirm receipt</Button>}
        {!settled && shown === 'PAPER' && <Button variant="primary" onClick={confirmPaper} disabled={!photo || !signerId} loading={busy}>Attach and confirm</Button>}
        {!settled && shown === 'NONE' && <Button variant="primary" onClick={saveReason} disabled={!reasonOk} loading={busy}>Save without confirming</Button>}
      </>
    )}>
      {done ? (
        <div className="py-4 text-center space-y-2">
          <div className={cn('mx-auto h-12 w-12 rounded-full grid place-items-center text-2xl', done.method === 'NONE' ? 'bg-warning-50 text-warning-700' : 'bg-success-50 text-success-700')} aria-hidden="true">
            {done.method === 'NONE' ? '!' : '✓'}
          </div>
          <p className="text-sm text-surface-600 max-w-sm mx-auto">
            {done.method === 'NONE'
              ? 'The slip shows Not confirmed on Issued stock, where it can be confirmed later.'
              : 'The slip is confirmed. You can hand the screen back.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md border border-surface-200 text-sm" aria-label="On this slip">
            {slip.lines.map((l) => (
              <div key={l.key} className="flex justify-between gap-3 px-3 py-2 border-b border-surface-100">
                <span><span className="text-mono text-xs">{l.sku}</span> {l.name}</span>
                <b className="font-mono tabular-nums whitespace-nowrap">{l.quantity} {l.unit}</b>
              </div>
            ))}
            <div className="px-3 py-1.5 text-meta">{slip.note}</div>
          </div>

          {(forThing || (start === 'PAPER' && !own)) && (
            <Field label={forThing ? 'Collected by' : 'Signed by'} htmlFor="handover-who" required help={forThing ? 'Only a person can confirm. The slip will say who collected.' : undefined}>
              <Select id="handover-who" value={signerId} onChange={(e) => { setSignerId(e.target.value); setPin(''); setError(null); }} disabled={people.loading}>
                <option value="">— choose —</option>
                {everyone.filter((p) => holdsPin(p.type)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
          )}

          {shown === 'PAPER' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                {photo
                  ? <img src={photo.preview} alt="The photo chosen" className="h-24 rounded border border-surface-200 bg-white object-contain" />
                  : <span className="text-sm text-surface-500">No photo chosen.</span>}
                <Button size="sm" onClick={() => file.current?.click()}>{photo ? 'Choose another' : 'Choose photo'}</Button>
                <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Photo of the signed slip" onChange={pick} />
              </div>
              <p className="text-xs text-surface-500">Recorded as a paper confirmation, dated now. The slip shows it was signed on paper.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 rounded-md bg-surface-100 p-1" role="group" aria-label={`How ${first} confirms`}>
                {([['PIN', 'Enter PIN'], ['SIGN', 'Sign'], ['NONE', 'Not now']] as const).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={shown === m}
                    onClick={() => { setMethod(m); setPin(''); setError(null); }}
                    className={cn('rounded px-2 py-1.5 text-sm font-medium', shown === m ? 'bg-surface-0 text-surface-900 shadow-sm' : 'text-surface-600')}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {!signer ? (
                <p className="text-sm text-surface-500 text-center">Choose who is collecting first.</p>
              ) : shown === 'PIN' ? (
                noPin ? (
                  <Alert tone={locked ? 'danger' : 'info'} title={locked ? `${signer.name}’s PIN is locked` : `${signer.name} has no PIN yet`}>
                    {locked ? 'Too many wrong tries. They can sign instead, and a store controller can unlock it on Recipients.' : 'They can sign instead. A store controller can set one on Recipients.'}
                  </Alert>
                ) : (
                  <PinPad value={pin} onChange={setPin} onSubmit={confirmPin} disabled={busy} label={`${signer.name}, enter your PIN`} />
                )
              ) : shown === 'SIGN' ? (
                <div className="space-y-2">
                  <SignaturePad ref={pad} signer={signer.name} onInk={onInk} key={signer.id} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-surface-500">Signing confirms you took the items above.</span>
                    <Button size="sm" variant="ghost" onClick={() => pad.current?.clear()}>Clear</Button>
                  </div>
                </div>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-surface-700 mb-1">Why isn’t it confirmed?</legend>
                  {SKIP_REASONS.map((r) => (
                    <label key={r.value} className={cn('flex gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer', reason === r.value ? 'border-brand-500 bg-brand-50' : 'border-surface-200')}>
                      <input type="radio" name="handover-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="mt-0.5" />
                      <span>{r.label}{r.help && <span className="block text-xs text-surface-500">{r.help}</span>}</span>
                    </label>
                  ))}
                  {reason && NOTE_REASONS.includes(reason) && (
                    <Field label={reason === 'DISPUTED' ? 'What do they say is wrong?' : 'What happened?'} htmlFor="handover-note" required>
                      <Input id="handover-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                    </Field>
                  )}
                  {mode === 'require' && <p className="text-xs text-surface-500">Receipt confirmation is Required, so a reason is needed. The slip is listed as not confirmed until someone confirms it.</p>}
                </fieldset>
              )}
            </>
          )}

          {error && <Alert tone="danger" title="Not confirmed yet">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}
