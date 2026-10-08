import { useApi } from '../hooks/useApi';
import type { ReportResult } from '../mock/mockReport';
import type { MockSupplier, MockLocation } from '../mock/types';

export interface PurchaseOrderSummary {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  supplier: { name: string };
  createdAt: string;
  expectedDeliveryDate?: string | null;
  approvedAt?: string | null;
  deliveredAt?: string | null;
  lines: Array<{
    id: string;
    material: { sku: string; unitCost?: string; name?: string };
    orderedQty: string;
    receivedQty: string;
  }>;
}

export interface DashboardData {
  report: ReportResult | null;
  reportLoading: boolean;
  reportError: null | { code: string; message: string };
  purchaseOrders: PurchaseOrderSummary[] | null;
  poLoading: boolean;
  poError: null | { code: string; message: string };
  suppliers: MockSupplier[] | null;
  suppliersLoading: boolean;
  suppliersError: null | { code: string; message: string };
  locations: Array<MockLocation & { inventoryCount?: number }> | null;
  locationsLoading: boolean;
  locationsError: null | { code: string; message: string };
  reload: () => void;
}

export function useDashboardData(reportQueryString: string): DashboardData {
  const reportApi = useApi<ReportResult>(reportQueryString);
  const poApi = useApi<PurchaseOrderSummary[]>('/purchase-orders');
  const suppliersApi = useApi<MockSupplier[]>('/suppliers');
  const locationsApi = useApi<Array<MockLocation & { inventoryCount?: number }>>('/locations');

  return {
    report: reportApi.data,
    reportLoading: reportApi.loading,
    reportError: reportApi.error,
    purchaseOrders: poApi.data,
    poLoading: poApi.loading,
    poError: poApi.error,
    suppliers: suppliersApi.data,
    suppliersLoading: suppliersApi.loading,
    suppliersError: suppliersApi.error,
    locations: locationsApi.data,
    locationsLoading: locationsApi.loading,
    locationsError: locationsApi.error,
    reload: () => {
      reportApi.reload();
      poApi.reload();
      suppliersApi.reload();
      locationsApi.reload();
    },
  };
}

export function buildMovementTrend(
  movements: ReportResult['movements'],
): Array<{ label: string; value: number }> {
  if (!movements || movements.length === 0) return [];

  const byDate = new Map<string, number>();
  for (const m of movements) {
    const day = m.postedAt.slice(0, 10);
    const delta = Math.abs(m.quantity);
    byDate.set(day, (byDate.get(day) ?? 0) + delta);
  }

  return Array.from(byDate.entries())
    .map(([date, qty]) => ({ label: date.slice(5), value: qty }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function buildMovementByType(
  movements: ReportResult['movements'],
): Array<{ label: string; value: number }> {
  if (!movements || movements.length === 0) return [];
  const counts: Record<string, number> = {};
  for (const m of movements) {
    counts[m.type] = (counts[m.type] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({ label: type, value: count }));
}

export function computeKPITrend(
  current: number,
  previous: number,
): { direction: 'up' | 'down' | 'neutral'; delta: string } {
  if (previous === 0) {
    return { direction: current > 0 ? 'up' : 'neutral', delta: current > 0 ? `+${current}` : '0' };
  }
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 1) return { direction: 'neutral', delta: '0%' };
  const sign = pct > 0 ? '+' : '';
  return {
    direction: pct > 0 ? 'up' : 'down',
    delta: `${sign}${pct.toFixed(0)}%`,
  };
}
