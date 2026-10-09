// OpenAPI 3 description of the /api/v1 API, served by @fastify/swagger at
// /api/docs.
//
// Request bodies reuse the Zod schemas the route handlers validate with, so
// the documented payloads cannot drift from what the API accepts. Query
// strings that handlers read without a schema are described here directly.
// Response bodies are not described yet: each operation lists its status
// codes, and every error uses the shared Error envelope.
//
// openapi.test.ts fails when a route exists without an entry here (or the
// other way round), so a new endpoint must be added to OPERATIONS.
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';
import { PermissionCode, type PermissionCodeValue } from '../shared/permissions.js';
import { serviceVersion } from '../shared/version.js';
import { auditQuerySchema } from '../modules/audit/audit.routes.js';
import { loginSchema } from '../modules/identity/auth.routes.js';
import { createUserSchema, updateUserSchema } from '../modules/identity/user.routes.js';
import { issueSchema, transferSchema, adjustmentSchema, reversalSchema, stockReceiptSchema, returnSchema, stockCountSchema } from '../modules/inventory/inventory.routes.js';
import {
  createMaterialSchema,
  updateMaterialSchema,
  createLocationSchema,
  updateLocationSchema,
  locationStatusSchema,
} from '../modules/inventory/material.routes.js';
import { createRackSchema, updateRackSchema } from '../modules/inventory/rack.routes.js';
import { createStockItemSchema } from '../modules/inventory/stock-item.routes.js';
import { createProjectSchema, updateProjectSchema } from '../modules/operations/project.routes.js';
import { listRecipientsQuerySchema, createRecipientSchema, updateRecipientSchema } from '../modules/operations/recipient.routes.js';
import {
  createSupplierSchema,
  createPOSchema,
  updatePOSchema,
  listPOQuerySchema,
  receiveSchema,
  closeSchema,
  cancelSchema,
  createGRSchema,
} from '../modules/procurement/procurement.routes.js';
import { setOneSchema, setManySchema } from '../modules/settings/settings.routes.js';
import {
  dateRangePresetSchema,
  materialCategorySchema,
  movementTypeSchema,
  stockStatusSchema,
} from '../modules/reporting/report-query.schema.js';

extendZodWithOpenApi(z);

export const API_PREFIX = '/api/v1';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Operation {
  method: Method;
  /** Fastify-style path under /api/v1, e.g. `/materials/:id`. */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** Public operations need no bearer token. */
  public?: boolean;
  /** Every permission the route checks; all are required. */
  permissions?: PermissionCodeValue[];
  /** ADMIN role required in addition to the permission. */
  adminOnly?: boolean;
  query?: z.AnyZodObject;
  body?: ZodTypeAny;
  success?: number;
  successDescription?: string;
  /** Errors beyond the ones derived from auth, permissions and input. */
  errors?: number[];
  /** Non-JSON success content types (file downloads). */
  produces?: string[];
  /** Only registered when PROCUREMENT_ENABLED is on. */
  procurement?: boolean;
}

const yesNo = z.enum(['true', 'false']);
const locationType = z.enum(['RACK', 'STOREROOM', 'SHOP_FLOOR_AREA', 'CONTAINER', 'OFF_SITE']);
const commaList = (what: string) =>
  z.string().optional().openapi({ description: `${what}. Repeat the parameter or separate values with commas.` });

const reportQuery = z.object({
  range: dateRangePresetSchema.optional().openapi({ description: 'Date range preset. Default ALL. CUSTOM needs from and to.' }),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  category: commaList(`Material categories (${materialCategorySchema.options.join(', ')})`),
  locationId: commaList('Location ids'),
  supplierId: commaList('Supplier ids'),
  materialId: commaList('Material ids'),
  stockStatus: stockStatusSchema.optional().openapi({ description: 'Default ALL.' }),
  itemStatus: z.enum(['ALL', 'ACTIVE', 'INACTIVE']).optional().openapi({ description: 'Default ACTIVE.' }),
  search: z.string().max(100).optional().openapi({ description: 'Matches SKU or name.' }),
  movementType: movementTypeSchema.optional(),
  page: z.coerce.number().int().positive().optional().openapi({ description: 'Default 1.' }),
  pageSize: z.coerce.number().int().positive().max(1000).optional().openapi({ description: 'Default 200.' }),
});

