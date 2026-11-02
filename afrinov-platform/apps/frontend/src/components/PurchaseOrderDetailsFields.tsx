// The order details from the AFRI-0000_x purchase order template's Inputs
// sheet: the supplier's contact and address, project, terms, settlement
// discount, penalties, the delivery block and the Afrinov contact. Shared by
// the new-order form and the Edit drawer.
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Field, Input, Select, Textarea } from './Field';
import { PAYMENT_TERM_SUGGESTIONS } from './SupplierForm';

export type DeliveryMethod = 'DELIVERY' | 'COLLECTION';

/** Form state: text as typed, so blank means "none". */
export interface OrderDetailsDraft {
  supplierContactName: string;
  supplierContactPhone: string;
  supplierContactEmail: string;
  supplierAddress: string;
  projectNumber: string;
  paymentTerms: string;
  paymentMilestone: string;
  settlementDiscount: string;
  shippingTerms: string;
  penaltiesApply: boolean;
  deliveryMethod: DeliveryMethod;
  deliveryTo: string;
  deliveryAddress: string;
  deliveryCountry: string;
  deliveryContactName: string;
  deliveryContactPhone: string;
  afrinovContact: string;
}

/** The fields as the server returns them on an order. */
export interface OrderDetails {
  supplierContactName?: string | null;
  supplierContactPhone?: string | null;
  supplierContactEmail?: string | null;
  supplierAddress?: string | null;
  projectNumber?: string | null;
  project?: { projectNumber: string; name?: string | null } | null;
  paymentTerms?: string | null;
  paymentMilestone?: string | null;
  settlementDiscount?: string | number | null;
  shippingTerms?: string | null;
  penaltiesApply?: boolean;
  deliveryMethod?: DeliveryMethod | string;
  deliveryTo?: string | null;
  deliveryAddress?: string | null;
  deliveryCountry?: string | null;
  deliveryContactName?: string | null;
  deliveryContactPhone?: string | null;
  afrinovContact?: string | null;
}

/** The supplier block: filled from the supplier, so blank means cleared, on a new order too. */
const SUPPLIER_KEYS = ['supplierContactName', 'supplierContactPhone', 'supplierContactEmail', 'supplierAddress'] as const;

const TEXT_KEYS = [
  'projectNumber', 'paymentTerms', 'paymentMilestone', 'shippingTerms', 'deliveryTo', 'deliveryAddress',
  'deliveryCountry', 'deliveryContactName', 'deliveryContactPhone', 'afrinovContact',
] as const;

/**
 * Builds editable details from the order's own values, with missing text blank,
 * a missing discount at 0%, and delivery unless the method is COLLECTION.
 */
export function draftFromOrder(po: OrderDetails): OrderDetailsDraft {
  return {
    supplierContactName: po.supplierContactName ?? '',
    supplierContactPhone: po.supplierContactPhone ?? '',
    supplierContactEmail: po.supplierContactEmail ?? '',
    supplierAddress: po.supplierAddress ?? '',
    projectNumber: po.projectNumber ?? '',
    paymentTerms: po.paymentTerms ?? '',
    paymentMilestone: po.paymentMilestone ?? '',
    settlementDiscount: String(Number(po.settlementDiscount ?? 0)),
    shippingTerms: po.shippingTerms ?? '',
    penaltiesApply: po.penaltiesApply ?? false,
    deliveryMethod: po.deliveryMethod === 'COLLECTION' ? 'COLLECTION' : 'DELIVERY',
    deliveryTo: po.deliveryTo ?? '',
    deliveryAddress: po.deliveryAddress ?? '',
    deliveryCountry: po.deliveryCountry ?? '',
    deliveryContactName: po.deliveryContactName ?? '',
    deliveryContactPhone: po.deliveryContactPhone ?? '',
    afrinovContact: po.afrinovContact ?? '',
  };
}

/** The supplier block as the supplier has it, for a new order or a change of supplier. */
export function supplierDetails(s: { contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null; address?: string | null } | undefined) {
  return {
    supplierContactName: s?.contactName ?? '',
    supplierContactPhone: s?.contactPhone ?? '',
    supplierContactEmail: s?.contactEmail ?? '',
    supplierAddress: s?.address ?? '',
  };
}

/**
 * Returns the first supplier email or settlement discount error, or null.
 * Both may be blank; a supplied discount must be finite and within 0–100%.
 */
