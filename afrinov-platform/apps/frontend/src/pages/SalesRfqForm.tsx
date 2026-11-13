// The Sales RFQ form, the "Costing: Sales Rep." step of the RFQ Process Flow:
// what the job is and for whom, its equipment lines, the markup and delivery,
// and the quotation's conditions. Each equipment line is priced the same way,
// for one unit: the production labour (each role's hours at its listed rate),
// the material (one supplier's quote on each of the project's Procurement RFQs,
// starting on the one Procurement recommends; an RFQ counts on one line only)
// and other costs (accommodation, LOA), times the line's quantity. The price is
// shown as it is typed; the server works out the figures that are kept
// (sales-costing.ts).
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
import {
  amountDecimals as decimals, costingPreview, defaultQuote, parseAmount,
  type LabourRate, type PreviewLine, type SalesEquipmentLine, type SalesQuoteOption, type SalesRfq,
} from '../lib/salesRfq';

const RFQS = { label: 'Sales RFQs', to: '/sales-rfqs' };

/** At most this many equipment lines, as the server allows. */
const MAX_LINES = 20;

interface ProjectOpt { projectNumber: string; name?: string | null; status?: string; client?: string | null }

/** Rows being typed. `key` stays with a row as others are added, moved or removed. */
interface DraftLabour { key: number; labourRateId: string; hours: string }
interface DraftOther { key: number; description: string; quantity: string; unitCost: string }
interface DraftLine {
  key: number;
  equipment: string;
  details: string;
  quantity: string;
  labour: DraftLabour[];
  /** The quote counted on each Procurement RFQ ticked on this line: its supplier, by RFQ. */
  picks: Record<string, string>;
  other: DraftOther[];
}

let nextKey = 1;
const blankLabour = (): DraftLabour => ({ key: nextKey++, labourRateId: '', hours: '' });
const blankOther = (): DraftOther => ({ key: nextKey++, description: '', quantity: '1', unitCost: '' });
const blankLine = (): DraftLine => ({ key: nextKey++, equipment: '', details: '', quantity: '1', labour: [blankLabour()], picks: {}, other: [] });

/** The quotes a saved line counts, by Procurement RFQ. */
const keptPicks = (line?: Pick<SalesEquipmentLine, 'materials'>): Record<string, string> => Object.fromEntries((line?.materials ?? []).map((m) => [m.rfqId, m.supplierId]));

const fromSaved = (l: SalesEquipmentLine): DraftLine => ({
  key: nextKey++,
  equipment: l.equipment ?? '',
  details: l.details ?? '',
  quantity: String(l.quantity),
  labour: l.labour.length ? l.labour.map((x) => ({ key: nextKey++, labourRateId: x.labourRateId, hours: String(Number(x.hours)) })) : [blankLabour()],
  picks: keptPicks(l),
  other: l.otherCosts.map((c) => ({ key: nextKey++, description: c.description, quantity: String(Number(c.quantity)), unitCost: String(Number(c.unitCost)) })),
});