const movementQuery = z.object({
  materialId: z.string().optional(),
  type: movementTypeSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  projectNumber: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional().openapi({ description: 'Default 200, at most 1000.' }),
});

const P = PermissionCode;

export const OPERATIONS: Operation[] = [
  // Health
  { method: 'get', path: '/health', tag: 'Health', summary: 'Liveness: the process is up', public: true },
  {
    method: 'get', path: '/health/ready', tag: 'Health', summary: 'Readiness: the database is reachable', public: true,
    errors: [503],
  },

  // Auth
  {
    method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Log in and receive a bearer token', public: true,
    description: 'The token is valid for 12 hours. Rate limited per IP (RATE_LIMIT_AUTH, default 5 per minute).',
    body: loginSchema, errors: [401, 429],
  },
  { method: 'get', path: '/auth/me', tag: 'Auth', summary: 'The logged-in user' },

  // Users
  { method: 'get', path: '/users', tag: 'Users', summary: 'List users', permissions: [P.ManageUsers] },
  {
    method: 'get', path: '/users/lookup', tag: 'Users', summary: 'Id and name of active users, for pickers',
    permissions: [P.ViewUsers],
  },
  { method: 'get', path: '/users/:id', tag: 'Users', summary: 'Get a user', permissions: [P.ManageUsers], errors: [404] },
  {
    method: 'post', path: '/users', tag: 'Users', summary: 'Create a user with roles', permissions: [P.ManageUsers],
    body: createUserSchema, success: 201, errors: [409],
  },
  {
    method: 'patch', path: '/users/:id', tag: 'Users', summary: 'Rename, (de)activate or change roles',
    permissions: [P.ManageUsers], body: updateUserSchema, errors: [404],
  },

  // Materials
  {
    method: 'get', path: '/materials', tag: 'Materials', summary: 'List materials',
    query: z.object({ category: materialCategorySchema.optional(), active: yesNo.optional(), q: z.string().optional() }),
  },
  { method: 'get', path: '/materials/:id', tag: 'Materials', summary: 'Get a material', errors: [404] },
  {
    method: 'post', path: '/materials', tag: 'Materials', summary: 'Create a material',
    description: 'Answers 200, not 201.', permissions: [P.CreateMaterial], body: createMaterialSchema, errors: [409],
  },
  {
    method: 'patch', path: '/materials/:id', tag: 'Materials', summary: 'Update a material',
    permissions: [P.EditMaterial], body: updateMaterialSchema, errors: [404],
  },
  {
    method: 'post', path: '/stock-items', tag: 'Materials', summary: 'Create a material with its opening stock',
    description: 'A location is required when initialQuantity is above zero.',
    permissions: [P.CreateMaterial, P.ReceiveInventory], body: createStockItemSchema, success: 201, errors: [404, 409],
  },

  // Locations
  {
    method: 'get', path: '/locations', tag: 'Locations', summary: 'List locations',
    query: z.object({ q: z.string().optional(), type: locationType.optional(), active: yesNo.optional() }),
  },
  { method: 'get', path: '/locations/:id', tag: 'Locations', summary: 'Get a location', errors: [404] },
  {
    method: 'post', path: '/locations', tag: 'Locations', summary: 'Create a location',
    permissions: [P.CreateLocation], body: createLocationSchema, success: 201, errors: [409],
  },
  {
    method: 'patch', path: '/locations/:id', tag: 'Locations', summary: 'Update a location',
    permissions: [P.EditLocation], body: updateLocationSchema, errors: [404, 409],
  },
  {
    method: 'patch', path: '/locations/:id/status', tag: 'Locations', summary: 'Activate or deactivate a location',
    permissions: [P.ManageLocationStatus], body: locationStatusSchema, errors: [404],
  },
  {
    method: 'delete', path: '/locations/:id', tag: 'Locations', summary: 'Delete a location',
    permissions: [P.DeleteLocation], success: 204, successDescription: 'Deleted', errors: [404, 409],
  },

  // Racks
  {
    method: 'get', path: '/racks', tag: 'Racks', summary: 'List racks',
    query: z.object({
      q: z.string().optional(),
      locationId: z.string().optional(),
      projectNumber: z.string().optional(),
      status: z.enum(['ACTIVE', 'INACTIVE', 'FULL']).optional(),
    }),
  },
  { method: 'get', path: '/racks/:id', tag: 'Racks', summary: 'Get a rack', errors: [404] },
  {
    method: 'post', path: '/racks', tag: 'Racks', summary: 'Create a rack', permissions: [P.ManageRacks],
    body: createRackSchema, success: 201, errors: [404, 409],
  },
  {
    method: 'patch', path: '/racks/:id', tag: 'Racks', summary: 'Update a rack', permissions: [P.ManageRacks],
    body: updateRackSchema, errors: [404],
  },
  {
    method: 'delete', path: '/racks/:id', tag: 'Racks', summary: 'Archive a rack',
    description: 'Archives rather than deletes, and returns the archived rack.',
    permissions: [P.ManageRacks], errors: [404],
  },

  // Stock movements
  {
    method: 'get', path: '/inventory-transactions', tag: 'Stock movements', summary: 'Movement history, newest first',
    query: movementQuery,
  },
  {
    method: 'post', path: '/inventory-issues', tag: 'Stock movements', summary: 'Issue stock to a recipient',
    description: 'One recipient (required), an optional project, and up to 50 lines, booked all-or-nothing. '
      + 'Lines for the same item and location are checked against stock as one total. '
      + 'Refused with 422 INSUFFICIENT_BALANCE when stock would go below zero, 404 for an unknown recipient, project, '
      + 'material or location, and 400 for an inactive one.',
    permissions: [P.IssueInventory], body: issueSchema, success: 201, errors: [404, 422],
  },
  {
    method: 'post', path: '/stock-receipts', tag: 'Stock movements', summary: 'Receive stock from a supplier',
    description: 'The supplier, delivery/invoice number, delivery date (defaults to now) and up to 50 lines, booked '
      + 'all-or-nothing as a goods receipt with no purchase order. Works with procurement switched off. '
      + 'Refused with 404 for an unknown supplier, material or location, and 400 for an inactive one.',
    permissions: [P.ReceiveInventory], body: stockReceiptSchema, success: 201, errors: [404],
  },
  {
    method: 'post', path: '/inventory-transfers', tag: 'Stock movements', summary: 'Move stock between two locations',
    description: 'Records two linked transactions. Refused with 422 INSUFFICIENT_BALANCE when the source is short.',
    permissions: [P.TransferInventory], body: transferSchema, success: 201, errors: [404, 422],
  },
  {
    method: 'post', path: '/stock-counts', tag: 'Stock movements', summary: 'Post a stock count for one location',
    description: 'The counted quantity of each item, with the system quantity the counter was shown. Every difference '
      + 'is posted as a COUNT_VARIANCE adjustment linked to one count id; items that match are recorded as counted only. '
      + 'All or nothing. Refused with 409 CONFLICT when the stock at the location has changed since it was shown, '
      + 'and 404 for an unknown location or material.',
    permissions: [P.AdjustInventory], body: stockCountSchema, success: 201, errors: [404, 409],
  },
  {
    method: 'post', path: '/inventory-adjustments', tag: 'Stock movements', summary: 'Correct stock up or down with a reason',
    permissions: [P.AdjustInventory], body: adjustmentSchema, success: 201, errors: [404, 422],
  },
  {
    method: 'post', path: '/inventory-transactions/:id/returns', tag: 'Stock movements',
    summary: 'Return unused stock from an issue',
    description: 'Posts a RETURN that points at the issue and keeps its recipient and project, into the given location '
      + '(default: where it was issued from). At most the issued quantity less earlier returns. '
      + 'Refused with 400 when that is exceeded and 409 INVALID_STATE for anything but an unreversed issue.',
    permissions: [P.IssueInventory], body: returnSchema, success: 201, errors: [400, 404, 409],
  },
  {
    method: 'post', path: '/inventory-transactions/:id/reversal', tag: 'Stock movements',
    summary: 'Reverse a movement',
    description: 'Posts an opposite entry linked to the original; the ledger is never edited. Both legs of a transfer are reversed together. '
      + 'Refused with 409 CONFLICT when already reversed, 409 INVALID_STATE for a reversal or a goods-receipt receipt, and 422 INSUFFICIENT_BALANCE when the stock has already been used.',
    permissions: [P.ReverseInventoryTransaction], body: reversalSchema, success: 201, errors: [404, 409, 422],
  },

  // Projects
  {
    method: 'get', path: '/projects', tag: 'Projects', summary: 'List projects',
    query: z.object({
      q: z.string().optional(),
      status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
      active: yesNo.optional(),
    }),
  },
  { method: 'get', path: '/projects/:projectNumber', tag: 'Projects', summary: 'Get a project', errors: [404] },
  {
    method: 'post', path: '/projects', tag: 'Projects', summary: 'Create a project', permissions: [P.ManageProjects],
    body: createProjectSchema, success: 201, errors: [409],
  },
  {
    method: 'patch', path: '/projects/:projectNumber', tag: 'Projects', summary: 'Update a project',
    permissions: [P.ManageProjects], body: updateProjectSchema, errors: [404],
  },
  {
    method: 'delete', path: '/projects/:projectNumber', tag: 'Projects', summary: 'Archive a project',
    description: 'Archives rather than deletes, and returns the archived project.',
    permissions: [P.ManageProjects], errors: [404],
  },

  // Recipients ("Issued To")
  {
    method: 'get', path: '/recipients', tag: 'Recipients', summary: 'List the people and places stock is issued to',
    description: 'Workers, machines, client sites and contractors. Any signed-in user can read the list.',
    query: listRecipientsQuerySchema, errors: [400],
  },
  { method: 'get', path: '/recipients/:id', tag: 'Recipients', summary: 'Get a recipient', errors: [404] },
  {
    method: 'post', path: '/recipients', tag: 'Recipients', summary: 'Add a recipient',
    description: 'Names are unique ignoring case. Refused with 409 when the name is taken.',
    permissions: [P.ManageRecipients], body: createRecipientSchema, success: 201, errors: [409],
  },
  {
    method: 'patch', path: '/recipients/:id', tag: 'Recipients', summary: 'Update or deactivate a recipient',
    description: 'Recipients are deactivated, never deleted, so issue history keeps its names.',
    permissions: [P.ManageRecipients], body: updateRecipientSchema, errors: [404, 409],
  },

  // Suppliers (always on)
  {
    method: 'get', path: '/suppliers', tag: 'Suppliers', summary: 'List suppliers',
    query: z.object({ q: z.string().optional() }),
  },
  {
    method: 'post', path: '/suppliers', tag: 'Suppliers', summary: 'Create a supplier', permissions: [P.CreateSupplier],
    body: createSupplierSchema, success: 201, errors: [409],
  },

  // Purchase orders and goods receipts (PROCUREMENT_ENABLED)
  {
    method: 'get', path: '/purchase-orders', tag: 'Purchase orders', summary: 'List purchase orders', procurement: true,
    permissions: [P.ViewPurchaseOrder],
    query: listPOQuerySchema, errors: [400],
  },
  {
    method: 'get', path: '/purchase-orders/:id', tag: 'Purchase orders', summary: 'Get a purchase order with its lines',
    procurement: true, permissions: [P.ViewPurchaseOrder], errors: [404],
  },
  {
    method: 'post', path: '/purchase-orders', tag: 'Purchase orders', summary: 'Create a draft purchase order',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: createPOSchema, success: 201, errors: [404],
  },
  {
    method: 'patch', path: '/purchase-orders/:id', tag: 'Purchase orders', summary: 'Update notes or expected delivery',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: updatePOSchema, errors: [404, 409],
  },
  {
    method: 'get', path: '/purchase-orders/:id/history', tag: 'Purchase orders', summary: 'Status change history',
    procurement: true, permissions: [P.ViewPurchaseOrder], errors: [404],
  },
  {
    method: 'post', path: '/purchase-orders/:id/submit', tag: 'Purchase orders', summary: 'Submit a draft',
    description: 'Goes to PENDING_APPROVAL, or straight to APPROVED when approval is turned off in settings.',
    procurement: true, permissions: [P.SubmitPurchaseOrder], errors: [404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/approve', tag: 'Purchase orders', summary: 'Approve a submitted order',
    procurement: true, permissions: [P.ApprovePurchaseOrder], errors: [404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/receive', tag: 'Purchase orders',
    summary: 'Receive everything still outstanding',
    description: 'Receives each line\'s outstanding quantity into the given location and marks the order RECEIVED. '
      + 'Allowed when APPROVED or PARTIALLY_RECEIVED. Partial deliveries go through goods receipts.',
    procurement: true, permissions: [P.ReceivePurchaseOrder], body: receiveSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/close', tag: 'Purchase orders', summary: 'Close an order that will receive nothing more',
    description: 'Allowed when PARTIALLY_RECEIVED or RECEIVED. Closing an order that is not fully received needs a reason.',
    procurement: true, permissions: [P.ClosePurchaseOrder], body: closeSchema, errors: [400, 404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/cancel', tag: 'Purchase orders', summary: 'Cancel an order with a reason',
    description: 'Refused with 403 when cancellation is turned off in settings.',
    procurement: true, permissions: [P.CancelPurchaseOrder], body: cancelSchema, errors: [404, 409],
  },
  {
    method: 'get', path: '/goods-receipts', tag: 'Goods receipts', summary: 'List goods receipts', procurement: true,
    permissions: [P.ViewGoodsReceipt],
  },
  {
    method: 'get', path: '/goods-receipts/:id', tag: 'Goods receipts', summary: 'Get a goods receipt with its lines',
    procurement: true, permissions: [P.ViewGoodsReceipt], errors: [404],
  },
  {
    method: 'post', path: '/goods-receipts', tag: 'Goods receipts', summary: 'Record a delivery (status SUBMITTED)',
    description: 'Stock does not change until the receipt is posted.',
    procurement: true, permissions: [P.ReceiveInventory], body: createGRSchema, success: 201, errors: [404],
  },
  {
    method: 'post', path: '/goods-receipts/:id/post', tag: 'Goods receipts', summary: 'Post a receipt into stock',
    description:
      'All-or-nothing. 400 when a line would exceed its order line\'s ordered quantity; 409 when already posted.',
    procurement: true, permissions: [P.ReceiveInventory], errors: [404, 409],
  },

  // Reports
  {
    method: 'get', path: '/reports/current-stock', tag: 'Reports', summary: 'Stock on hand per material and location',
    permissions: [P.ViewReports],
    query: z.object({ category: materialCategorySchema.optional(), locationId: z.string().optional(), materialId: z.string().optional() }),
  },
  {
    method: 'get', path: '/reports/movement-history', tag: 'Reports', summary: 'Movement history for reporting',
    permissions: [P.ViewReports], query: movementQuery,
  },
  {
    method: 'get', path: '/reports/stock-status', tag: 'Reports', summary: 'Stock status of every active item',
    description: 'On hand across all locations as a percentage of Required Stock: URGENT below '
      + 'inventory.urgentBelowPercent (default 20), WARNING below inventory.warningBelowPercent (default 40), '
      + 'otherwise OK; NOT_SET when the item has no Required Stock. With the re-order quantity (Required Stock '
      + 'less on hand) and stock per location. Optional ?status=URGENT,WARNING and ?category= filters. '
      + 'Most urgent first.',
    permissions: [P.ViewReports], errors: [400],
  },
  {
    method: 'get', path: '/reports/stock-value', tag: 'Reports', summary: 'Value of the stock on hand, per category',
    description: 'For every active item: on hand across all locations × unit price, added up per category as the stock '
      + "workbook's Summary sheets do, with item counts, items in stock but without a price, each category's share, and "
      + 'the number of items URGENT, WARNING, OK, NOT_SET and out of stock.',
    permissions: [P.ViewReports],
  },
  {
    method: 'get', path: '/reports/consumption', tag: 'Reports', summary: 'Stock used in a date range',
    description: 'Issued less returned per item between ?from and ?to (YYYY-MM-DD, both included; default this month), '
      + 'valued at the unit price, with totals by project and by category. Reversed issues and returns are left out with '
      + 'their reversals. Totals by project, by recipient and by category. Optional ?projectNumber= (__none__ for issues '
      + 'with no project), ?category= and ?recipientId= (__none__ for issues with no recipient recorded); with a recipient, '
      + 'their issues and returns are listed one by one, newest first (up to 1000).',
    permissions: [P.ViewReports], errors: [400],
  },
  {
    method: 'get', path: '/reports/consumption/export', tag: 'Reports', summary: 'Download stock used as Excel',
    description: 'The consumption report, same query, as By item (grouped by category), By project and By recipient '
      + 'sheets, plus an Issues sheet when one recipient is asked for.',
    permissions: [P.ViewReports], errors: [400],
    produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    method: 'get', path: '/reports/reorder-list/export', tag: 'Reports', summary: 'Download the re-order list',
    description: 'Every URGENT and WARNING item as an Excel file, grouped by category: re-order quantity (Required Stock '
      + 'less on hand), unit price, re-order value with subtotals and a total, and the supplier of the latest goods receipt. '
      + 'Optional ?category= filter.',
    permissions: [P.ViewReports],
    produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    method: 'get', path: '/reports/low-stock', tag: 'Reports', summary: 'Items that need re-ordering (URGENT or WARNING)',
    description: 'The stock status report limited to URGENT and WARNING; empty when inventory.enableStockAlerts is off.',
    permissions: [P.ViewReports],
  },
  {
    method: 'get', path: '/reports/project-consumption/:projectNumber', tag: 'Reports',
    summary: 'Stock issued to a project', permissions: [P.ViewReports],
  },
  {
    method: 'get', path: '/reports/inventory', tag: 'Reports', summary: 'Inventory report: KPIs, breakdowns and lines',
    permissions: [P.ViewReports], query: reportQuery,
  },
  {
    method: 'get', path: '/reports/inventory/export', tag: 'Reports', summary: 'Download the inventory report',
    description: 'Same filters as /reports/inventory.', permissions: [P.ViewReports],
    query: reportQuery.extend({ format: z.enum(['xlsx', 'pdf']).optional().openapi({ description: 'Default xlsx.' }) }),
    produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'],
  },

  // Settings
  {
    method: 'get', path: '/settings', tag: 'Settings', summary: 'List settings with their metadata',
    query: z.object({ category: z.string().optional() }),
  },
  {
    method: 'get', path: '/settings/values', tag: 'Settings', summary: 'Current values of selected settings',
    query: z.object({ keys: z.string().optional().openapi({ description: 'Comma-separated setting keys.' }) }),
  },
  { method: 'get', path: '/settings/:key', tag: 'Settings', summary: 'Get one setting', errors: [404] },
  {
    method: 'put', path: '/settings/:key', tag: 'Settings', summary: 'Set one setting', adminOnly: true,
    permissions: [P.ManageSettings], body: setOneSchema, errors: [404],
  },
  {
    method: 'patch', path: '/settings', tag: 'Settings', summary: 'Set several settings at once', adminOnly: true,
    permissions: [P.ManageSettings], body: setManySchema, errors: [404],
  },
  {
    method: 'post', path: '/settings/reset', tag: 'Settings', summary: 'Reset every setting to its default',
    adminOnly: true, permissions: [P.ManageSettings],
  },

  // Audit
  {
    method: 'get', path: '/audit', tag: 'Audit', summary: 'Audit log entries, newest first',
    permissions: [P.ViewAuditLog], query: auditQuerySchema,
  },
];

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'Invalid input (VALIDATION_ERROR)',
  401: 'Missing, invalid or expired token, or the account is inactive',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict with the current state (CONFLICT or INVALID_STATE)',
  422: 'Not enough stock (INSUFFICIENT_BALANCE)',
  429: 'Rate limited; see the Retry-After header',
  503: 'Database unreachable',
};

/** `/materials/:id` → `/materials/{id}` */
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, '{$1}');
}