export function checkDetails(d: OrderDetailsDraft): string | null {
  const email = d.supplierContactEmail.trim();
  // As the server: the rule a supplier's email is imported with, and the longest an email can be.
  if (email.length > 320) return 'The supplier email is longer than an email address can be (320 characters).';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return `The supplier email "${email}" is not an email address.`;
  const discount = Number(d.settlementDiscount);
  if (d.settlementDiscount.trim() !== '' && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
    return 'Settlement discount must be between 0 and 100.';
  }
  return null;
}

/**
 * Builds trimmed request fields. Blank supplier details always become null
 * to keep them cleared. Other blank text becomes undefined on create (for
 * server defaults) or null on edit. Collection clears the delivery recipient,
 * address and country the same way, keeping the delivery contact fields.
 * A blank settlement discount becomes 0%.
 */
export function detailsBody(d: OrderDetailsDraft, mode: 'create' | 'edit'): Record<string, unknown> {
  const blank = mode === 'create' ? undefined : null;
  const body: Record<string, unknown> = {};
  for (const k of TEXT_KEYS) body[k] = d[k].trim() || blank;
  for (const k of SUPPLIER_KEYS) body[k] = d[k].trim() || null;
  if (d.deliveryMethod === 'COLLECTION') {
    for (const k of ['deliveryTo', 'deliveryAddress', 'deliveryCountry'] as const) body[k] = blank;
  }
  body.settlementDiscount = d.settlementDiscount.trim() === '' ? 0 : Number(d.settlementDiscount);
  body.penaltiesApply = d.penaltiesApply;
  body.deliveryMethod = d.deliveryMethod;
  return body;
}

/**
 * The supplier's contact and address on this order, as the template's Inputs
 * sheet looks them up: filled from the supplier, and changed here for this
 * order only. Vendor code comes from the supplier and isn't changed here.
 */
