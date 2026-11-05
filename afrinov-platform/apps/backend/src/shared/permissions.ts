// Permission codes aligned with docs/08-api/authorization.md.
// Format: "action:resource".
export const PermissionCode = {
  CreateMaterial: 'create:material',
  EditMaterial: 'edit:material',
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
  ManageRecipients: 'manage:recipients',
  ManageSettings: 'manage:settings',
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
  PROCUREMENT_MANAGER: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ApproveStoresOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  DIRECTOR: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  CEO: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  WORKSHOP_MANAGER: [PermissionCode.ApprovePurchaseOrder, PermissionCode.ApproveStoresOrder, PermissionCode.ViewPurchaseOrder, PermissionCode.ViewReports],
  TECHNICIAN: [
    PermissionCode.IssueInventory,
    PermissionCode.CheckOutTool,
    PermissionCode.CheckInTool,
    PermissionCode.ViewReports,
    PermissionCode.ViewUsers,
  ],
  VIEWER: [PermissionCode.ViewReports],
};