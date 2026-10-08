import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/Toast';
import { GlobalPreferencesApplier } from './components/GlobalPreferencesApplier';
import { PROCUREMENT_ENABLED } from './config/features';

function importPage(
  importFn: () => Promise<{ default: React.ComponentType<unknown> }>,
): React.LazyExoticComponent<React.ComponentType<unknown>> {
  return lazy(importFn);
}

const Login = importPage(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = importPage(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Materials = importPage(() => import('./pages/Materials').then(m => ({ default: m.Materials })));
const MaterialDetail = importPage(() => import('./pages/MaterialDetail').then(m => ({ default: m.MaterialDetail })));
const Stock = importPage(() => import('./pages/Stock').then(m => ({ default: m.Stock })));
const Movements = importPage(() => import('./pages/Movements').then(m => ({ default: m.Movements })));
const Suppliers = importPage(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const SupplierDetail = importPage(() => import('./pages/SupplierDetail').then(m => ({ default: m.SupplierDetail })));
const PurchaseOrders = importPage(() => import('./pages/PurchaseOrders').then(m => ({ default: m.PurchaseOrders })));
const PurchaseOrderDetail = importPage(() => import('./pages/PurchaseOrderDetail').then(m => ({ default: m.PurchaseOrderDetail })));
const GoodsReceipts = importPage(() => import('./pages/GoodsReceipts').then(m => ({ default: m.GoodsReceipts })));
const LowStock = importPage(() => import('./pages/LowStock').then(m => ({ default: m.LowStock })));
const InventoryReportPage = importPage(() => import('./pages/InventoryReport').then(m => ({ default: m.InventoryReportPage })));
const Racks = importPage(() => import('./pages/Racks').then(m => ({ default: m.Racks })));
const Projects = importPage(() => import('./pages/Projects').then(m => ({ default: m.Projects })));
const ReceiveStock = importPage(() => import('./pages/ReceiveStock').then(m => ({ default: m.ReceiveStock })));
const IssueStock = importPage(() => import('./pages/IssueStock').then(m => ({ default: m.IssueStock })));
const Recipients = importPage(() => import('./pages/Recipients').then(m => ({ default: m.Recipients })));
const Locations = importPage(() => import('./pages/Locations').then(m => ({ default: m.Locations })));
const Settings = importPage(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const SettingsGeneral = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsGeneral })));
const SettingsNotifications = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsNotifications })));
const SettingsInventory = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsInventory })));
const SettingsSecurity = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsSecurity })));
const SettingsPurchaseOrders = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsPurchaseOrders })));
const SettingsAppearance = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsAppearance })));
const SettingsUsers = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsUsers })));
const SettingsSystem = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsSystem })));
const SettingsData = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsData })));
const SettingsHistory = importPage(() => import('./pages/SettingsSections').then(m => ({ default: m.SettingsHistory })));
const NotFound = importPage(() => import('./pages/NotFound').then(m => ({ default: m.NotFound })));

