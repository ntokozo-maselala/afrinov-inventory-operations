// Names on the purchase order status bar: who moved the order into each step,
// from its Activity, and who the next step is waiting on.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));
vi.mock('../api/client', () => ({
  api: { get: mockGet, post: vi.fn(), patch: vi.fn(), del: vi.fn() },
  isApiError: (e: unknown) => typeof e === 'object' && e !== null && 'code' in e,
}));
vi.mock('../auth', () => ({ useAuth: () => ({ user: { roles: ['PROCUREMENT'] } }) }));

const { PurchaseOrderDetail, barSteps, shortName, stepActors, stepLine, stepRole, waitingOn } = await import('./PurchaseOrderDetail');
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
    expect(actors.DRAFT).toMatchObject({ label: 'Lindiwe D.', when: expect.stringMatching(/2026/) });
    expect(actors.APPROVED?.label).toBe('Sipho N.');
    expect(actors.APPROVED?.title).toMatch(/^Sipho Nkosi, /);
    expect(actors.PARTIALLY_RECEIVED?.label).toBe('Bongani Z.');
    expect(actors.RECEIVED).toBeUndefined();
  });

  it('says when the account is gone, or the system did it', () => {
    const actors = stepActors([
      entry('CREATE', null, 'DRAFT', null, '2026-10-01T08:00:00Z', 'gone'),
      entry('PO_SUBMIT', 'DRAFT', 'PENDING_APPROVAL', null, '2026-10-01T09:00:00Z', null),
    ]);
    expect(actors.DRAFT?.label).toBe('A removed user');
    expect(actors.PENDING_APPROVAL?.label).toBe('System');
  });
});

describe('waitingOn', () => {
  const approvers = (...names: string[]) => names.map((name, i) => ({ id: `a${i}`, name, standIn: false }));

  it('waits on the role of the next signature, with who holds it in the title', () => {
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: approvers('Thandi Mokoena', 'Sipho Nkosi') }))
      .toEqual({ step: 'APPROVED', person: { label: 'Waiting on Procurement Manager', title: 'Any of: Thandi Mokoena, Sipho Nkosi', waiting: true } });
  });

  it('marks the stand-ins in the title', () => {
    const shown = waitingOn('PENDING_APPROVAL', { ...APPROVAL, next: { step: 'DIRECTOR', label: 'Director' }, approvers: [{ id: 'd', name: 'Sipho Nkosi', standIn: false }, { id: 'c', name: 'Chief Executive', standIn: true }] })!.person;
    expect(shown).toMatchObject({ label: 'Waiting on Director', title: 'Any of: Sipho Nkosi, Chief Executive (standing in)' });
  });

  it('says why no one can approve yet', () => {
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, unpricedLines: 1, approvers: [] })!.person.label).toBe('Needs prices');
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, approvers: [] })!.person).toMatchObject({ label: 'No approver', title: 'Nobody holds the Procurement Manager role yet' });
    expect(waitingOn('PENDING_APPROVAL', { ...APPROVAL, noRate: true, currency: 'USD', approvers: [] })!.person.label).toBe('Needs a rate');
  });

  it('waits on the Store Controller for a delivery, and on no one once received', () => {
    expect(waitingOn('APPROVED', null)).toMatchObject({ step: 'PARTIALLY_RECEIVED', person: { label: 'Waiting on Store Controller' } });
    expect(waitingOn('PARTIALLY_RECEIVED', null)).toMatchObject({ step: 'RECEIVED' });
    expect(waitingOn('RECEIVED', null)).toBeNull();
    expect(waitingOn('DRAFT', null)).toBeNull();
  });
});

describe('stepRole', () => {
  const signing = (...labels: string[]) => ({ ...APPROVAL, approvers: [], steps: labels.map((label) => ({ step: label, label, signature: null })) });

  it('names the buyer, the signers the order needs, and the Store Controller', () => {
    expect(stepRole('DRAFT', null)).toBe('Buyer');
    expect(stepRole('PENDING_APPROVAL', null)).toBe('Buyer');
    expect(stepRole('APPROVED', signing('Procurement Manager'))).toBe('Procurement Manager');
    expect(stepRole('APPROVED', signing('Procurement Manager', 'Director'))).toBe('Procurement Manager → Director');
    expect(stepRole('PARTIALLY_RECEIVED', null)).toBe('Store Controller');
    expect(stepRole('RECEIVED', null)).toBe('Store Controller');
    expect(stepRole('CLOSED', null)).toBe('Buyer');
  });

  it('falls back to the Procurement Manager before the signatures are known', () => {
    expect(stepRole('APPROVED', null)).toBe('Procurement Manager');
    expect(stepRole('APPROVED', signing())).toBe('Procurement Manager');
  });
});