function describe(op: Operation): string | undefined {
  const parts: string[] = [];
  if (op.description) parts.push(op.description);
  if (op.permissions?.length) {
    const codes = op.permissions.map((p) => `\`${p}\``).join(' and ');
    parts.push(`Requires ${op.adminOnly ? 'the ADMIN role and ' : ''}permission ${codes}.`);
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

export function operationsFor(opts: { procurementEnabled: boolean }): Operation[] {
  return OPERATIONS.filter((op) => opts.procurementEnabled || !op.procurement);
}

export function buildOpenApiDocument(opts: { procurementEnabled: boolean }) {
  const registry = new OpenAPIRegistry();
  const errorSchema = registry.register(
    'Error',
    z.object({
      error: z.object({
        code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    }),
  );
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  for (const op of operationsFor(opts)) {
    const errors = new Set(op.errors ?? []);
    if (!op.public) errors.add(401);
    if (op.permissions?.length) errors.add(403);
    if (op.body || op.query) errors.add(400);

    const params = [...op.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
    const success = op.success ?? 200;
    const successContent = op.produces
      ? Object.fromEntries(op.produces.map((type) => [type, { schema: z.string().openapi({ format: 'binary' }) }]))
      : undefined;

    registry.registerPath({
      method: op.method,
      path: toOpenApiPath(op.path),
      tags: [op.tag],
      summary: op.summary,
      description: describe(op),
      security: op.public ? [] : [{ [bearer.name]: [] }],
      request: {
        params: params.length ? z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) : undefined,
        query: op.query,
        body: op.body ? { content: { 'application/json': { schema: op.body } }, required: true } : undefined,
      },
      responses: {
        [success]: { description: op.successDescription ?? 'Success', content: successContent },
        ...Object.fromEntries(
          [...errors].sort().map((code) => [
            code,
            { description: ERROR_DESCRIPTIONS[code] ?? 'Error', content: { 'application/json': { schema: errorSchema } } },
          ]),
        ),
      },
    });
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Afrinov Inventory & Operations API',
      version: serviceVersion,
      description:
        'Log in with `POST /auth/login`, then send the token as `Authorization: Bearer <token>`. ' +
        'Errors always have the shape `{ "error": { "code", "message", "details" } }`.' +
        (opts.procurementEnabled ? '' : '\n\nPurchase orders and goods receipts are switched off on this server.'),
    },
    servers: [{ url: API_PREFIX }],
  });
}