function PageSkeleton() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 text-surface-500">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block h-4 w-4 rounded-full border-2 border-brand-500 border-r-transparent animate-spin" aria-hidden="true" />
        Loading page…
      </div>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 text-surface-500">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-block h-4 w-4 rounded-full border-2 border-brand-500 border-r-transparent animate-spin" aria-hidden="true" />
        Loading…
      </div>
    </div>
  );
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (user) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }
  return <>{children}</>;
}

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <AuthLoading />;
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return (
    <ToastProvider>
      <GlobalPreferencesApplier />
      <AppShell>
        <Outlet />
      </AppShell>
    </ToastProvider>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnly>
            <Suspense fallback={<PageSkeleton />}>
              <Login />
            </Suspense>
          </PublicOnly>
        }
      />

      <Route element={<Protected />}>
        <Route path="/" element={<Suspense fallback={<PageSkeleton />}><Dashboard /></Suspense>} />
        <Route path="/stock" element={<Suspense fallback={<PageSkeleton />}><Stock /></Suspense>} />
        <Route path="/stock/issue" element={<Suspense fallback={<PageSkeleton />}><IssueStock /></Suspense>} />
        <Route path="/stock/receive" element={<Suspense fallback={<PageSkeleton />}><ReceiveStock /></Suspense>} />
        <Route path="/materials" element={<Suspense fallback={<PageSkeleton />}><Materials /></Suspense>} />
        <Route path="/materials/:id" element={<Suspense fallback={<PageSkeleton />}><MaterialDetail /></Suspense>} />
        <Route path="/movements" element={<Suspense fallback={<PageSkeleton />}><Movements /></Suspense>} />
        <Route path="/suppliers" element={<Suspense fallback={<PageSkeleton />}><Suppliers /></Suspense>} />
        <Route path="/suppliers/:id" element={<Suspense fallback={<PageSkeleton />}><SupplierDetail /></Suspense>} />
        {PROCUREMENT_ENABLED ? (
          <>
            <Route path="/purchase-orders" element={<Suspense fallback={<PageSkeleton />}><PurchaseOrders /></Suspense>} />
            <Route path="/purchase-orders/:id" element={<Suspense fallback={<PageSkeleton />}><PurchaseOrderDetail /></Suspense>} />
            <Route path="/goods-receipts" element={<Suspense fallback={<PageSkeleton />}><GoodsReceipts /></Suspense>} />
          </>
        ) : (
          <>
            <Route path="/purchase-orders/*" element={<Navigate to="/" replace />} />
            <Route path="/goods-receipts/*" element={<Navigate to="/" replace />} />
          </>
        )}
        <Route path="/reports/low-stock" element={<Suspense fallback={<PageSkeleton />}><LowStock /></Suspense>} />
        <Route path="/reports/inventory" element={<Suspense fallback={<PageSkeleton />}><InventoryReportPage /></Suspense>} />
        <Route path="/racks" element={<Suspense fallback={<PageSkeleton />}><Racks /></Suspense>} />
        <Route path="/locations" element={<Suspense fallback={<PageSkeleton />}><Locations /></Suspense>} />
        <Route path="/projects" element={<Suspense fallback={<PageSkeleton />}><Projects /></Suspense>} />
        <Route path="/recipients" element={<Suspense fallback={<PageSkeleton />}><Recipients /></Suspense>} />
        <Route path="/settings" element={<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>}>
          <Route index element={<Suspense fallback={<PageSkeleton />}><SettingsGeneral /></Suspense>} />
          <Route path="notifications" element={<Suspense fallback={<PageSkeleton />}><SettingsNotifications /></Suspense>} />
          <Route path="inventory" element={<Suspense fallback={<PageSkeleton />}><SettingsInventory /></Suspense>} />
          {PROCUREMENT_ENABLED
            ? <Route path="purchase-orders" element={<Suspense fallback={<PageSkeleton />}><SettingsPurchaseOrders /></Suspense>} />
            : <Route path="purchase-orders" element={<Navigate to="/settings" replace />} />}
          <Route path="appearance" element={<Suspense fallback={<PageSkeleton />}><SettingsAppearance /></Suspense>} />
          <Route path="users" element={<Suspense fallback={<PageSkeleton />}><SettingsUsers /></Suspense>} />
          <Route path="security" element={<Suspense fallback={<PageSkeleton />}><SettingsSecurity /></Suspense>} />
          <Route path="system" element={<Suspense fallback={<PageSkeleton />}><SettingsSystem /></Suspense>} />
          <Route path="data" element={<Suspense fallback={<PageSkeleton />}><SettingsData /></Suspense>} />
          <Route path="history" element={<Suspense fallback={<PageSkeleton />}><SettingsHistory /></Suspense>} />
        </Route>
        <Route path="*" element={<Suspense fallback={<PageSkeleton />}><NotFound /></Suspense>} />
      </Route>
    </Routes>
  );
}
