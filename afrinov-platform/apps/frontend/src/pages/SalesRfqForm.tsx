// The Sales RFQ form, the "Costing: Sales Rep." step of the RFQ Process Flow:
// what is being priced and for whom, the production labour (each role's hours
// at its listed rate), the material (one supplier's quote on each of the
// project's Procurement RFQs, starting on the one Procurement recommends), the
// markup and delivery, and the quotation's conditions. The price is shown as it is typed; the server works out the
// figures that are kept (sales-costing.ts).
//
// New and Edit share it; only a draft is edited. Saving opens the Sales RFQ,
// where it is submitted to the Director.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Alert } from '../components/Alert';
import { Icon } from '../components/Icon';
import { Skeleton } from '../components/Skeleton';
import { ErrorState } from '../components/EmptyState';
import { NoAccess } from '../components/NoAccess';
import { useToast } from '../components/Toast';
import { api, type ApiError } from '../api/client';
import { usePermissions } from '../hooks/usePermissions';
import { formatMoney } from '../lib/poMoney';
import { Badge } from '../components/Badge';
import { amountDecimals as decimals, costingPreview, defaultQuote, parseAmount, type LabourRate, type SalesQuoteOption, type SalesRfq } from '../lib/salesRfq';

const RFQS = { label: 'Sales RFQs', to: '/sales-rfqs' };

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string; client?: string | null }

/** A labour line being typed. `key` stays with the line as others are added or removed. */
interface DraftLabour { key: number; labourRateId: string; hours: string }
let nextKey = 1;
const blankLabour = (): DraftLabour => ({ key: nextKey++, labourRateId: '', hours: '' });

/** The quotes a saved draft counts, by Procurement RFQ. */
const keptPicks = (rfq?: SalesRfq): Record<string, string> => Object.fromEntries((rfq?.materials ?? []).map((m) => [m.rfqId, m.supplierId]));

export function NewSalesRfq() {
  if (!usePermissions().hasPermission('sales:manage')) {
    return <NoAccess title="New Sales RFQ" action="raise Sales RFQs" section={RFQS} />;
  }
  return <SalesRfqFormPage />;
}

export function EditSalesRfq() {
  const { id } = useParams<{ id: string }>();
  const allowed = usePermissions().hasPermission('sales:manage');
  const rfq = useApi<SalesRfq>(id && allowed ? `/sales-rfqs/${id}` : null);
  if (!allowed) return <NoAccess title="Edit Sales RFQ" action="edit Sales RFQs" section={RFQS} />;
  if (rfq.error) return <ErrorState error={rfq.error} onRetry={rfq.reload} />;
  if (!rfq.data) return <div className="surface-card p-6 h-72"><Skeleton h={240} /></div>;
  if (rfq.data.status !== 'DRAFT') {
    return (
      <div>
        <PageHeader title={`Edit ${rfq.data.number}`} breadcrumb={[RFQS, { label: rfq.data.number, to: `/sales-rfqs/${rfq.data.id}` }, { label: 'Edit' }]} />
        <Alert tone="info" title="Only a draft is edited" className="max-w-2xl">
          {rfq.data.status === 'PENDING_APPROVAL' ? 'It is with the Director. They can send it back to you to change.' : 'It is no longer a draft.'}{' '}
          <Link to={`/sales-rfqs/${rfq.data.id}`} className="btn-link">Back to {rfq.data.number}</Link>
        </Alert>
      </div>
    );
  }
  return <SalesRfqFormPage rfq={rfq.data} />;
}

