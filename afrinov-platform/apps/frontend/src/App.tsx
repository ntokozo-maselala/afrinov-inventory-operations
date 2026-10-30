import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from './auth';
import { AppShell } from './components/AppShell';
import { ToastProvider } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GlobalPreferencesApplier } from './components/GlobalPreferencesApplier';
import { IdleSignOut } from './components/IdleSignOut';
import { PROCUREMENT_ENABLED } from './config/features';
import { applyTheme, getAppearance } from './hooks/useAppearance';

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
const NewStockOrder = importPage(() => import('./pages/PurchaseOrderForm').then(m => ({ default: m.NewStockOrder })));
const StoresOrders = importPage(() => import('./pages/StoresOrders').then(m => ({ default: m.StoresOrders })));
const PurchaseOrderDetail = importPage(() => import('./pages/PurchaseOrderDetail').then(m => ({ default: m.PurchaseOrderDetail })));
const NewPurchaseOrder = importPage(() => import('./pages/PurchaseOrderForm').then(m => ({ default: m.NewPurchaseOrder })));
const EditPurchaseOrder = importPage(() => import('./pages/PurchaseOrderForm').then(m => ({ default: m.EditPurchaseOrder })));
const Rfqs = importPage(() => import('./pages/Rfqs').then(m => ({ default: m.Rfqs })));
const RfqDetail = importPage(() => import('./pages/RfqDetail').then(m => ({ default: m.RfqDetail })));
const NewRfq = importPage(() => import('./pages/RfqForm').then(m => ({ default: m.NewRfq })));
const EditRfq = importPage(() => import('./pages/RfqForm').then(m => ({ default: m.EditRfq })));
const StockStatus = importPage(() => import('./pages/StockStatus').then(m => ({ default: m.StockStatus })));
const Consumption = importPage(() => import('./pages/Consumption').then(m => ({ default: m.Consumption })));
const MonthEnd = importPage(() => import('./pages/MonthEnd').then(m => ({ default: m.MonthEnd })));
const Projects = importPage(() => import('./pages/Projects').then(m => ({ default: m.Projects })));
const ProjectLeftovers = importPage(() => import('./pages/ProjectLeftovers').then(m => ({ default: m.ProjectLeftovers })));
const ReceiveStock = importPage(() => import('./pages/ReceiveStock').then(m => ({ default: m.ReceiveStock })));
const IssueStock = importPage(() => import('./pages/IssueStock').then(m => ({ default: m.IssueStock })));
const ReturnStock = importPage(() => import('./pages/ReturnStock').then(m => ({ default: m.ReturnStock })));
const StockCount = importPage(() => import('./pages/StockCount').then(m => ({ default: m.StockCount })));
const Recipients = importPage(() => import('./pages/Recipients').then(m => ({ default: m.Recipients })));
const Tools = importPage(() => import('./pages/Tools').then(m => ({ default: m.Tools })));
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
const ChangePassword = lazy(() => import('./pages/ChangePassword').then(m => ({ default: m.ChangePassword })));

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
  const { user, loading, sessionExpired } = useAuth();
  const location = useLocation();
  const [themeReady, setThemeReady] = useState(false);
  if (loading) return <AuthLoading />;
  if (!user) {
    // Send the user to sign-in. When the loss of session was a rejected token
    // rather than an ordinary visit, say so on the sign-in page: the provider
    // holds the flag, so no effect has to win a race to carry it across.
    return <Navigate to="/login" state={{ from: location, sessionExpired }} replace />;
  }
  // After an administrator's reset the server refuses everything but the
  // password change, so nothing else is shown (and no screen fires requests
  // that would only be refused) until it is done.
  if (user.mustChangePassword) {
    return (
      <ErrorBoundary name="Change password">
        <IdleSignOut />
        <Suspense fallback={<PageSkeleton />}>
          <ChangePassword forced />
        </Suspense>
      </ErrorBoundary>
    );
  }
  return (
    <ToastProvider>
      <IdleSignOut />
      <GlobalPreferencesApplier onReady={() => setThemeReady(true)} />
      {themeReady ? <AppShell><Outlet /></AppShell> : <AuthLoading />}
    </ToastProvider>
  );
}

