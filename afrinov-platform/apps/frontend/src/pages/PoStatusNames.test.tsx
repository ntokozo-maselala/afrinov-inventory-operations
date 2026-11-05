// Names on the purchase order status bar: who moved the order into each step,
// from its Activity, and who the next step is waiting on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['PROCUREMENT'] } }) }));

const { PurchaseOrderDetail, shortName, stepActors, waitingOn } = await import('./PurchaseOrderDetail');
const { ToastProvider } = await import('../components/Toast');

const entry = (action: string, before: string | null, after: string, actorName: string | null, createdAt: string, actorId: string | null = 'u') => ({
  id: `${action}-${createdAt}`, action, entityId: 'po-1', entityType: 'PurchaseOrder', actorId, actorName,
  before: before ? { status: before } : null, after: { status: after }, createdAt,
});
const APPROVAL = { subtotal: '10.00', vat: '1.50', net: '11.50', unpricedLines: 0, currency: 'ZAR', canApprove: false, reason: null, randValue: '10.00', exchangeRate: null, noRate: false, steps: [], next: { step: 'MANAGER', label: 'Procurement Manager' } };

describe('shortName', () => {
  it('keeps the first name and the last initial', () => {
    expect(shortName('Thandi Mokoena')).toBe('Thandi M.');
    expect(shortName('Sipho van der Merwe')).toBe('Sipho M.');
    expect(shortName('Admin')).toBe('Admin');
  });
});

describe('stepActors', () => {
  it('names who moved the order into each step, the latest round winning', () => {
    const actors = stepActors([
      entry('CREATE', null, 'DRAFT', 'Lindiwe Dube', '2026-10-01T08:00:00Z'),
      entry('PO_SUBMIT', 'DRAFT', 'PENDING_APPROVAL', 'Lindiwe Dube', '2026-10-01T09:00:00Z'),
      entry('PO_APPROVE', 'PENDING_APPROVAL', 'APPROVED', 'Thandi Mokoena', '2026-10-02T09:00:00Z'),
      // Edited past the limit: back for approval, then approved again by someone else.
      entry('UPDATE', 'APPROVED', 'PENDING_APPROVAL', 'Lindiwe Dube', '2026-10-03T09:00:00Z'),
      entry('PO_APPROVE', 'PENDING_APPROVAL', 'APPROVED', 'Sipho Nkosi', '2026-10-04T09:00:00Z'),
      entry('PO_GOODS_RECEIVED', 'APPROVED', 'PARTIALLY_RECEIVED', 'Bongani Zulu', '2026-10-05T09:00:00Z'),
      // A second part delivery stays Partly received: the step keeps who started it.
      entry('PO_GOODS_RECEIVED', 'PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED', 'Nomsa Khumalo', '2026-10-06T09:00:00Z'),
    ].reverse());
    expect(actors.DRAFT?.label).toMatch(/^Lindiwe D\. · /);
    expect(actors.APPROVED?.label).toMatch(/^Sipho N\. · /);
    expect(actors.APPROVED?.title).toMatch(/^Sipho Nkosi, /);
    expect(actors.PARTIALLY_RECEIVED?.label).toMatch(/^Bongani Z\. · /);
    expect(actors.RECEIVED).toBeUndefined();
  });

  it('says when the account is gone, or the system did it', () => {
    const actors = stepActors([
      entry('CREATE', null, 'DRAFT', null, '2026-10-01T08:00:00Z', 'gone'),
      entry('PO_SUBMIT', 'DRAFT', 'PENDING_APPROVAL', null, '2026-10-01T09:00:00Z', null),
    ]);
    expect(actors.DRAFT?.label).toMatch(/^A removed user · /);
    expect(actors.PENDING_APPROVAL?.label).toMatch(/^System · /);
  });
});

