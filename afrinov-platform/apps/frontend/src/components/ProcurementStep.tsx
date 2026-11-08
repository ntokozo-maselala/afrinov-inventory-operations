// What a schedule's Procurement step stands on (Project Tracking Roadmap,
// Phase 4): the project's purchase orders, and those of any project a joint
// schedule covers, from the orders and receipts the platform already holds.
// Nobody has to ask Procurement whether a job's material is in. No prices.
import { Link } from 'react-router-dom';
import { Modal } from './Modal';
import { Button } from './Button';
import { PurchaseOrderStatusBadge, Badge } from './Badge';
import { formatDay } from '../lib/projectSchedule';
import type { ScheduleStep, StepProcurement } from '../api/types';

/** The schedule's Procurement step: the first whose name says so. */
export function procurementStepOf<T extends Pick<ScheduleStep, 'name'>>(steps: T[]): T | undefined {
  return steps.find((s) => /procurement/i.test(s.name));
}

/** What to warn about, against the step's expected end. */
export function procurementWarnings(p: StepProcurement, stepEnd: string | null): string[] {
  const out: string[] = [];
  if (p.summary.overdue > 0) out.push(`${p.summary.overdue} order${p.summary.overdue === 1 ? ' is' : 's are'} overdue.`);
  if (stepEnd && p.summary.latestExpected && p.summary.latestExpected > stepEnd) {
    out.push(`Material is expected ${formatDay(p.summary.latestExpected)}, after this step is expected to end (${formatDay(stepEnd)}).`);
  }
  if (p.summary.notPlaced > 0) out.push(`${p.summary.notPlaced} order${p.summary.notPlaced === 1 ? ' is' : 's are'} not placed yet (draft or waiting to be signed).`);
  return out;
}

/** "3 orders · 1 owing", "All delivered, last 9 Mar 2026", or "No orders yet". */
export function procurementSummary(p: StepProcurement): string {
  const s = p.summary;
  if (s.orders === 0) return 'No orders yet';
  if (s.allReceived) return s.lastReceivedOn ? `All delivered, last ${formatDay(s.lastReceivedOn)}` : 'All delivered';
  return `${s.orders} order${s.orders === 1 ? '' : 's'} · ${s.owing} owing`;
}

/** The step's line on the project page: how its orders stand, what to watch, and the way to see them. */
export function ProcurementStepNote({ procurement: p, stepEnd, onOpen, onMarkDone }: {
  procurement: StepProcurement;
  stepEnd: string | null;
  onOpen: () => void;
  /** Offered when everything has arrived and the step isn't marked finished; nothing happens on its own. */
  onMarkDone?: () => void;
}) {
  const warnings = procurementWarnings(p, stepEnd);
  return (
    <div className="mt-1 text-xs space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={p.summary.allReceived ? 'text-success-700' : 'text-surface-600'}>{procurementSummary(p)}</span>
        {p.summary.orders > 0 && <button type="button" className="btn-link text-xs" onClick={onOpen}>Orders</button>}
        {onMarkDone && <button type="button" className="btn-link text-xs" onClick={onMarkDone}>Mark this step done</button>}
      </div>
      {warnings.map((w) => <div key={w} className="text-warning-700">{w}</div>)}
    </div>
  );
}

/** The orders, one row each: where each stands and what it still owes. */
export function ProcurementOrdersDialog({ procurement: p, canOpenOrders, onClose }: {
  procurement: StepProcurement;
  /** Links to the order pages, for those who see project orders. */
  canOpenOrders: boolean;
  onClose: () => void;
}) {
  const several = p.projects.length > 1;
  return (
    <Modal open onClose={onClose} size="lg" title="Orders for this job"
      description={several ? `Orders for ${p.projects.join(', ')}, as the schedule covers them all. Cancelled orders are left out.` : 'Cancelled orders are left out.'}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Orders for this job">
          <thead>
            <tr className="text-left text-surface-500 border-b border-surface-200">
              <th className="py-2 pr-2">Order</th>
              {several && <th className="py-2 pr-2">Project</th>}
              <th className="py-2 pr-2">Supplier</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Expected</th>
              <th className="py-2 pr-2">Owed</th>
              <th className="py-2">Last delivered</th>
            </tr>
          </thead>
          <tbody>
            {p.orders.map((o) => (
              <tr key={o.id} className="border-b border-surface-100">
                <td className="py-2 pr-2 font-mono">{canOpenOrders ? <Link to={`/purchase-orders/${o.id}`} className="btn-link">{o.number}</Link> : o.number}</td>
                {several && <td className="py-2 pr-2 font-mono">{o.projectNumber}</td>}
                <td className="py-2 pr-2">{o.supplierName}</td>
                <td className="py-2 pr-2"><PurchaseOrderStatusBadge status={o.status} /></td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {formatDay(o.expectedDelivery)}
                  {o.overdue && <> <Badge tone="danger">Overdue</Badge></>}
                </td>
                <td className="py-2 pr-2 text-num">{o.linesOwed === 0 ? '—' : `${o.linesOwed} of ${o.lines} line${o.lines === 1 ? '' : 's'}`}</td>
                <td className="py-2 whitespace-nowrap">{formatDay(o.lastReceivedOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end pt-3"><Button variant="ghost" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}