export function App() {
  return (
    <>
      <SystemThemeSync />
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <ErrorBoundary name="Sign in">
                <Suspense fallback={<PageSkeleton />}>
                  <Login />
                </Suspense>
              </ErrorBoundary>
            </PublicOnly>
          }
        />

      <Route element={<Protected />}>
        <Route path="/" element={<RouteBoundary name="Dashboard"><Dashboard /></RouteBoundary>} />
        <Route path="/stock" element={<RouteBoundary name="Stock"><Stock /></RouteBoundary>} />
        <Route path="/stock/issue" element={<RouteBoundary name="Issue stock"><IssueStock /></RouteBoundary>} />
        <Route path="/stock/return" element={<RouteBoundary name="Return stock"><ReturnStock /></RouteBoundary>} />
        <Route path="/stock/receive" element={<RouteBoundary name="Receive stock"><ReceiveStock /></RouteBoundary>} />
        <Route path="/stock/count" element={<RouteBoundary name="Count stock"><StockCount /></RouteBoundary>} />
        <Route path="/materials" element={<RouteBoundary name="Materials"><Materials /></RouteBoundary>} />
        <Route path="/materials/:id" element={<RouteBoundary name="Material"><MaterialDetail /></RouteBoundary>} />
        <Route path="/movements" element={<RouteBoundary name="Movements"><Movements /></RouteBoundary>} />
        <Route path="/suppliers" element={<RouteBoundary name="Suppliers"><Suppliers /></RouteBoundary>} />
        <Route path="/suppliers/:id" element={<RouteBoundary name="Supplier"><SupplierDetail /></RouteBoundary>} />
        {PROCUREMENT_ENABLED ? (
          <>
            <Route path="/stock/orders" element={<RouteBoundary name="Order stock"><StoresOrders /></RouteBoundary>} />
            <Route path="/stock/orders/new" element={<RouteBoundary name="New stock order"><NewStockOrder /></RouteBoundary>} />
            {/* A Stores order lives in Order stock: the same order page, at the store's address. */}
            <Route path="/stock/orders/:id" element={<RouteBoundary name="Stock order"><PurchaseOrderDetail /></RouteBoundary>} />
            <Route path="/stock/orders/:id/edit" element={<RouteBoundary name="Edit stock order"><EditPurchaseOrder /></RouteBoundary>} />
            <Route path="/purchase-orders" element={<RouteBoundary name="Purchase orders"><PurchaseOrders /></RouteBoundary>} />
            <Route path="/purchase-orders/new" element={<RouteBoundary name="New purchase order"><NewPurchaseOrder /></RouteBoundary>} />
            <Route path="/purchase-orders/:id" element={<RouteBoundary name="Purchase order"><PurchaseOrderDetail /></RouteBoundary>} />
            <Route path="/purchase-orders/:id/edit" element={<RouteBoundary name="Edit purchase order"><EditPurchaseOrder /></RouteBoundary>} />
            <Route path="/rfqs" element={<RouteBoundary name="Requests for quotation"><Rfqs /></RouteBoundary>} />
            <Route path="/rfqs/new" element={<RouteBoundary name="New request for quotation"><NewRfq /></RouteBoundary>} />
            <Route path="/rfqs/:id" element={<RouteBoundary name="Request for quotation"><RfqDetail /></RouteBoundary>} />
            <Route path="/rfqs/:id/edit" element={<RouteBoundary name="Edit request for quotation"><EditRfq /></RouteBoundary>} />
            {/* Goods receipts had its own page; deliveries, against an order or not, are booked on Receive stock. */}
            <Route path="/goods-receipts/*" element={<Navigate to="/purchase-orders" replace />} />
          </>
        ) : (
          <>
            <Route path="/stock/orders/*" element={<Navigate to="/stock" replace />} />
            <Route path="/purchase-orders/*" element={<Navigate to="/" replace />} />
            <Route path="/rfqs/*" element={<Navigate to="/" replace />} />
            <Route path="/goods-receipts/*" element={<Navigate to="/" replace />} />
          </>
        )}
        <Route path="/reports/stock-status" element={<RouteBoundary name="Stock status report"><StockStatus /></RouteBoundary>} />
        <Route path="/reports/consumption" element={<RouteBoundary name="Consumption report"><Consumption /></RouteBoundary>} />
        <Route path="/reports/stock-report" element={<RouteBoundary name="Stock report"><MonthEnd /></RouteBoundary>} />
        <Route path="/reports/month-end" element={<Navigate to="/reports/stock-report" replace />} />
        {/* The old Low stock page: kept so bookmarks still land. */}
        <Route path="/reports/low-stock" element={<Navigate to="/reports/stock-status" replace />} />
        {/* The retired Inventory report: its figures are on the Dashboard, Stock status and Locations. */}
        <Route path="/reports/inventory" element={<Navigate to="/" replace />} />
        {/* Racks are locations of type Rack, inside their room (racks and locations roadmap, Phase 3.2). */}
        <Route path="/racks" element={<Navigate to="/locations?type=RACK" replace />} />
        <Route path="/locations" element={<RouteBoundary name="Locations"><Locations /></RouteBoundary>} />
        <Route path="/projects" element={<RouteBoundary name="Projects"><Projects /></RouteBoundary>} />
        <Route path="/projects/:projectNumber/leftovers" element={<RouteBoundary name="Project leftovers"><ProjectLeftovers /></RouteBoundary>} />
        <Route path="/recipients" element={<RouteBoundary name="Recipients"><Recipients /></RouteBoundary>} />
        <Route path="/tools" element={<RouteBoundary name="Tools"><Tools /></RouteBoundary>} />
        <Route path="/settings" element={<RouteBoundary name="Settings" resetKey="/settings"><Settings /></RouteBoundary>}>
          <Route index element={<RouteBoundary name="Settings: general"><SettingsGeneral /></RouteBoundary>} />
          <Route path="notifications" element={<RouteBoundary name="Settings: notifications"><SettingsNotifications /></RouteBoundary>} />
          <Route path="inventory" element={<RouteBoundary name="Settings: inventory"><SettingsInventory /></RouteBoundary>} />
          {PROCUREMENT_ENABLED
            ? <Route path="purchase-orders" element={<RouteBoundary name="Settings: purchase orders"><SettingsPurchaseOrders /></RouteBoundary>} />
            : <Route path="purchase-orders" element={<Navigate to="/settings" replace />} />}
          <Route path="appearance" element={<RouteBoundary name="Settings: appearance"><SettingsAppearance /></RouteBoundary>} />
          <Route path="users" element={<RouteBoundary name="Settings: users"><SettingsUsers /></RouteBoundary>} />
          <Route path="security" element={<RouteBoundary name="Settings: security"><SettingsSecurity /></RouteBoundary>} />
          <Route path="system" element={<RouteBoundary name="Settings: system"><SettingsSystem /></RouteBoundary>} />
          <Route path="data" element={<RouteBoundary name="Settings: data"><SettingsData /></RouteBoundary>} />
          <Route path="history" element={<RouteBoundary name="Settings: history"><SettingsHistory /></RouteBoundary>} />
        </Route>
        <Route path="/account/password" element={<RouteBoundary name="Change password"><ChangePassword /></RouteBoundary>} />
        <Route path="*" element={<RouteBoundary name="Page"><NotFound /></RouteBoundary>} />
      </Route>
      </Routes>
    </>
  );
}

/**
 * A route's Suspense fallback wrapped in an Error Boundary, reset when the
 * route changes so a failure on one page does not strand the next. The
 * boundary keeps the shell (sidebar, header) usable: only the page content is
 * replaced by the fallback.
 *
 * `resetKey` overrides the default `location.pathname` key. A layout route that
 * renders shared state across child routes (the Settings tabs) passes a stable
 * key, so moving between its tabs does not remount the layout and discard its
 * shared draft; leaf routes keep the pathname key so a failure on one page does
 * not strand the next.
 */
function RouteBoundary({ name, children, resetKey }: { name: string; children: React.ReactNode; resetKey?: string }) {
  const location = useLocation();
  return (
    <ErrorBoundary name={name} key={resetKey ?? location.pathname}>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function SystemThemeSync() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => applyTheme(getAppearance().theme);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return null;
}