/** Raises a draft, or edits one. A failed save leaves the form as it was typed. */
function SalesRfqFormPage({ rfq }: { rfq?: SalesRfq }) {
  const navigate = useNavigate();
  const toast = useToast();
  const projectsReq = useApi<ProjectOpt[]>('/projects?active=true');
  const ratesReq = useApi<LabourRate[]>('/labour-rates');
  const vatReq = useApi<Record<string, unknown>>(rfq ? null : '/settings/values?keys=purchaseOrders.vatRate');

  const [project, setProject] = useState(rfq?.projectNumber ?? '');
  const [equipment, setEquipment] = useState(rfq?.equipment ?? '');
  const [description, setDescription] = useState(rfq?.description ?? '');
  const [clientName, setClientName] = useState(rfq?.clientName ?? '');
  const [clientAddress, setClientAddress] = useState(rfq?.clientAddress ?? '');
  const [contactName, setContactName] = useState(rfq?.contactName ?? '');
  const [clientReference, setClientReference] = useState(rfq?.clientReference ?? '');
  const [closingDate, setClosingDate] = useState(rfq?.closingDate?.slice(0, 10) ?? '');
  const [labour, setLabour] = useState<DraftLabour[]>(() => (rfq?.labour.length
    ? rfq.labour.map((l) => ({ key: nextKey++, labourRateId: l.labourRateId, hours: String(Number(l.hours)) }))
    : [blankLabour()]));
  /** The quote counted on each Procurement RFQ ticked: its supplier, by RFQ. */
  const [picks, setPicks] = useState<Record<string, string>>(() => keptPicks(rfq));
  const [markup, setMarkup] = useState(rfq?.markupPercent !== null && rfq?.markupPercent !== undefined ? String(Number(rfq.markupPercent)) : '');
  const [delivery, setDelivery] = useState(rfq ? String(Number(rfq.deliveryPrice)) : '0');
  const [paymentTerms, setPaymentTerms] = useState(rfq?.paymentTerms ?? '');
  const [validity, setValidity] = useState(rfq?.validity ?? '');
  const [deliveryDuration, setDeliveryDuration] = useState(rfq?.deliveryDuration ?? '');
  const [deliveryTerms, setDeliveryTerms] = useState(rfq?.deliveryTerms ?? '');
  const [signerPhone, setSignerPhone] = useState(rfq?.signerPhone ?? '');
  const [signerEmail, setSignerEmail] = useState(rfq?.signerEmail ?? '');
  const [notes, setNotes] = useState(rfq?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const quotesReq = useApi<SalesQuoteOption[]>(project ? `/sales-rfqs/quote-options?projectNumber=${encodeURIComponent(project)}` : null);

  const projects = (projectsReq.data ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  const projectOptions = project && !projects.some((p) => p.projectNumber === project) ? [...projects, { projectNumber: project, name: null }] : projects;
  const rates = ratesReq.data ?? [];
  // A role made inactive since it was put on this draft stays offered on its line.
  const offered = (current: string) => rates.filter((r) => r.active || r.id === current);
  const rateOf = (id: string) => rates.find((r) => r.id === id) ?? null;
  const options = quotesReq.data ?? [];
  // A chosen quote whose RFQ is no longer offered (since cancelled), at its last amount.
  const missing = rfq?.materials.filter((m) => picks[m.rfqId] && !options.some((o) => o.id === m.rfqId)) ?? [];
  const pickedQuote = (o: SalesQuoteOption) => o.quotes.find((q) => q.supplierId === picks[o.id]) ?? null;

  function chooseProject(next: string) {
    // Quotes are the project's: another project's can't stay chosen.
    if (next !== project) setPicks(rfq && next === rfq.projectNumber ? keptPicks(rfq) : {});
    setProject(next);
    if (!rfq && !clientName.trim()) {
      const client = projects.find((p) => p.projectNumber === next)?.client;
      if (client) setClientName(client);
    }
  }
  function updateLabour(key: number, patch: Partial<DraftLabour>) { setLabour((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); }
  /** Ticking an RFQ starts from Procurement's recommended quote, or the lowest. */
  function toggleRfq(o: Pick<SalesQuoteOption, 'id' | 'quotes'>) {
    setPicks((p) => {
      const next = { ...p };
      if (next[o.id]) delete next[o.id];
      else {
        const start = defaultQuote(o);
        if (start) next[o.id] = start.supplierId;
      }
      return next;
    });
  }
  function untick(rfqId: string) { setPicks((p) => { const next = { ...p }; delete next[rfqId]; return next; }); }

  const vatRate = Number(rfq?.totals.vatRate ?? vatReq.data?.['purchaseOrders.vatRate'] ?? 15);
  const typedLabour = labour.filter((l) => l.labourRateId || l.hours.trim());
  const preview = costingPreview({
    labour: typedLabour.flatMap((l) => {
      const hours = parseAmount(l.hours);
      const rate = rateOf(l.labourRateId);
      const kept = rfq?.labour.find((x) => x.labourRateId === l.labourRateId);
      const hourly = rate && (rate.active || !kept) ? Number(rate.hourlyRate) : kept ? Number(kept.hourlyRate) : null;
      return hours !== null && hourly !== null ? [{ hours, hourlyRate: hourly }] : [];
    }),
    materials: [
      ...options.flatMap((o) => { const q = pickedQuote(o); return q?.amount ? [Number(q.amount)] : []; }),
      ...missing.map((m) => Number(m.amount)),
    ],
    markupPercent: parseAmount(markup),
    deliveryPrice: parseAmount(delivery) ?? 0,
    vatRate,
  });

  async function save() {
    setValidation(null);
    if (!project) { setValidation('Choose the project this Sales RFQ is for.'); return; }
    const bad = typedLabour.findIndex((l) => {
      const h = parseAmount(l.hours);
      return !l.labourRateId || h === null || h <= 0 || decimals(l.hours) > 2;
    });
    if (bad >= 0) { setValidation(`Labour line ${bad + 1} needs a role and its hours, more than 0, to at most 2 decimal places.`); return; }
    const markupValue = markup.trim() ? parseAmount(markup) : null;
    if (markup.trim() && (markupValue === null || markupValue > 1000 || decimals(markup) > 2)) { setValidation('The markup is a percentage from 0 to 1000, to at most 2 decimal places.'); return; }
    const deliveryValue = delivery.trim() ? parseAmount(delivery) : 0;
    if (deliveryValue === null || decimals(delivery) > 2) { setValidation('The delivery price is in rand and cents, R0 or more.'); return; }
    const text = (v: string) => v.trim() || null;
    const body = {
      projectNumber: project,
      equipment: text(equipment),
      // Left blank on a new one, the server takes the project's name.
      description: description.trim() || (rfq ? null : undefined),
      clientName: text(clientName),
      clientAddress: text(clientAddress),
      contactName: text(contactName),
      clientReference: text(clientReference),
      closingDate: closingDate || null,
      labour: typedLabour.map((l) => ({ labourRateId: l.labourRateId, hours: parseAmount(l.hours)! })),
      materials: Object.entries(picks).map(([rfqId, supplierId]) => ({ rfqId, supplierId })),
      markupPercent: markupValue,
      deliveryPrice: deliveryValue,
      // Left blank on a new one, the server fills in the usual wording.
      ...(rfq || paymentTerms.trim() ? { paymentTerms: text(paymentTerms) } : {}),
      ...(rfq || validity.trim() ? { validity: text(validity) } : {}),
      ...(rfq || deliveryDuration.trim() ? { deliveryDuration: text(deliveryDuration) } : {}),
      ...(rfq || deliveryTerms.trim() ? { deliveryTerms: text(deliveryTerms) } : {}),
      signerPhone: text(signerPhone),
      ...(rfq || signerEmail.trim() ? { signerEmail: text(signerEmail) } : {}),
      notes: text(notes),
    };
    setBusy(true);
    try {
      const saved = rfq ? await api.patch<SalesRfq>(`/sales-rfqs/${rfq.id}`, body) : await api.post<SalesRfq>('/sales-rfqs', body);
      toast.success(rfq ? `${saved.number} saved` : `${saved.number} saved as a draft`);
      navigate(`/sales-rfqs/${saved.id}`);
    } catch (err) {
      const e = err as ApiError;
      setValidation(e.message);
      toast.error('Could not save the Sales RFQ', e.message);
    } finally { setBusy(false); }
  }

  if (ratesReq.error && !ratesReq.data) return <ErrorState error={ratesReq.error} onRetry={ratesReq.reload} />;

  const back = rfq ? `/sales-rfqs/${rfq.id}` : '/sales-rfqs';
  const money = (n: number | null) => (n === null ? '—' : formatMoney(n.toFixed(2)));
  return (
    <div>
      <PageHeader
        title={rfq ? `Edit ${rfq.number}` : 'New Sales RFQ'}
        description="Price one piece of equipment for the client. Save it as a draft, then submit it to the Director from its page."
        breadcrumb={rfq ? [RFQS, { label: rfq.number, to: back }, { label: 'Edit' }] : [RFQS, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start" noValidate>
        <div className="xl:col-span-2 surface-card p-5 space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">What is being priced</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Project" htmlFor="srfq-project" required help="Add it under Sales → Projects if it isn't listed.">
                <Select id="srfq-project" value={project} onChange={(e) => chooseProject(e.target.value)}>
                  <option value="" disabled>Choose the project…</option>
                  {projectOptions.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Equipment" htmlFor="srfq-equipment" help="The quotation's one line, e.g. Main Piston Pump. Needed to submit.">
                <Input id="srfq-equipment" maxLength={200} value={equipment} onChange={(e) => setEquipment(e.target.value)} />
              </Field>
              <Field label="Description" htmlFor="srfq-description" help={rfq ? 'For Sales and the Director; not on the quotation.' : "Left blank, it takes the project's name."}>
                <Input id="srfq-description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <Field label="Price due" htmlFor="srfq-closing" help="When the client wants the price by.">
                <Input id="srfq-closing" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset>
            <div className="flex items-center justify-between mb-2">
              <legend className="text-eyebrow">Production labour</legend>
              <Button size="sm" variant="secondary" type="button" onClick={() => setLabour((l) => [...l, blankLabour()])} leadingIcon={<Icon.Plus size={12} />}>Add role</Button>
            </div>
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem] gap-2 text-meta mb-1">
              <span>Role</span><span>Hours</span><span className="text-right">Rate / hour</span><span className="text-right">Total</span><span />
            </div>
            <div className="space-y-2">
              {labour.map((l, i) => {
                const rate = rateOf(l.labourRateId);
                const kept = rfq?.labour.find((x) => x.labourRateId === l.labourRateId);
                const hourly = rate && (rate.active || !kept) ? Number(rate.hourlyRate) : kept ? Number(kept.hourlyRate) : null;
                const hours = parseAmount(l.hours);
                return (
                  <div key={l.key} className="grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem] gap-2 items-start">
                    <div className="col-span-12 md:col-span-1">
                      <Select value={l.labourRateId} onChange={(e) => updateLabour(l.key, { labourRateId: e.target.value })} aria-label={`Labour line ${i + 1} role`}>
                        <option value="">{ratesReq.loading ? 'Loading roles…' : 'Choose a role…'}</option>
                        {offered(l.labourRateId).map((r) => <option key={r.id} value={r.id}>{r.role}{r.active ? '' : ' (no longer used)'}</option>)}
                      </Select>
                    </div>
                    <div className="col-span-4 md:col-span-1">
                      <Input inputMode="decimal" autoComplete="off" className="font-mono tabular-nums" placeholder="Hours" value={l.hours} onChange={(e) => updateLabour(l.key, { hours: e.target.value })} aria-label={`Labour line ${i + 1} hours`} />
                    </div>
                    <output className="col-span-3 md:col-span-1 py-2 text-sm text-right font-mono text-surface-600">{hourly === null ? '—' : formatMoney(hourly.toFixed(2))}</output>
                    <output className="col-span-3 md:col-span-1 py-2 text-sm text-right font-mono" aria-label={`Labour line ${i + 1} total`}>{hourly === null || hours === null ? '—' : formatMoney((Math.round(hours * hourly * 100) / 100).toFixed(2))}</output>
                    <div className="col-span-2 md:col-span-1 flex md:justify-center">
                      <Button size="sm" variant="ghost" type="button" onClick={() => setLabour((ls) => (ls.length === 1 ? [blankLabour()] : ls.filter((x) => x.key !== l.key)))} aria-label={`Remove labour line ${i + 1}`} leadingIcon={<Icon.Trash size={14} />} />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-meta mt-2">Priced at each role&rsquo;s selling rate on Production → Labour rates, as it is when you save.</p>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-eyebrow mb-1">Material</legend>
            <p className="text-meta">The quotes Procurement has on the project&rsquo;s RFQs. Tick each RFQ to count and choose one supplier&rsquo;s whole quote; it starts on the one Procurement recommends. Totals excl. VAT.</p>
            {!project && <p className="text-meta italic">Choose the project first.</p>}
            {project && quotesReq.error && <Alert tone="warning" title="The quotes could not be loaded">Reload the page to try again.</Alert>}
            {project && !quotesReq.loading && !quotesReq.error && options.length === 0 && missing.length === 0 && (
              <p className="text-meta italic">No requests for quotation sent for {project} yet. Procurement asks suppliers for prices; labour can be priced meanwhile.</p>
            )}
            <ul className="space-y-2" aria-label="Procurement quotes">
              {options.map((o) => {
                const others = o.salesRfqs.filter((s) => s.id !== rfq?.id);
                const picked = picks[o.id];
                const usable = o.quotes.some((q) => q.amount !== null);
                return (
                  <li key={o.id} className="rounded border border-surface-200">
                    <div className="flex items-start gap-3 px-3 py-2">
                      <input type="checkbox" id={`srfq-rfq-${o.id}`} className="mt-1 h-4 w-4" checked={!!picked} disabled={!picked && !usable} onChange={() => toggleRfq(o)} />
                      <label htmlFor={`srfq-rfq-${o.id}`} className="flex-1 min-w-0 text-sm">
                        <span className="text-mono">{o.number}</span>{o.description ? ` · ${o.description}` : ''}
                        {o.quotes.length === 0 && <span className="block text-meta">No quotes recorded yet.</span>}
                        {others.length > 0 && <span className="block text-meta text-warning-700">Also counted on {others.map((s) => s.number).join(', ')}</span>}
                      </label>
                      <span className="font-mono text-sm">{formatMoney(pickedQuote(o)?.amount ?? null)}</span>
                    </div>
                    {picked && (
                      <fieldset className="border-t border-surface-200 px-3 py-2 pl-10 space-y-1">
                        <legend className="sr-only">Quote counted on {o.number}</legend>
                        {o.quotes.map((q) => (
                          <label key={q.supplierId} className="flex items-start gap-2 text-sm">
                            <input type="radio" name={`srfq-quote-${o.id}`} className="mt-1" checked={picked === q.supplierId} disabled={q.amount === null}
                              onChange={() => setPicks((p) => ({ ...p, [o.id]: q.supplierId }))} aria-label={`${q.supplier} on ${o.number}`} />
                            <span className="flex-1 min-w-0">
                              {q.supplier}
                              {q.recommended && <Badge tone="success" className="ml-2">Recommended</Badge>}
                              {q.currency !== 'ZAR' && <span className="block text-meta">{formatMoney(q.total, q.currency)}{q.amount === null ? `: no exchange rate for ${q.currency} yet` : ', in rand at the exchange rate'}</span>}
                              {q.unpricedLines > 0 && <span className="block text-meta text-warning-700">{q.unpricedLines} line{q.unpricedLines === 1 ? '' : 's'} not priced</span>}
                            </span>
                            <span className="font-mono">{formatMoney(q.amount)}</span>
                          </label>
                        ))}
                        {o.recommendedSupplierId === null && <p className="text-meta">Procurement hasn&rsquo;t recommended a quote on this RFQ.</p>}
                      </fieldset>
                    )}
                  </li>
                );
              })}
              {missing.map((m) => (
                <li key={m.rfqId} className="flex items-start gap-3 rounded border border-surface-200 px-3 py-2">
                  <input type="checkbox" id={`srfq-rfq-${m.rfqId}`} className="mt-1 h-4 w-4" checked onChange={() => untick(m.rfqId)} />
                  <label htmlFor={`srfq-rfq-${m.rfqId}`} className="flex-1 text-sm"><span className="text-mono">{m.rfqNumber}</span> · {m.supplier}<span className="block text-meta text-danger-700">No longer out with suppliers: untick it to save.</span></label>
                  <span className="font-mono text-sm">{formatMoney(m.amount)}</span>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">Price</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Markup %" htmlFor="srfq-markup" help="On labour and material together, e.g. 40 for × 1.4. Needed to submit.">
                <Input id="srfq-markup" inputMode="decimal" autoComplete="off" className="font-mono" value={markup} onChange={(e) => setMarkup(e.target.value)} />
              </Field>
              <Field label="Delivery (R, excl. VAT)" htmlFor="srfq-delivery" help="Its own line on the quotation, with no markup.">
                <Input id="srfq-delivery" inputMode="decimal" autoComplete="off" className="font-mono" value={delivery} onChange={(e) => setDelivery(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">Client</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Client" htmlFor="srfq-client" help="Needed to submit. Taken from the project unless you change it.">
                <Input id="srfq-client" maxLength={200} value={clientName} onChange={(e) => setClientName(e.target.value)} />
              </Field>
              <Field label="Dear" htmlFor="srfq-contact" help="Who the letter greets, e.g. Bongi.">
                <Input id="srfq-contact" maxLength={200} value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </Field>
              <Field label="Address" htmlFor="srfq-address" help="One line per line of the address.">
                <Textarea id="srfq-address" rows={4} maxLength={1000} value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} />
              </Field>
              <Field label="Their reference" htmlFor="srfq-ref" help="Printed as Your Reference; N/A when blank.">
                <Input id="srfq-ref" maxLength={200} value={clientReference} onChange={(e) => setClientReference(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">Conditions</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Payment terms" htmlFor="srfq-payment" help={rfq ? undefined : 'Left blank: 30 days from invoice date.'}>
                <Input id="srfq-payment" maxLength={300} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
              </Field>
              <Field label="Validity" htmlFor="srfq-validity" help={rfq ? undefined : 'Left blank: 30 days from issue of quotation.'}>
                <Input id="srfq-validity" maxLength={300} value={validity} onChange={(e) => setValidity(e.target.value)} />
              </Field>
              <Field label="Delivery duration" htmlFor="srfq-duration" help={rfq ? undefined : 'Left blank: 2 - 4 weeks from date of receiving official order.'}>
                <Input id="srfq-duration" maxLength={300} value={deliveryDuration} onChange={(e) => setDeliveryDuration(e.target.value)} />
              </Field>
              <Field label="Delivery" htmlFor="srfq-terms" help={rfq ? undefined : 'Left blank: DAP and the client, e.g. DAP, Northam Platinum.'}>
                <Input id="srfq-terms" maxLength={300} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} />
              </Field>
              <Field label="Your phone" htmlFor="srfq-phone" help="Printed under your name.">
                <Input id="srfq-phone" maxLength={60} value={signerPhone} onChange={(e) => setSignerPhone(e.target.value)} />
              </Field>
              <Field label="Your email" htmlFor="srfq-email" help={rfq ? 'Printed under your name.' : 'Left blank: your sign-in email.'}>
                <Input id="srfq-email" type="email" maxLength={200} value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <Field label="Remarks" htmlFor="srfq-notes" help="For Sales and the Director; not on the quotation.">
            <Textarea id="srfq-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {validation && <Alert tone="danger" title="Cannot save">{validation}</Alert>}

          <div className="flex flex-wrap justify-end gap-2 pt-4 border-t border-surface-200">
            <Link to={back} className="btn-ghost">Cancel</Link>
            <Button variant="primary" type="submit" loading={busy}>{rfq ? 'Save changes' : 'Save draft'}</Button>
          </div>
        </div>

        <aside className="surface-card p-5 space-y-3 xl:sticky xl:top-4" aria-label="Price as typed">
          <h2 className="text-h3 text-surface-900">Price</h2>
          <dl className="text-sm space-y-2">
            {[
              ['Labour', preview.labour],
              ['Material', preview.material],
              ['Cost', preview.cost, true],
              ['Markup', preview.markup],
              [equipment.trim() || 'Equipment', preview.equipment, true],
              ['Delivery', parseAmount(delivery) ?? 0],
              ['Total excl. VAT', preview.totalExVat, true],
              [`VAT ${vatRate}%`, preview.vat],
              ['Total incl. VAT', preview.totalIncVat, true],
            ].map(([label, value, strong]) => (
              <div key={String(label)} className={`flex justify-between gap-3 ${strong ? 'font-semibold text-surface-900 border-t border-surface-200 pt-2' : ''}`}>
                <dt className={strong ? '' : 'text-surface-500'}>{label as string}</dt>
                <dd className="font-mono tabular-nums">{money(value as number | null)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-meta">As typed. The figures kept are worked out when you save, and fixed when it is submitted.</p>
        </aside>
      </form>
    </div>
  );
}