const typedLabourOf = (l: DraftLine) => l.labour.filter((x) => x.labourRateId || x.hours.trim());
const typedOtherOf = (l: DraftLine) => l.other.filter((c) => c.description.trim() || c.unitCost.trim());
/** A whole number, 0 or more (0: priced for the client to see, not charged); null otherwise. */
const wholeQuantity = (text: string) => (/^\s*\d+\s*$/.test(text) && Number(text) >= 0 && Number(text) <= 100000 ? Number(text) : null);

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
  const [description, setDescription] = useState(rfq?.description ?? '');
  const [clientName, setClientName] = useState(rfq?.clientName ?? '');
  const [clientAddress, setClientAddress] = useState(rfq?.clientAddress ?? '');
  const [contactName, setContactName] = useState(rfq?.contactName ?? '');
  const [clientReference, setClientReference] = useState(rfq?.clientReference ?? '');
  const [closingDate, setClosingDate] = useState(rfq?.closingDate?.slice(0, 10) ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => (rfq?.equipmentLines.length ? rfq.equipmentLines.map(fromSaved) : [blankLine()]));
  const [markup, setMarkup] = useState(rfq?.markupPercent !== null && rfq?.markupPercent !== undefined ? String(Number(rfq.markupPercent)) : '');
  const [delivery, setDelivery] = useState(rfq ? String(Number(rfq.deliveryPrice)) : '0');
  const [paymentTerms, setPaymentTerms] = useState(rfq?.paymentTerms ?? '');
  const [validity, setValidity] = useState(rfq?.validity ?? '');
  const [deliveryDuration, setDeliveryDuration] = useState(rfq?.deliveryDuration ?? '');
  const [deliveryTerms, setDeliveryTerms] = useState(rfq?.deliveryTerms ?? '');
  const [signerPhone, setSignerPhone] = useState(rfq?.signerPhone ?? '');
  const [signerEmail, setSignerEmail] = useState(rfq?.signerEmail ?? '');
  const [notes, setNotes] = useState(rfq?.notes ?? '');
  const [quoteNotes, setQuoteNotes] = useState(rfq?.quoteNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  const quotesReq = useApi<SalesQuoteOption[]>(project ? `/sales-rfqs/quote-options?projectNumber=${encodeURIComponent(project)}` : null);

  const projects = (projectsReq.data ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  const projectOptions = project && !projects.some((p) => p.projectNumber === project) ? [...projects, { projectNumber: project, name: null }] : projects;
  const rates = ratesReq.data ?? [];
  const options = quotesReq.data ?? [];
  const keptLabour = rfq?.equipmentLines.flatMap((l) => l.labour) ?? [];
  const rateOf = (id: string) => rates.find((r) => r.id === id) ?? null;
  /** The rate a labour row is priced at: today's, or the one it was saved at for a role since made inactive. */
  const hourlyOf = (labourRateId: string) => {
    const rate = rateOf(labourRateId);
    const kept = keptLabour.find((x) => x.labourRateId === labourRateId);
    return rate && (rate.active || !kept) ? Number(rate.hourlyRate) : kept ? Number(kept.hourlyRate) : null;
  };
  /** The equipment line an RFQ's quote is counted on, if any. */
  const lineCounting = (rfqId: string) => lines.findIndex((l) => !!l.picks[rfqId]);

  function chooseProject(next: string) {
    // Quotes are the project's: another project's can't stay chosen.
    if (next !== project) {
      setLines((ls) => ls.map((l, i) => ({ ...l, picks: rfq && next === rfq.projectNumber ? keptPicks(rfq.equipmentLines[i]) : {} })));
    }
    setProject(next);
    if (!rfq && !clientName.trim()) {
      const client = projects.find((p) => p.projectNumber === next)?.client;
      if (client) setClientName(client);
    }
  }
  const updateLine = (key: number, patch: (l: DraftLine) => Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch(l) } : l)));
  function moveLine(key: number, by: -1 | 1) {
    setLines((ls) => {
      const i = ls.findIndex((l) => l.key === key);
      const j = i + by;
      if (i < 0 || j < 0 || j >= ls.length) return ls;
      const next = [...ls];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  const vatRate = Number(rfq?.totals.vatRate ?? vatReq.data?.['purchaseOrders.vatRate'] ?? 15);
  /** A saved quote whose RFQ is no longer offered (since cancelled), at its last amount. */
  const missingOn = (line: DraftLine) => (rfq?.equipmentLines.flatMap((l) => l.materials) ?? []).filter((m) => line.picks[m.rfqId] && !options.some((o) => o.id === m.rfqId));
  const previewLine = (l: DraftLine): PreviewLine => ({
    quantity: wholeQuantity(l.quantity) ?? 1,
    labour: typedLabourOf(l).flatMap((x) => {
      const hours = parseAmount(x.hours);
      const hourly = hourlyOf(x.labourRateId);
      return hours !== null && hourly !== null ? [{ hours, hourlyRate: hourly }] : [];
    }),
    materials: [
      ...options.flatMap((o) => {
        const q = o.quotes.find((x) => x.supplierId === l.picks[o.id]);
        return q?.amount ? [Number(q.amount)] : [];
      }),
      ...missingOn(l).map((m) => Number(m.amount)),
    ],
    otherCosts: typedOtherOf(l).flatMap((c) => {
      const quantity = parseAmount(c.quantity);
      const unitCost = parseAmount(c.unitCost);
      return quantity !== null && unitCost !== null ? [{ quantity, unitCost }] : [];
    }),
  });
  const preview = costingPreview({ lines: lines.map(previewLine), markupPercent: parseAmount(markup), deliveryPrice: parseAmount(delivery) ?? 0, vatRate });

  /** What is wrong with the lines as typed, in words naming the line; null when they can be saved. */
  function linesProblem(): string | null {
    for (const [i, l] of lines.entries()) {
      const on = lines.length > 1 ? `Equipment line ${i + 1}: ` : '';
      if (wholeQuantity(l.quantity) === null) return `${on}the quantity is a whole number, 0 or more (0 prices it without charging it).`;
      const badLabour = typedLabourOf(l).findIndex((x) => {
        const h = parseAmount(x.hours);
        return !x.labourRateId || h === null || h <= 0 || decimals(x.hours) > 2;
      });
      if (badLabour >= 0) return `${on}labour line ${badLabour + 1} needs a role and its hours, more than 0, to at most 2 decimal places.`;
      const badOther = typedOtherOf(l).findIndex((c) => {
        const q = parseAmount(c.quantity);
        const u = parseAmount(c.unitCost);
        return !c.description.trim() || q === null || q <= 0 || decimals(c.quantity) > 2 || u === null || u <= 0 || decimals(c.unitCost) > 2;
      });
      if (badOther >= 0) return `${on}other cost ${badOther + 1} needs a description, a quantity more than 0 and a unit cost in rand and cents.`;
    }
    return null;
  }

  async function save() {
    setValidation(null);
    if (!project) { setValidation('Choose the project this Sales RFQ is for.'); return; }
    const problem = linesProblem();
    if (problem) { setValidation(problem.charAt(0).toUpperCase() + problem.slice(1)); return; }
    const markupValue = markup.trim() ? parseAmount(markup) : null;
    if (markup.trim() && (markupValue === null || markupValue > 1000 || decimals(markup) > 2)) { setValidation('The markup is a percentage from 0 to 1000, to at most 2 decimal places.'); return; }
    const deliveryValue = delivery.trim() ? parseAmount(delivery) : 0;
    if (deliveryValue === null || decimals(delivery) > 2) { setValidation('The delivery price is in rand and cents, R0 or more.'); return; }
    const text = (v: string) => v.trim() || null;
    const body = {
      projectNumber: project,
      // Left blank on a new one, the server takes the project's name.
      description: description.trim() || (rfq ? null : undefined),
      clientName: text(clientName),
      clientAddress: text(clientAddress),
      contactName: text(contactName),
      clientReference: text(clientReference),
      closingDate: closingDate || null,
      equipmentLines: lines.map((l) => ({
        equipment: text(l.equipment),
        details: text(l.details),
        quantity: wholeQuantity(l.quantity)!,
        labour: typedLabourOf(l).map((x) => ({ labourRateId: x.labourRateId, hours: parseAmount(x.hours)! })),
        materials: Object.entries(l.picks).map(([rfqId, supplierId]) => ({ rfqId, supplierId })),
        otherCosts: typedOtherOf(l).map((c) => ({ description: c.description.trim(), quantity: parseAmount(c.quantity)!, unitCost: parseAmount(c.unitCost)! })),
      })),
      markupPercent: markupValue,
      deliveryPrice: deliveryValue,
      // Left blank on a new one, the server fills in the usual wording.
      ...(rfq || paymentTerms.trim() ? { paymentTerms: text(paymentTerms) } : {}),
      ...(rfq || validity.trim() ? { validity: text(validity) } : {}),
      ...(rfq || deliveryDuration.trim() ? { deliveryDuration: text(deliveryDuration) } : {}),
      ...(rfq || deliveryTerms.trim() ? { deliveryTerms: text(deliveryTerms) } : {}),
      signerPhone: text(signerPhone),
      ...(rfq || signerEmail.trim() ? { signerEmail: text(signerEmail) } : {}),
      quoteNotes: text(quoteNotes),
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
        description="Price the job for the client, one equipment line at a time. Save it as a draft, then submit it to the Director from its page."
        breadcrumb={rfq ? [RFQS, { label: rfq.number, to: back }, { label: 'Edit' }] : [RFQS, { label: 'New' }]}
      />
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start" noValidate>
        <div className="xl:col-span-2 surface-card p-5 space-y-6">
          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">The job</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Project" htmlFor="srfq-project" required help="Add it under Sales → Projects if it isn't listed.">
                <Select id="srfq-project" value={project} onChange={(e) => chooseProject(e.target.value)}>
                  <option value="" disabled>Choose the project…</option>
                  {projectOptions.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
                </Select>
              </Field>
              <Field label="Price due" htmlFor="srfq-closing" help="When the client wants the price by.">
                <Input id="srfq-closing" type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
              </Field>
              <Field label="Description" htmlFor="srfq-description" help={rfq ? 'For Sales and the Director; not on the quotation.' : "For Sales and the Director; not on the quotation. Left blank, it takes the project's name."}>
                <Input id="srfq-description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
            </div>
          </fieldset>

          <section className="space-y-4" aria-label="Equipment lines">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-eyebrow">Equipment lines</h2>
                <p className="text-meta">Each is a line on the quotation, priced from its own labour, quotes and other costs.</p>
              </div>
            </div>
            {lines.map((line, i) => (
              <EquipmentLineCard
                key={line.key}
                line={line}
                index={i}
                count={lines.length}
                project={project}
                rates={rates}
                ratesLoading={ratesReq.loading}
                options={options}
                optionsLoading={quotesReq.loading}
                optionsError={!!quotesReq.error}
                missing={missingOn(line)}
                otherSalesRfqId={rfq?.id}
                hourlyOf={hourlyOf}
                lineCounting={lineCounting}
                priced={preview.lines[i]!}
                onChange={(patch) => updateLine(line.key, patch)}
                onMove={(by) => moveLine(line.key, by)}
                onRemove={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
              />
            ))}
            <Button
              variant="secondary" type="button" disabled={lines.length >= MAX_LINES}
              onClick={() => setLines((ls) => [...ls, blankLine()])} leadingIcon={<Icon.Plus size={12} />}
            >Add equipment line</Button>
          </section>

          <fieldset className="space-y-3">
            <legend className="text-eyebrow mb-1">Price</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Markup %" htmlFor="srfq-markup" help="On every equipment line, e.g. 40 for × 1.4. Needed to submit.">
                <Input id="srfq-markup" inputMode="decimal" autoComplete="off" className="font-mono" value={markup} onChange={(e) => setMarkup(e.target.value)} />
              </Field>
              <Field label="Delivery (R, excl. VAT)" htmlFor="srfq-delivery" help="Its own line on the quotation, with no markup. Left at R0, the quotation has no Delivery line.">
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
            <Field label="Notes on the quotation" htmlFor="srfq-quote-notes" help="Printed under the company's Notes, one per line, e.g. All Flexibles to be free issued by client.">
              <Textarea id="srfq-quote-notes" rows={2} maxLength={1000} value={quoteNotes} onChange={(e) => setQuoteNotes(e.target.value)} />
            </Field>
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
            {([
              ['Labour', preview.labour],
              ['Material', preview.material],
              ...(preview.other > 0 ? [['Other costs', preview.other]] : []),
              ['Cost', preview.cost, true],
              ['Markup', preview.markup],
              ...lines.map((l, i) => {
                const q = wholeQuantity(l.quantity) ?? 1;
                return [`${i + 1}. ${l.equipment.trim() || 'Equipment'}${q > 1 ? ` × ${q}` : q === 0 ? ' (not charged)' : ''}`, preview.lines[i]!.total];
              }),
              ...(lines.length > 1 ? [['Equipment lines', preview.equipment, true]] : []),
              ['Delivery', parseAmount(delivery) ?? 0],
              ['Total excl. VAT', preview.totalExVat, true],
              [`VAT ${vatRate}%`, preview.vat],
              ['Total incl. VAT', preview.totalIncVat, true],
            ] as Array<[string, number | null, boolean?]>).map(([label, value, strong], i) => (
              <div key={`${i}-${label}`} className={`flex justify-between gap-3 ${strong ? 'font-semibold text-surface-900 border-t border-surface-200 pt-2' : ''}`}>
                <dt className={`${strong ? '' : 'text-surface-500'} min-w-0 truncate`}>{label}</dt>
                <dd className="font-mono tabular-nums">{money(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-meta">As typed. The figures kept are worked out when you save, and fixed when it is submitted.</p>
        </aside>
      </form>
    </div>
  );
}

interface CardProps {
  line: DraftLine;
  index: number;
  count: number;
  project: string;
  rates: LabourRate[];
  ratesLoading: boolean;
  options: SalesQuoteOption[];
  optionsLoading: boolean;
  optionsError: boolean;
  missing: SalesEquipmentLine['materials'];
  otherSalesRfqId?: string;
  hourlyOf: (labourRateId: string) => number | null;
  lineCounting: (rfqId: string) => number;
  priced: { unitCost: number; unitPrice: number | null; total: number | null };
  onChange: (patch: (l: DraftLine) => Partial<DraftLine>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}

/** One equipment line: what the quotation prints for it, and what it costs for one unit. */
function EquipmentLineCard({
  line, index, count, project, rates, ratesLoading, options, optionsLoading, optionsError, missing, otherSalesRfqId,
  hourlyOf, lineCounting, priced, onChange, onMove, onRemove,
}: CardProps) {
  const n = index + 1;
  const name = count > 1 ? `equipment line ${n}` : 'the equipment line';
  const id = (part: string) => `srfq-line-${line.key}-${part}`;
  const quantity = wholeQuantity(line.quantity);
  // A role made inactive since it was put on this draft stays offered on its row.
  const offered = (current: string) => rates.filter((r) => r.active || r.id === current);
  const setLabour = (key: number, patch: Partial<DraftLabour>) => onChange((l) => ({ labour: l.labour.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  const setOther = (key: number, patch: Partial<DraftOther>) => onChange((l) => ({ other: l.other.map((x) => (x.key === key ? { ...x, ...patch } : x)) }));
  /** Ticking an RFQ starts from Procurement's recommended quote, or the lowest. */
  function toggleRfq(o: SalesQuoteOption) {
    onChange((l) => {
      const picks = { ...l.picks };
      if (picks[o.id]) delete picks[o.id];
      else {
        const start = defaultQuote(o);
        if (start) picks[o.id] = start.supplierId;
      }
      return { picks };
    });
  }
  const untick = (rfqId: string) => onChange((l) => { const picks = { ...l.picks }; delete picks[rfqId]; return { picks }; });
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v.toFixed(2)));

  return (
    <fieldset className="rounded-lg border border-surface-200 p-4 space-y-5" aria-label={`Equipment line ${n}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <legend className="text-h3 text-surface-900">Equipment line {n}</legend>
        {count > 1 && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" type="button" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move equipment line ${n} up`}>Up</Button>
            <Button size="sm" variant="ghost" type="button" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move equipment line ${n} down`}>Down</Button>
            <Button size="sm" variant="ghost" type="button" onClick={onRemove} aria-label={`Remove equipment line ${n}`} leadingIcon={<Icon.Trash size={14} />}>Remove</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Field label="Equipment" htmlFor={id('equipment')} help="The line on the quotation, e.g. Main Piston Pump or Installation. Needed to submit.">
          <Input id={id('equipment')} maxLength={200} value={line.equipment} onChange={(e) => onChange(() => ({ equipment: e.target.value }))} />
        </Field>
        <Field label="Qty" htmlFor={id('quantity')} help="Whole number. 0: priced, not charged.">
          <Input id={id('quantity')} inputMode="numeric" autoComplete="off" className="font-mono" value={line.quantity} onChange={(e) => onChange(() => ({ quantity: e.target.value }))} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="What it covers" htmlFor={id('details')} help="Printed under it on the quotation, one per line, e.g. Accommodation & LOA.">
            <Textarea id={id('details')} rows={3} maxLength={2000} value={line.details} onChange={(e) => onChange(() => ({ details: e.target.value }))} />
          </Field>
        </div>
      </div>
      {quantity !== null && quantity > 1 && <p className="text-meta">The hours, quotes and other costs below are for one unit; the line&rsquo;s price is that times {quantity}.</p>}
      {quantity === 0 && <p className="text-meta">Priced for the client to see, not charged: the quotation prints its unit price and R -, and it adds nothing to the total.</p>}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-eyebrow">Production labour</h3>
          <Button size="sm" variant="secondary" type="button" onClick={() => onChange((l) => ({ labour: [...l.labour, blankLabour()] }))} leadingIcon={<Icon.Plus size={12} />} aria-label={`Add role to ${name}`}>Add role</Button>
        </div>
        <div className="hidden md:grid grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem] gap-2 text-meta mb-1">
          <span>Role</span><span>Hours</span><span className="text-right">Rate / hour</span><span className="text-right">Total</span><span />
        </div>
        <div className="space-y-2">
          {line.labour.map((l, i) => {
            const hourly = hourlyOf(l.labourRateId);
            const hours = parseAmount(l.hours);
            const label = `${count > 1 ? `Line ${n} labour` : 'Labour line'} ${i + 1}`;
            return (
              <div key={l.key} className="grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_7rem_8rem_8rem_2.5rem] gap-2 items-start">
                <div className="col-span-12 md:col-span-1">
                  <Select value={l.labourRateId} onChange={(e) => setLabour(l.key, { labourRateId: e.target.value })} aria-label={`${label} role`}>
                    <option value="">{ratesLoading ? 'Loading roles…' : 'Choose a role…'}</option>
                    {offered(l.labourRateId).map((r) => <option key={r.id} value={r.id}>{r.role}{r.active ? '' : ' (no longer used)'}</option>)}
                  </Select>
                </div>
                <div className="col-span-4 md:col-span-1">
                  <Input inputMode="decimal" autoComplete="off" className="font-mono tabular-nums" placeholder="Hours" value={l.hours} onChange={(e) => setLabour(l.key, { hours: e.target.value })} aria-label={`${label} hours`} />
                </div>
                <output className="col-span-3 md:col-span-1 py-2 text-sm text-right font-mono text-surface-600">{hourly === null ? '—' : formatMoney(hourly.toFixed(2))}</output>
                <output className="col-span-3 md:col-span-1 py-2 text-sm text-right font-mono" aria-label={`${label} total`}>{hourly === null || hours === null ? '—' : formatMoney((Math.round(hours * hourly * 100) / 100).toFixed(2))}</output>
                <div className="col-span-2 md:col-span-1 flex md:justify-center">
                  <Button size="sm" variant="ghost" type="button" onClick={() => onChange((x) => ({ labour: x.labour.length === 1 ? [blankLabour()] : x.labour.filter((y) => y.key !== l.key) }))} aria-label={`Remove ${label.toLowerCase()}`} leadingIcon={<Icon.Trash size={14} />} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-meta mt-2">Priced at each role&rsquo;s selling rate on Production → Labour rates, as it is when you save.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-eyebrow">Material</h3>
        <p className="text-meta">The quotes Procurement has on the project&rsquo;s RFQs. Tick each RFQ to count on this line and choose one supplier&rsquo;s whole quote; it starts on the one Procurement recommends. An RFQ counts on one line only. Totals excl. VAT.</p>
        {!project && <p className="text-meta italic">Choose the project first.</p>}
        {project && optionsError && <Alert tone="warning" title="The quotes could not be loaded">Reload the page to try again.</Alert>}
        {project && !optionsLoading && !optionsError && options.length === 0 && missing.length === 0 && (
          <p className="text-meta italic">No requests for quotation sent for {project} yet. Procurement asks suppliers for prices; labour can be priced meanwhile.</p>
        )}
        <ul className="space-y-2" aria-label={`Procurement quotes for ${name}`}>
          {options.map((o) => {
            const others = o.salesRfqs.filter((s) => s.id !== otherSalesRfqId);
            const picked = line.picks[o.id];
            const elsewhere = lineCounting(o.id);
            const onAnother = !picked && elsewhere >= 0;
            const usable = o.quotes.some((q) => q.amount !== null);
            const pickedQuote = o.quotes.find((q) => q.supplierId === picked) ?? null;
            const box = id(`rfq-${o.id}`);
            return (
              <li key={o.id} className="rounded border border-surface-200">
                <div className="flex items-start gap-3 px-3 py-2">
                  <input type="checkbox" id={box} className="mt-1 h-4 w-4" checked={!!picked} disabled={onAnother || (!picked && !usable)} onChange={() => toggleRfq(o)} />
                  <label htmlFor={box} className="flex-1 min-w-0 text-sm">
                    <span className="text-mono">{o.number}</span>{o.description ? ` · ${o.description}` : ''}
                    {o.quotes.length === 0 && <span className="block text-meta">No quotes recorded yet.</span>}
                    {onAnother && <span className="block text-meta">Counted on equipment line {elsewhere + 1}</span>}
                    {others.length > 0 && <span className="block text-meta text-warning-700">Also counted on {others.map((s) => s.number).join(', ')}</span>}
                  </label>
                  <span className="font-mono text-sm">{formatMoney(pickedQuote?.amount ?? null)}</span>
                </div>
                {picked && (
                  <fieldset className="border-t border-surface-200 px-3 py-2 pl-10 space-y-1">
                    <legend className="sr-only">Quote counted on {o.number}</legend>
                    {o.quotes.map((q) => (
                      <label key={q.supplierId} className="flex items-start gap-2 text-sm">
                        <input type="radio" name={id(`quote-${o.id}`)} className="mt-1" checked={picked === q.supplierId} disabled={q.amount === null}
                          onChange={() => onChange((l) => ({ picks: { ...l.picks, [o.id]: q.supplierId } }))} aria-label={`${q.supplier} on ${o.number}`} />
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
              <input type="checkbox" id={id(`gone-${m.rfqId}`)} className="mt-1 h-4 w-4" checked onChange={() => untick(m.rfqId)} />
              <label htmlFor={id(`gone-${m.rfqId}`)} className="flex-1 text-sm"><span className="text-mono">{m.rfqNumber}</span> · {m.supplier}<span className="block text-meta text-danger-700">No longer out with suppliers: untick it to save.</span></label>
              <span className="font-mono text-sm">{formatMoney(m.amount)}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-eyebrow">Other costs</h3>
          <Button size="sm" variant="secondary" type="button" onClick={() => onChange((l) => ({ other: [...l.other, blankOther()] }))} leadingIcon={<Icon.Plus size={12} />} aria-label={`Add other cost to ${name}`}>Add cost</Button>
        </div>
        {line.other.length === 0
          ? <p className="text-meta">Accommodation, LOA, travel or hire: anything that is neither labour nor a supplier&rsquo;s quote.</p>
          : (
            <>
              <div className="hidden md:grid grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.5rem] gap-2 text-meta mb-1">
                <span>Cost</span><span>Quantity</span><span>Unit cost (R)</span><span className="text-right">Total</span><span />
              </div>
              <div className="space-y-2">
                {line.other.map((c, i) => {
                  const q = parseAmount(c.quantity);
                  const u = parseAmount(c.unitCost);
                  const label = `${count > 1 ? `Line ${n} other cost` : 'Other cost'} ${i + 1}`;
                  return (
                    <div key={c.key} className="grid grid-cols-12 md:grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.5rem] gap-2 items-start">
                      <div className="col-span-12 md:col-span-1">
                        <Input maxLength={200} placeholder="e.g. Accommodation" value={c.description} onChange={(e) => setOther(c.key, { description: e.target.value })} aria-label={`${label} description`} />
                      </div>
                      <div className="col-span-3 md:col-span-1">
                        <Input inputMode="decimal" autoComplete="off" className="font-mono tabular-nums" value={c.quantity} onChange={(e) => setOther(c.key, { quantity: e.target.value })} aria-label={`${label} quantity`} />
                      </div>
                      <div className="col-span-4 md:col-span-1">
                        <Input inputMode="decimal" autoComplete="off" className="font-mono tabular-nums" value={c.unitCost} onChange={(e) => setOther(c.key, { unitCost: e.target.value })} aria-label={`${label} unit cost`} />
                      </div>
                      <output className="col-span-3 md:col-span-1 py-2 text-sm text-right font-mono" aria-label={`${label} total`}>{q === null || u === null ? '—' : formatMoney((Math.round(q * u * 100) / 100).toFixed(2))}</output>
                      <div className="col-span-2 md:col-span-1 flex md:justify-center">
                        <Button size="sm" variant="ghost" type="button" onClick={() => onChange((x) => ({ other: x.other.filter((y) => y.key !== c.key) }))} aria-label={`Remove ${label.toLowerCase()}`} leadingIcon={<Icon.Trash size={14} />} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
      </div>

      <dl className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm border-t border-surface-200 pt-3" aria-label={`Price of ${name}`}>
        <div className="flex gap-2"><dt className="text-surface-500">Cost a unit</dt><dd className="font-mono">{money(priced.unitCost)}</dd></div>
        <div className="flex gap-2"><dt className="text-surface-500">Unit price</dt><dd className="font-mono">{money(priced.unitPrice)}</dd></div>
        <div className="flex gap-2 font-semibold"><dt>Total</dt><dd className="font-mono">{money(priced.total)}</dd></div>
      </dl>
    </fieldset>
  );
}