export function SupplierDetailsFields({ value, onChange, idPrefix, supplier }: {
  value: OrderDetailsDraft;
  onChange: (next: OrderDetailsDraft) => void;
  idPrefix: string;
  supplier: { id: string; vendorCode?: string | null };
}) {
  const set = (k: (typeof SUPPLIER_KEYS)[number], v: string) => onChange({ ...value, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className="space-y-3">
      <p className="text-meta">
        From the supplier. Changes here are for this order only; to change them for good,{' '}
        <Link to={`/suppliers/${encodeURIComponent(supplier.id)}`} className="btn-link">edit the supplier</Link>.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Vendor code" htmlFor={id('vendor')} help="From the supplier.">
          <Input id={id('vendor')} value={supplier.vendorCode ?? ''} placeholder="None" readOnly disabled />
        </Field>
        <Field label="Contact person" htmlFor={id('contact')}>
          <Input id={id('contact')} value={value.supplierContactName} onChange={(e) => set('supplierContactName', e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor={id('phone')}>
          <Input id={id('phone')} type="tel" value={value.supplierContactPhone} onChange={(e) => set('supplierContactPhone', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor={id('email')}>
          <Input id={id('email')} type="email" value={value.supplierContactEmail} onChange={(e) => set('supplierContactEmail', e.target.value)} />
        </Field>
        <Field label="Supplier address" htmlFor={id('address')} className="md:col-span-4">
          <Textarea id={id('address')} rows={2} value={value.supplierAddress} onChange={(e) => set('supplierAddress', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}

interface ProjectOpt { projectNumber: string; name?: string | null; active: boolean; status?: string }

export function PurchaseOrderDetailsFields({ value, onChange, idPrefix, hideProject = false, requireProject = false }: {
  value: OrderDetailsDraft;
  onChange: (next: OrderDetailsDraft) => void;
  /** Keeps ids unique when two forms are open. */
  idPrefix: string;
  /** A Stores order has no project (Stores ordering roadmap), so no Project field. */
  hideProject?: boolean;
  /** Procurement buys for one project: the project must be chosen, and can't be cleared. */
  requireProject?: boolean;
}) {
  const projects = useApi<ProjectOpt[]>(hideProject ? null : '/projects?active=true');
  const set = <K extends keyof OrderDetailsDraft>(k: K, v: OrderDetailsDraft[K]) => onChange({ ...value, [k]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  // Nothing more is ordered for a completed or cancelled project.
  const options = (projects.data ?? []).filter((p) => p.status !== 'COMPLETED' && p.status !== 'CANCELLED');
  // An order on a project that has since closed still shows it.
  const listed = value.projectNumber && !options.some((p) => p.projectNumber === value.projectNumber)
    ? [...options, { projectNumber: value.projectNumber, name: null, active: false }]
    : options;

  return (
    <>
      <fieldset className="space-y-3">
        <legend className="text-eyebrow mb-1">Order information</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!hideProject && (
            <Field
              label="Project"
              htmlFor={id('project')}
              required={requireProject}
              // The order says which project its material is for; no line fixes it (Project on the Order Roadmap, Phase 2).
              help={requireProject ? 'Procurement buys for one project. Stores stock is ordered from Store → Order stock.' : 'Leave blank for general store stock.'}
            >
              <Select id={id('project')} value={value.projectNumber} onChange={(e) => set('projectNumber', e.target.value)}>
                <option value="" disabled={requireProject}>{requireProject ? 'Choose the project…' : 'No project'}</option>
                {listed.map((p) => <option key={p.projectNumber} value={p.projectNumber}>{p.projectNumber}{p.name ? ` — ${p.name}` : ''}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Payment terms" htmlFor={id('terms')} help="From the supplier.">
            <Input id={id('terms')} list={id('terms-list')} value={value.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} />
            <datalist id={id('terms-list')}>{PAYMENT_TERM_SUGGESTIONS.map((t) => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="Payment milestone" htmlFor={id('milestone')} help="e.g. 50% on order, 50% on delivery.">
            <Input id={id('milestone')} value={value.paymentMilestone} placeholder="N/A" onChange={(e) => set('paymentMilestone', e.target.value)} />
          </Field>
          <Field label="Settlement discount (%)" htmlFor={id('discount')}>
            <Input id={id('discount')} type="number" min="0" max="100" step="0.01" value={value.settlementDiscount} onChange={(e) => set('settlementDiscount', e.target.value)} />
          </Field>
          <Field label="Shipping terms" htmlFor={id('shipping')} help="e.g. Delivered to site, Ex works.">
            <Input id={id('shipping')} value={value.shippingTerms} onChange={(e) => set('shippingTerms', e.target.value)} />
          </Field>
          <Field label="Penalties" htmlFor={id('penalties')}>
            <Select id={id('penalties')} value={value.penaltiesApply ? 'yes' : 'no'} onChange={(e) => set('penaltiesApply', e.target.value === 'yes')}>
              <option value="no">No penalties applicable to this order</option>
              <option value="yes">Penalties apply to this order</option>
            </Select>
          </Field>
          <Field label="Afrinov contact" htmlFor={id('afrinov')} help="Who the supplier deals with at Afrinov.">
            <Input id={id('afrinov')} value={value.afrinovContact} onChange={(e) => set('afrinovContact', e.target.value)} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-eyebrow mb-1">Delivery information</legend>
        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Delivery or collection">
          {(['DELIVERY', 'COLLECTION'] as const).map((m) => (
            <label key={m} className="inline-flex items-center gap-2">
              <input type="radio" name={id('method')} value={m} checked={value.deliveryMethod === m} onChange={() => set('deliveryMethod', m)} />
              {m === 'DELIVERY' ? 'Delivery to address' : 'Collection by Afrinov'}
            </label>
          ))}
        </div>
        {value.deliveryMethod === 'DELIVERY' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Deliver to" htmlFor={id('to')}><Input id={id('to')} value={value.deliveryTo} onChange={(e) => set('deliveryTo', e.target.value)} /></Field>
            <Field label="Country" htmlFor={id('country')}><Input id={id('country')} value={value.deliveryCountry} onChange={(e) => set('deliveryCountry', e.target.value)} /></Field>
            <Field label="Address" htmlFor={id('address')} className="sm:col-span-2">
              <Textarea id={id('address')} rows={2} value={value.deliveryAddress} onChange={(e) => set('deliveryAddress', e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={value.deliveryMethod === 'DELIVERY' ? 'Contact at delivery address' : 'Contact for collection'} htmlFor={id('contact')}>
            <Input id={id('contact')} value={value.deliveryContactName} onChange={(e) => set('deliveryContactName', e.target.value)} />
          </Field>
          <Field label="Contact phone" htmlFor={id('phone')}>
            <Input id={id('phone')} value={value.deliveryContactPhone} onChange={(e) => set('deliveryContactPhone', e.target.value)} />
          </Field>
        </div>
      </fieldset>
    </>
  );
}
