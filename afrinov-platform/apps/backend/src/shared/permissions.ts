// Permission codes aligned with docs/08-api/authorization.md.
// Format: "action:resource".
export const PermissionCode = {
  CreateMaterial: 'create:material',
  EditMaterial: 'edit:material',
  // Setting an item's unit cost, which decides whether a write-off needs
  // someone else's approval: not the store's own (system audit C1).
  EditUnitCost: 'edit:unit_cost',
  CreateLocation: 'create:location',
  EditLocation: 'edit:location',
  DeleteLocation: 'delete:location',
  ManageLocationStatus: 'manage:location_status',
  CreateSupplier: 'create:supplier',
  EditSupplier: 'edit:supplier',
  ViewPurchaseOrder: 'view:purchase_order',
  CreatePurchaseOrder: 'create:purchase_order',
  SubmitPurchaseOrder: 'submit:purchase_order',
  ApprovePurchaseOrder: 'approve:purchase_order',
  CancelPurchaseOrder: 'cancel:purchase_order',
  ReceivePurchaseOrder: 'receive:purchase_order',
  ClosePurchaseOrder: 'close:purchase_order',
  // Raising, editing, submitting, cancelling and closing a Stores order (one
  // without a project); the purchase order codes above cover project orders.
  OrderStoresStock: 'order:stores_stock',
  // Signing a Stores order, and seeing them to sign; approve:purchase_order covers project orders.
  ApproveStoresOrder: 'approve:stores_order',
  ViewGoodsReceipt: 'view:goods_receipt',
  ReceiveInventory: 'receive:inventory',
  IssueInventory: 'issue:inventory',
  TransferInventory: 'transfer:inventory',
  AdjustInventory: 'adjust:inventory',
  // Approving an adjustment worth more than inventory.writeOffApprovalAbove
  // that someone else asked for; nobody approves their own.
  ApproveWriteOff: 'approve:write_off',
  CheckOutTool: 'checkout:tool',
  CheckInTool: 'checkin:tool',
  // Giving a tool loan a later due date: the store's decision, not the borrower's.
  ExtendToolLoan: 'extend:tool_loan',
  ManageUsers: 'manage:users',
  ViewUsers: 'view:users',
  ManageRoles: 'manage:roles',
  ViewReports: 'view:reports',
  ViewAuditLog: 'view:audit_log',
  ManageProjects: 'manage:projects',
  // Completing, cancelling or archiving a project: Admin, or the project's own
  // manager without it (system audit E3).
  CloseProject: 'close:project',
  // Changing any project's schedules and steps (ADR-032). Admin only for now: a
  // project's own manager changes that project's without it.
  ManageProjectSchedule: 'manage:project_schedule',
  ManageRecipients: 'manage:recipients',
  ManageSettings: 'manage:settings',
  // The prices Sales is quoted can give away the margin on a job, so seeing
  // them is its own permission, not the purchase order one buyers hold.
  ViewSalesRfq: 'view:sales_rfq',
  ManageSalesRfq: 'manage:sales_rfq',
  ReverseInventoryTransaction: 'reverse:inventory_transaction',
} as const;

export type PermissionCodeValue = (typeof PermissionCode)[keyof typeof PermissionCode];

export const ALL_PERMISSION_CODES: PermissionCodeValue[] = Object.values(PermissionCode);

export const RolePermissions: Record<string, PermissionCodeValue[]> = {
  ADMIN: [
    ...ALL_PERMISSION_CODES,
  ],
  STORE_CONTROLLER: [
    PermissionCode.CreateMaterial,
    PermissionCode.EditMaterial,
    // ADR-018: the store controller receives deliveries, so may add the supplier of one.
    PermissionCode.CreateSupplier,
    PermissionCode.EditSupplier,
    PermissionCode.CreateLocation,
    PermissionCode.EditLocation,
    PermissionCode.DeleteLocation,
    PermissionCode.ManageLocationStatus,
    PermissionCode.ReceiveInventory,
    PermissionCode.IssueInventory,
    PermissionCode.TransferInventory,
    PermissionCode.AdjustInventory,
    // Another store controller's write-offs over the limit, never their own.
    PermissionCode.ApproveWriteOff,
    PermissionCode.CheckOutTool,
    PermissionCode.CheckInTool,
    PermissionCode.ExtendToolLoan,
    PermissionCode.ManageProjects,
    PermissionCode.ManageRecipients,
    // No view:purchase_order: project orders and RFQs are Procurement's, and the
    // store sees only its own Stores orders, through order:stores_stock
    // (Stores and Procurement Separation Roadmap, Phase 4).
    PermissionCode.ReceivePurchaseOrder,
    // The storeman orders stock for the stores; Procurement buys for projects.
    PermissionCode.OrderStoresStock,
    PermissionCode.ViewGoodsReceipt,
    PermissionCode.ViewReports,
    PermissionCode.ViewUsers,
    PermissionCode.ReverseInventoryTransaction,
    // Other activity on the Movements page (counts, catalogue and user changes).
    PermissionCode.ViewAuditLog,
  ],
  PROCUREMENT: [
    // Buyers add client-specific material to the catalogue from an order line; editing it stays with the store.
    PermissionCode.CreateMaterial,
    // Buyers know what things cost; the store, which writes stock off, doesn't set it (system audit C1).
    PermissionCode.EditUnitCost,
    PermissionCode.CreateSupplier,
    PermissionCode.EditSupplier,
    PermissionCode.ViewPurchaseOrder,
    PermissionCode.CreatePurchaseOrder,
    PermissionCode.SubmitPurchaseOrder,
    PermissionCode.CancelPurchaseOrder,
    PermissionCode.ClosePurchaseOrder,
    PermissionCode.ReceiveInventory,
    PermissionCode.ViewGoodsReceipt,
    PermissionCode.ManageProjects,
    PermissionCode.ViewReports,
  ],
  // View only: orders are signed by the roles below (po-approval.ts).
  APPROVER: [PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  // These open the orders they sign. Who signs which order is decided in po-approval.ts.
  PROCUREMENT_MANAGER: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ApproveStoresOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewSalesRfq, PermissionCode.ViewReports],
  DIRECTOR: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewSalesRfq, PermissionCode.ViewReports],
  CEO: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewSalesRfq, PermissionCode.ViewReports],
  WORKSHOP_MANAGER: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ApproveStoresOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  // Sales asks suppliers for prices when costing a job: the project and any new
  // supplier have to exist first. No purchase orders or Procurement RFQs.
  SALES: [
    PermissionCode.ViewSalesRfq,
    PermissionCode.ManageSalesRfq,
    PermissionCode.ManageProjects,
    PermissionCode.CreateSupplier,
    PermissionCode.EditSupplier,
    PermissionCode.ViewReports,
  ],
  TECHNICIAN: [
    PermissionCode.IssueInventory,
    PermissionCode.CheckOutTool,
    PermissionCode.CheckInTool,
    PermissionCode.ViewReports,
    PermissionCode.ViewUsers,
  ],
  VIEWER: [PermissionCode.ViewReports],
};