describe('stepLine', () => {
  const done = { label: 'Thandi M. · 02 Nov 2026', title: 'Thandi Mokoena, 02 Nov 2026, 15:42' };
  const twoSignatures = {
    ...APPROVAL, approvers: [], next: null,
    steps: [
      { step: 'MANAGER', label: 'Procurement Manager', signature: { name: 'Thandi Mokoena', signedAt: '2026-11-02T13:00:00Z', standIn: false } },
      { step: 'DIRECTOR', label: 'Director', signature: { name: 'Chief Executive', signedAt: '2026-11-02T13:42:00Z', standIn: true } },
    ],
  };

  it('shows who did a finished step, and the role they acted in on hover', () => {
    expect(stepLine('DRAFT', true, { DRAFT: done }, null, null)).toEqual({ ...done, title: `${done.title}. As Buyer`, tone: 'done' });
    expect(stepLine('APPROVED', true, { APPROVED: done }, null, twoSignatures)!.title)
      .toBe(`${done.title}. Signed by Thandi Mokoena as Procurement Manager, then Chief Executive standing in for the Director`);
  });

  it('shows the role, with the person on hover, where whoever did it doesn\'t hold it', () => {
    const actors = stepActors([
      { ...entry('CREATE', null, 'DRAFT', 'System Administrator', '2026-11-02T13:35:00Z'), actorRoles: ['ADMIN'] },
      { ...entry('PO_GOODS_RECEIVED', 'APPROVED', 'PARTIALLY_RECEIVED', 'Bongani Zulu', '2026-11-03T09:00:00Z'), actorRoles: ['STORE_CONTROLLER'] },
    ]);
    const draft = stepLine('DRAFT', true, actors, null, null)!;
    expect(draft.label).toBe('Buyer');
    expect(draft.title).toMatch(/^System Administrator, .*, for the Buyer$/);
    expect(stepLine('PARTIALLY_RECEIVED', true, actors, null, null)!.label).toBe('Bongani Z.');
  });

  it('shows who a step waits on, and the role for a step ahead', () => {
    const next = { step: 'PARTIALLY_RECEIVED' as const, person: { label: 'Waiting on Store Controller', title: 'Booked on Receive stock when it arrives', waiting: true } };
    expect(stepLine('PARTIALLY_RECEIVED', false, {}, next, null)).toMatchObject({ label: 'Waiting on Store Controller', tone: 'waiting' });
    expect(stepLine('CLOSED', false, {}, next, null)).toMatchObject({ label: 'Buyer', tone: 'ahead' });
  });

  it('tells the first signer a Director signs after them', () => {
    const pending = { ...twoSignatures, next: { step: 'MANAGER', label: 'Procurement Manager' }, approvers: [{ id: 't', name: 'Thandi Mokoena', standIn: false }], steps: twoSignatures.steps.map((s) => ({ ...s, signature: null })) };
    expect(waitingOn('PENDING_APPROVAL', pending)!.person).toMatchObject({ label: 'Waiting on Procurement Manager', title: 'Any of: Thandi Mokoena. Then the Director' });
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
    expect(await within(steps[0]!).findByText('Lindiwe D.')).toHaveAttribute('title', expect.stringMatching(/^Lindiwe Dube, .*\. As Buyer$/));
    expect(within(steps[0]!).getByText('01 Oct 2026')).toBeInTheDocument();
    expect(within(steps[1]!).getByText('Lindiwe D.')).toBeInTheDocument();
    expect(await within(steps[2]!).findByText('Waiting on Procurement Manager')).toHaveAttribute('title', 'Any of: Thandi Mokoena');
    expect(steps[3]).toHaveTextContent(/^4Partly receivedStore Controller$/);
  });

  it('ticks the steps that are done, and numbers the rest', async () => {
    render(
      <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
        <ToastProvider>
          <Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const bar = await screen.findByRole('list', { name: 'Purchase order lifecycle' });
    const marks = within(bar).getAllByRole('listitem').map((li) => li.querySelector('[aria-label]')!.getAttribute('aria-label'));
    expect(marks).toEqual(['Done', 'Current step', 'Not reached', 'Not reached', 'Not reached', 'Not reached']);
  });

  it('names the role that will do each step ahead, with the Director where the order needs one', async () => {
    const order = await mockGet.getMockImplementation()!('/purchase-orders/po-1');
    mockGet.mockImplementation(async (path: string) => {
      if (path === '/purchase-orders/po-1') return { ...order, status: 'DRAFT' };
      if (path === '/purchase-orders/po-1/history') return [entry('CREATE', null, 'DRAFT', 'Lindiwe Dube', '2026-10-01T08:00:00Z')];
      if (path === '/purchase-orders/po-1/approval') return {
        ...APPROVAL, approvers: [],
        steps: [{ step: 'MANAGER', label: 'Procurement Manager', signature: null }, { step: 'DIRECTOR', label: 'Director', signature: null }],
      };
      return [];
    });
    render(
      <MemoryRouter initialEntries={['/purchase-orders/po-1']}>
        <ToastProvider>
          <Routes><Route path="/purchase-orders/:id" element={<PurchaseOrderDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    const bar = await screen.findByRole('list', { name: 'Purchase order lifecycle' });
    const steps = within(bar).getAllByRole('listitem');
    expect(await within(steps[0]!).findByText('Lindiwe D.')).toBeInTheDocument();
    expect(within(steps[1]!).getByText('Buyer')).toBeInTheDocument();
    // A signature each: Signed by the Procurement Manager, then Approved by the Director.
    await waitFor(() => expect(within(bar).getAllByRole('listitem')).toHaveLength(7));
    const seven = within(bar).getAllByRole('listitem');
    expect(seven[2]).toHaveTextContent(/^3SignedProcurement Manager$/);
    expect(seven[3]).toHaveTextContent(/^4ApprovedDirector$/);
    expect(within(seven[5]!).getByText('Store Controller')).toBeInTheDocument();
    expect(within(seven[6]!).getByText('Buyer')).toBeInTheDocument();
  });
});

describe('barSteps', () => {
  const sign = (step: string, label: string, signature: { name: string; signedAt: string; standIn: boolean } | null) => ({ step, label, signature });
  const director = (manager: { name: string; signedAt: string; standIn: boolean } | null, next: string | null) => ({
    ...APPROVAL, approvers: [{ id: 'd', name: 'Sipho Nkosi', standIn: false }],
    next: next ? { step: next, label: next === 'MANAGER' ? 'Procurement Manager' : 'Director' } : null,
    steps: [sign('MANAGER', 'Procurement Manager', manager), sign('DIRECTOR', 'Director', null)],
  });
  const thandi = { name: 'Thandi Mokoena', signedAt: '2026-11-02T13:00:00Z', standIn: false };

  it('keeps one Approved step for an order one signature approves', () => {
    expect(barSteps('PENDING_APPROVAL', [], { ...APPROVAL, approvers: [] }, []).map((s) => s.label))
      .toEqual(['Draft', 'Pending approval', 'Approved', 'Partly received', 'Received', 'Closed']);
  });

  it('ticks the first signature on its own step, and waits on the Director on the next', () => {
    const steps = barSteps('PENDING_APPROVAL', [], director(thandi, 'DIRECTOR'), [{ step: 'MANAGER', signedAt: thandi.signedAt, standIn: false, signedBy: { name: thandi.name, roles: ['PROCUREMENT_MANAGER'] } }]);
    expect(steps.map((s) => s.label)).toEqual(['Draft', 'Pending approval', 'Signed', 'Approved', 'Partly received', 'Received', 'Closed']);
    expect(steps[2]).toMatchObject({ mark: 'done', line: { label: 'Thandi M.', tone: 'done' } });
    expect(steps[2]!.line!.title).toMatch(/As Procurement Manager$/);
    expect(steps[3]).toMatchObject({ mark: 'ahead', line: { label: 'Waiting on Director', tone: 'waiting' } });
  });

  it('waits on the Procurement Manager on the Signed step until they sign', () => {
    const steps = barSteps('PENDING_APPROVAL', [], director(null, 'MANAGER'), []);
    expect(steps[2]).toMatchObject({ mark: 'ahead', line: { label: 'Waiting on Procurement Manager', tone: 'waiting' } });
    expect(steps[3]).toMatchObject({ line: { label: 'Director', tone: 'ahead' } });
  });

  it('names the role where the signer doesn\'t hold it, as an admin testing', () => {
    const steps = barSteps('PENDING_APPROVAL', [], director(thandi, 'DIRECTOR'), [{ step: 'MANAGER', signedAt: thandi.signedAt, standIn: false, signedBy: { name: thandi.name, roles: ['ADMIN'] } }]);
    expect(steps[2]!.line).toMatchObject({ label: 'Procurement Manager' });
    expect(steps[2]!.line!.title).toMatch(/For the Procurement Manager$/);
  });

  it('marks the receiving an order was closed without, so it doesn\'t read as complete', () => {
    const history = [
      entry('PO_GOODS_RECEIVED', 'APPROVED', 'PARTIALLY_RECEIVED', 'Bongani Zulu', '2026-11-03T09:00:00Z'),
      entry('PO_CLOSE', 'PARTIALLY_RECEIVED', 'CLOSED', 'Lindiwe Dube', '2026-11-04T09:00:00Z'),
    ];
    const steps = barSteps('CLOSED', history, { ...APPROVAL, approvers: [] }, []);
    expect(steps.map((s) => s.mark)).toEqual(['done', 'done', 'done', 'done', 'short', 'current']);
    expect(steps[4]!.line).toMatchObject({ label: 'Not all received', tone: 'short' });
  });

  it('ticks every step of an order received in full and closed', () => {
    const history = [entry('PO_GOODS_RECEIVED', 'APPROVED', 'RECEIVED', 'Bongani Zulu', '2026-11-03T09:00:00Z')];
    expect(barSteps('CLOSED', history, { ...APPROVAL, approvers: [] }, []).map((s) => s.mark)).toEqual(['done', 'done', 'done', 'done', 'done', 'current']);
  });
});