describe('waitingOn', () => {
  const approvers = (...names: string[]) => names.map((name, i) => ({ id: `a${i}`, name, standIn: false }));

  it('names the usual signers of the next signature', () => {
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: approvers('Thandi Mokoena', 'Sipho Nkosi') }))
      .toEqual({ step: 'APPROVED', person: { label: 'Waiting on Thandi M. or Sipho N.', title: 'Procurement Manager. Any of: Thandi Mokoena, Sipho Nkosi', waiting: true } });
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: approvers('Thandi Mokoena', 'Sipho Nkosi', 'Ayanda Mthembu') })!.person.label).toBe('Waiting on Thandi M. +2');
  });

  it('leaves stand-ins to the title when a usual signer holds the role', () => {
    const shown = waitingOn('PENDING_APPROVAL', { ...APPROVAL, next: { step: 'DIRECTOR', label: 'Director' }, approvers: [{ id: 'd', name: 'Sipho Nkosi', standIn: false }, { id: 'c', name: 'Chief Executive', standIn: true }] })!.person;
    expect(shown).toMatchObject({ label: 'Waiting on Sipho N.', title: 'Director. Any of: Sipho Nkosi, Chief Executive' });
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: [{ id: 'c', name: 'Chief Executive', standIn: true }] })!.person.label).toBe('Waiting on Chief E.');
  });

  it('says why no one can approve yet', () => {
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, unpricedLines: 1, approvers: [] })!.person.label).toBe('Needs prices');
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: [] })!.person).toMatchObject({ label: 'No approver', title: 'Nobody holds the Procurement Manager role yet' });
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, noRate: true, currency: 'USD', approvers: [] })!.person.label).toBe('Needs a rate');
  });

  it('waits on the store for a delivery, and on no one once received', () => {
    expect(waitingOn('APPROVED', null)).toMatchObject({ step: 'PARTIALLY_RECEIVED', person: { label: 'Waiting on Stores' } });
    expect(waitingOn('PARTIALLY_RECEIVED', null)).toMatchObject({ step: 'RECEIVED' });
    expect(waitingOn('RECEIVED', null)).toBeNull();
    expect(waitingOn('DRAFT', null)).toBeNull();
  });
});

describe('the status bar on an order', () => {
  beforeEach(() => {
    mockGet.mockReset().mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return {
        id: 'po-1', number: 'AFRI-0005', status: 'PENDING_APPROVAL', supplierId: 's-1', supplier: { name: 'Local Steel Supplies' }, projectNumber: 'AFRI-1325',
        createdAt: '2026-10-01T08:00:00Z', currency: 'ZAR', vatRate: '15', lines: [],
        totals: { subtotal: '10.00', vat: '1.50', net: '11.50', unpricedLines: 0 },
      };
      if (path === '/purchase-orders/po-1/history') return [
        entry('PO_SUBMIT', 'DRAFT', 'PENDING_APPROVAL', 'Lindiwe Dube', '2026-10-01T09:00:00Z'),
        entry('CREATE', null, 'DRAFT', 'Lindiwe Dube', '2026-10-01T08:00:00Z'),
      ];
      if (path === '/purchase-orders/po-1/approval') return { ...APPROVAL, approvers: [{ id: 'a1', name: 'Thandi Mokoena', standIn: false }] };
      return [];
    });
  });

  it('shows who did each step so far, and who approval is waiting on', async () => {
    render(
      <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
        <ToastProvider>
          <Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const bar = await screen.findByRole('list', { name: 'Purchase order lifecycle' });
    const steps = within(bar).getAllByRole('listitem');
    expect(await within(steps[0]!).findByText(/^Lindiwe D\. · /)).toBeInTheDocument();
    expect(within(steps[1]!).getByText(/^Lindiwe D\. · /)).toBeInTheDocument();
    expect(await within(steps[2]!).findByText('Waiting on Thandi M.')).toHaveAttribute('title', 'Procurement Manager. Any of: Thandi Mokoena');
    expect(steps[3]).toHaveTextContent(/^4Partly received$/);
  });
});
