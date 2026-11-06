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
import { ACTIVITY_TYPES } from '../modules/audit/activity.service.js';
import { loginSchema } from '../modules/identity/auth.routes.js';
import { createUserSchema, updateUserSchema } from '../modules/identity/user.routes.js';
import {
  issueSchema, transferSchema, adjustmentSchema, reversalSchema, stockReceiptSchema, returnSchema, returnManySchema, returnableQuerySchema, stockCountSchema,
  consumableOutcomeSchema, outcomeWithdrawalSchema, adjustmentRequestQuerySchema, adjustmentRejectionSchema,
} from '../modules/inventory/inventory.routes.js';
import { toolCheckInSchema, toolCheckOutSchema, toolLoanDueDateSchema } from '../modules/inventory/tool.routes.js';
import {
  createMaterialSchema,
  moveLeftoversSchema,
  updateMaterialSchema,
  materialStatusSchema,
  createLocationSchema,
  updateLocationSchema,
  locationStatusSchema,
} from '../modules/inventory/material.routes.js';
import { createStockItemSchema } from '../modules/inventory/stock-item.routes.js';
import { createProjectSchema, updateProjectSchema } from '../modules/operations/project.routes.js';
import { listRecipientsQuerySchema, createRecipientSchema, updateRecipientSchema } from '../modules/operations/recipient.routes.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  createPOSchema,
  updatePOSchema,
  listPOQuerySchema,
  receiveSchema,
  confirmDeliverySchema,
  closeSchema,
  cancelSchema,
  createGRSchema,
} from '../modules/procurement/procurement.routes.js';
import {
  awardRfqSchema, cancelRfqSchema, createRfqSchema, declineQuoteSchema, linkSalesLineSchema, listRfqQuerySchema, recordQuoteSchema, sendRfqSchema, updateRfqSchema,
} from '../modules/procurement/rfq.routes.js';
import { createSalesRfqSchema, listSalesRfqQuerySchema, updateSalesRfqSchema } from '../modules/sales/sales-rfq.routes.js';
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
  /**
   * The permission for a project order, where a Stores order (no project)
   * needs order:stores_stock instead (Stores ordering roadmap).
   */
  byOrderKind?: PermissionCodeValue;
  /** ADMIN role required in addition to the permission. */
  adminOnly?: boolean;
  query?: z.ZodObject<z.ZodRawShape>;
  body?: ZodTypeAny;
  success?: number;
  successDescription?: string;
  /** Errors beyond the ones derived from auth, permissions and input. */
  errors?: number[];
  /** Non-JSON success content types (file downloads). */
  produces?: string[];
  /** A request body sent as a file of this type (an upload), not as JSON. */
  consumes?: string;
  /** Only registered when PROCUREMENT_ENABLED is on. */
  procurement?: boolean;
}

const yesNo = z.enum(['true', 'false']);
const locationType = z.enum(['RACK', 'STOREROOM', 'SHOP_FLOOR_AREA', 'CONTAINER', 'OFF_SITE']);
const commaList = (what: string) =>
  z.string().optional().openapi({ description: `${what}. Repeat the parameter or separate values with commas.` });

const reportQuery = z.object({
  range: dateRangePresetSchema.optional().openapi({ description: 'Date range preset. Default ALL. CUSTOM needs from and to.' }),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
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

const movementFilters = z.object({
  materialId: z.string().optional(),
  type: movementTypeSchema.optional(),
  from: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, from its start, UTC) or an ISO time.' }),
  to: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, included in full, UTC) or an ISO time.' }),
  projectNumber: z.string().optional(),
  locationId: z.string().optional(),
  inside: z.enum(['true', 'false']).optional().openapi({ description: 'true: the location and the locations inside it (a room and its racks). Otherwise just the location.' }),
  actorId: z.string().optional().openapi({ description: 'Who posted the movement.' }),
  recipientId: z.string().optional().openapi({
    description: "Who it was issued to (with report=writeoffs: who was responsible); '__none__' for none recorded "
      + '(with report=writeoffs: damage, loss or scrap with nobody known).',
  }),
  q: z.string().optional().openapi({ description: 'Matches item code or name, location, project or who it was issued to.' }),
  report: z.enum(['issued', 'transfers', 'writeoffs', 'loans', 'returned']).optional().openapi({
    description: 'A Movements report: issued stock, transfers (the out leg, with otherLocationName), write-offs (adjustments other than count differences), '
      + 'tool loans (LOAN and LOAN_RETURN: tools checked out and back in, with their due date changes) or returned stock (RETURN, by the date it came back, each with returnOf: '
      + 'the issue it came from). Overrides type.',
  }),
});

const movementQuery = movementFilters.extend({
  before: z.string().optional().openapi({ description: "Paging: the `cursor` of the last row already shown; returns the next, older rows." }),
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
    description: 'The token is valid for 12 hours. Rate limited per IP (RATE_LIMIT_AUTH, default 5 per minute). '
      + 'The user carries their roles and the permission codes those roles grant.',
    body: loginSchema, errors: [401, 429],
  },
  {
    method: 'get', path: '/auth/me', tag: 'Auth', summary: 'The logged-in user',
    description: 'Their id, email, name, roles (from the token) and permissions, read from the database on each call.',
  },

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
    description: 'Each material carries its section (STORES or PROJECTS) and, for Projects material, its project.',
    query: z.object({
      category: materialCategorySchema.optional(), active: yesNo.optional(), q: z.string().optional(),
      section: z.enum(['STORES', 'PROJECTS']).optional(), projectNumber: z.string().optional(),
    }),
    errors: [400],
  },
  {
    method: 'get', path: '/materials/summary', tag: 'Materials', summary: 'How the catalogue adds up against Stock and Tools',
    description: 'Items per Materials tab (Stores, Tools, Projects), which add up to the catalogue; the lines and items on Stock; '
      + 'Stores and Tools items with no line on Stock and by stock state; and the tools the Tools page lists.',
    permissions: [P.ViewReports],
  },
  { method: 'get', path: '/materials/:id', tag: 'Materials', summary: 'Get a material', errors: [404] },
  {
    method: 'get', path: '/units-of-measure', tag: 'Materials', summary: 'List units of measure',
    description: 'Every unit an item can have, in display order. A COUNTED unit takes whole quantities only; a MEASURED one up to 4 decimal places. needsReview marks a unit carried over from before the list that matched none of its codes.',
  },
  {
    method: 'post', path: '/materials', tag: 'Materials', summary: 'Create a material',
    description: 'Answers 200, not 201. A Projects material needs no project of its own (the order it is bought on says which); any project given must be open. A Stores material has no project.', permissions: [P.CreateMaterial], body: createMaterialSchema, errors: [409],
  },
  {
    method: 'patch', path: '/materials/:id', tag: 'Materials', summary: 'Update a material',
    description: 'Not its status: sending active is refused, as an item is deactivated or reactivated with a reason on /materials/:id/status.',
    permissions: [P.EditMaterial], body: updateMaterialSchema, errors: [404],
  },
  {
    method: 'patch', path: '/materials/:id/status', tag: 'Materials', summary: 'Deactivate or reactivate a material',
    description: 'Takes a reason from the list for that change, and a note when the reason is OTHER. Adds a row to Movements (type ITEM_DEACTIVATED or ITEM_REACTIVATED, quantity null); no stock moves. '
      + 'Changing an item to the status it already has does nothing, so a retry is safe.',
    permissions: [P.EditMaterial], body: materialStatusSchema, errors: [404],
  },
  {
    method: 'post', path: '/stock-items', tag: 'Materials', summary: 'Create a material with its opening stock',
    description: 'A location is required when initialQuantity is above zero.',
    permissions: [P.CreateMaterial, P.ReceiveInventory], body: createStockItemSchema, success: 201, errors: [404, 409],
  },

  // Locations
  {
    method: 'get', path: '/locations', tag: 'Locations', summary: 'List locations',
    query: z.object({
      q: z.string().optional(), type: locationType.optional(), active: yesNo.optional(),
      parentId: z.string().optional().openapi({ description: 'Only the locations inside this room or area.' }),
    }),
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

  // Stock movements
  {
    method: 'get', path: '/inventory-transactions', tag: 'Stock movements', summary: 'Movement history, newest first',
    description: 'Ledger lines, and (for all movements and report=loans, unless type or issue slips narrow it) tool loan due date '
      + 'changes listed among them by when they were made: type DUE_DATE_CHANGE, quantity null (no stock moved), dueOn the new date, '
      + 'previousDueOn the one it replaced, reasonNote why, referenceId the loan. A check-out (LOAN) carries dueOn (agreed), '
      + 'currentDueOn and overdueOverrideReason; a check-in (LOAN_RETURN) carries dueOn (as it stood then) and daysLate '
      + '(zero or less: on time). For all movements and report=returned, used up and broken marks booked with nothing going '
      + 'back on the shelf are listed too, type USED_UP or BROKEN, and every withdrawal of a mark, type OUTCOME_WITHDRAWN: '
      + 'quantity null, usedUpQuantity or brokenQuantity how many, reasonNote the note or why it was withdrawn, returnOf and '
      + 'referenceId the issue (ADR-026). One cursor pages them all. An ISSUE carries returnedQuantity, usedUpQuantity and '
      + 'brokenQuantity so far; a RETURN carries the usedUpQuantity and brokenQuantity marked in the same counter visit, as booked, '
      + 'and bookedMarksLive, whether any of those still counts (the return is reversed only once they are withdrawn); '
      + 'trackUse says whether the item asks for used up or broken.',
    query: movementQuery,
  },
  {
    method: 'get', path: '/inventory-transactions/summary', tag: 'Stock movements', summary: 'How many movements of each type the filters select',
    query: movementFilters,
  },
  {
    method: 'get', path: '/inventory-transactions/actors', tag: 'Stock movements', summary: 'Everyone who has posted a movement (id and name)',
  },
  {
    method: 'get', path: '/inventory-transactions/writeoffs-by-responsible', tag: 'Stock movements',
    summary: 'Write-off totals by who was responsible',
    description: 'Damage, loss and scrap that took stock away, for the same filters as the write-offs report: per responsible '
      + 'recipient (recipientId null: nobody known), how many write-offs and their value at unit cost (an item with no unit '
      + 'cost counts as 0), largest value first (ties by name, nobody known last), as { currency, totals }. Reversed write-offs and their reversals are left out. '
      + 'The report filter is implied.',
    query: movementFilters,
  },
  {
    method: 'get', path: '/inventory-transactions/export', tag: 'Stock movements', summary: 'Download the filtered movement history as Excel',
    description: 'Refused with 400 when the filters select more than 10,000 movements.',
    query: movementFilters, errors: [400],
    produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    method: 'post', path: '/inventory-issues', tag: 'Stock movements', summary: 'Issue stock to a recipient',
    description: 'One recipient (required), an optional project, and up to 50 lines, booked all-or-nothing. '
      + 'Each line takes Stores stock, or, with heldForProject, the stock held for the issue\'s project: a project\'s own stock '
      + 'goes to that project only (400 otherwise), while Stores stock follows its item (a leftover goes to its item\'s project). '
      + 'Lines for the same stock are checked against it as one total. '
      + 'Refused with 422 INSUFFICIENT_BALANCE when stock would go below zero, 404 for an unknown recipient, project, '
      + 'material or location, and 400 for an inactive one. Tools are refused (400): they are checked out, not issued.',
    permissions: [P.IssueInventory], body: issueSchema, success: 201, errors: [404, 422],
  },
  {
    method: 'get', path: '/tools', tag: 'Tools', summary: 'Every active tool: in store where, out on loan and with whom',
    description: 'Per tool: inStore (on the shelf, by location), onLoan, owned (in store + on loan) and its open loans '
      + '(recipient, project, where it came from, how many were lent and how many are still out), each with its due date '
      + '(dueOn), daysLate (negative while days are left), state (ON_LOAN, DUE_SOON, OVERDUE, or NEEDS_DECISION once '
      + 'inventory.toolEscalateDays past due), overdue (past its due date) and its extensions, oldest first.',
  },
  {
    method: 'post', path: '/tools/check-out', tag: 'Tools', summary: 'Lend tools to a recipient',
    description: 'One recipient (required), an optional project and note, and up to 50 lines, booked all-or-nothing as one slip. '
      + 'Each line is a LOAN movement that takes the tool off its location. Tools only. '
      + 'Refused with 422 INSUFFICIENT_BALANCE when fewer are in store there. dueOn defaults to inventory.toolOverdueDays '
      + 'from today, but not after the project’s end date; a chosen dueOn is refused with 400 when before today, after '
      + 'the project ends, or more than inventory.toolMaxLoanDays away (administrators may exceed that). When the recipient '
      + 'already has an overdue tool: 400 unless overrideReason is given (details.overdueLoans lists them), or 409 '
      + 'INVALID_STATE when inventory.toolOverdueCheckout blocks it. Returns the slip, its loans and the due date.',
    permissions: [P.CheckOutTool], body: toolCheckOutSchema, success: 201, errors: [404, 409, 422],
  },
  {
    method: 'post', path: '/tools/check-in', tag: 'Tools', summary: 'Take lent tools back',
    description: 'Each line is against a loan, at most what is still out on it, and comes back to the location it left. '
      + 'GOOD or DAMAGED puts it back in store (LOAN_RETURN); LOST needs a note and writes it off at once '
      + '(LOAN_RETURN and an ADJUSTMENT with reason LOSS), so it is no longer owned. Writing a tool off as LOST also '
      + 'needs adjust:inventory (403 otherwise): a borrower does not write off what they borrowed. A lost tool worth more '
      + 'than inventory.writeOffApprovalAbove, or with no unit cost, stays on loan while its write-off waits for '
      + 'approval by someone else (writeOffRequestIds, its loan in heldLoanIds; lostWaiting on the loan in GET /tools). '
      + 'Whether lost tools wait is decided on everything lost of one tool from one location on the check-in. Approving posts its '
      + 'return and its write-off against the loan. writeOffIds lists the write-offs posted at once.',
    permissions: [P.CheckInTool], body: toolCheckInSchema, success: 201, errors: [404],
  },
  {
    method: 'post', path: '/tools/loans/:id/due-date', tag: 'Tools', summary: 'Change a tool loan’s due date, later or earlier',
    description: 'Recorded as a change with its reason; the loan and its earlier dates are kept, and the most recent change wins. '
      + 'The new date must differ from the current one and not be before today, and is held to the same limits as at '
      + 'check-out (the project’s end date, and inventory.toolMaxLoanDays from check-out unless an administrator). '
      + '409 when the loan is all back. Returns the new and previous dates. Retry-safe with an Idempotency-Key header.',
    permissions: [P.ExtendToolLoan], body: toolLoanDueDateSchema, success: 201, errors: [404, 409],
  },
  {
    method: 'get', path: '/tools/loans/:id/history', tag: 'Tools', summary: 'One tool loan from check-out to now',
    description: 'The loan (tool, recipient, project, location, how many were lent and are still out, its due date and state, '
      + 'null once all back) and its events oldest first: CHECKED_OUT (agreed due date, override reason), DUE_DATE_CHANGED '
      + '(new and previous date, reason), CHECKED_IN (condition, the due date then and daysLate) and BECAME_OVERDUE, which '
      + 'is worked out from the dates and never stored. 404 unless :id is a check-out.',
    errors: [404],
  },
  {
    method: 'get', path: '/inventory-issues', tag: 'Reports', summary: 'Issued stock: issue slips with their lines, newest first',
    description: 'A slip is every line one issue posted; issues from before slips were recorded show as one-line slips. '
      + 'A slip is listed when any of its lines matches the filters. Reversals are not slips; a reversed line carries reversedById.',
    permissions: [P.ViewReports],
    query: movementFilters.omit({ type: true, report: true }).extend({
      before: z.string().optional().openapi({ description: 'Paging: the `cursor` of the last slip already shown.' }),
      limit: z.coerce.number().int().positive().max(200).optional().openapi({ description: 'Default 50, at most 200.' }),
    }),
  },
  {
    method: 'get', path: '/stock-receipts', tag: 'Reports', summary: 'Received stock: posted deliveries with their lines, newest first',
    permissions: [P.ViewReports],
    query: z.object({
      from: z.string().optional().openapi({ description: 'Delivery date, a day (YYYY-MM-DD, UTC), from its start.' }),
      to: z.string().optional().openapi({ description: 'Delivery date, a day (YYYY-MM-DD, UTC), included in full.' }),
      supplierId: z.string().optional(),
      locationId: z.string().optional().openapi({ description: 'Deliveries with a line into this location.' }),
      inside: z.enum(['true', 'false']).optional().openapi({ description: 'true: the location and the locations inside it (a room and its racks). Otherwise just the location.' }),
      q: z.string().optional().openapi({ description: 'Matches the receipt number, delivery note, supplier or an item code or name.' }),
      before: z.string().optional().openapi({ description: 'Paging: the `cursor` of the last delivery already shown.' }),
      limit: z.coerce.number().int().positive().max(200).optional().openapi({ description: 'Default 50, at most 200.' }),
    }),
  },
  {
    method: 'get', path: '/stock-counts', tag: 'Reports', summary: 'Stock counts with their count sheets and differences, newest first',
    description: 'lines is the full sheet (every item counted, with what the system had); counts posted before sheets were kept have no lines, only differences.',
    permissions: [P.ViewReports],
    query: z.object({
      from: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, UTC), from its start.' }),
      to: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, UTC), included in full.' }),
      locationId: z.string().optional(),
      inside: z.enum(['true', 'false']).optional().openapi({ description: 'true: the location and the locations inside it (a room and its racks). Otherwise just the location.' }),
      actorId: z.string().optional().openapi({ description: 'Who counted.' }),
      before: z.string().optional().openapi({ description: 'Paging: the `cursor` of the last count already shown.' }),
      limit: z.coerce.number().int().positive().max(200).optional().openapi({ description: 'Default 50, at most 200.' }),
    }),
  },
  {
    method: 'post', path: '/stock-receipts', tag: 'Stock movements', summary: 'Receive stock from a supplier',
    description: 'The supplier, delivery/invoice number, delivery date (defaults to now) and up to 50 lines, booked '
      + 'all-or-nothing as a goods receipt with no purchase order. Only while procurement is switched off: with it on, '
      + 'every delivery is booked against an approved Stores order (POST /goods-receipts) and this is refused with 400. '
      + 'Refused with 404 for an unknown supplier, material or location, and 400 for an inactive one.',
    permissions: [P.ReceiveInventory], body: stockReceiptSchema, success: 201, errors: [404],
  },
  {
    method: 'post', path: '/inventory-transfers', tag: 'Stock movements', summary: 'Move stock between two locations',
    description: 'Records two linked transactions. With heldForProject, moves that project\'s stock, which stays its at the destination; '
      + 'otherwise Stores stock. Refused with 422 INSUFFICIENT_BALANCE when the source is short, 404 for an unknown project.',
    permissions: [P.TransferInventory], body: transferSchema, success: 201, errors: [404, 422],
  },
  {
    method: 'post', path: '/stock-counts', tag: 'Stock movements', summary: 'Post a stock count for one location',
    description: 'The counted quantity of each item, with the system quantity the counter was shown. Every difference '
      + 'is posted as a COUNT_VARIANCE adjustment linked to one count id; items that match are recorded as counted only. '
      + 'A difference over inventory.writeOffApprovalAbove, or of an item with no unit cost, is recorded for someone '
      + 'else to approve instead (its requestId; waitingForApproval counts them), and posts as part of the count once approved. '
      + 'All or nothing. Refused with 409 CONFLICT when the stock at the location has changed since it was shown, '
      + '409 INVALID_STATE for an item with an adjustment already waiting at the location, 400 for a difference too '
      + 'large for one movement, and 404 for an unknown location or material.',
    permissions: [P.AdjustInventory], body: stockCountSchema, success: 201, errors: [404, 409],
  },
  {
    method: 'post', path: '/inventory-adjustments', tag: 'Stock movements', summary: 'Correct stock up or down with a reason',
    description: 'A signed quantity with a reason. DAMAGE, LOSS and SCRAP may name who was responsible (recipientId, an '
      + 'active recipient); naming someone needs a reasonNote saying what happened. Other reasons take no recipientId. '
      + 'With heldForProject, adjusts that project\'s stock; otherwise Stores stock. '
      + '400 VALIDATION_ERROR for either rule, 404 for an unknown material, location, recipient or project. '
      + 'Worth more than inventory.writeOffApprovalAbove (rand, at the unit cost of the item), or for an item with no cost, '
      + 'nothing is posted: 202 with status PENDING_APPROVAL, the requestId, value and limit, until someone else approves it. '
      + 'Otherwise 201 with status POSTED and the transactionId.',
    permissions: [P.AdjustInventory], body: adjustmentSchema, success: 201, errors: [202, 404, 422],
  },
  {
    method: 'get', path: '/adjustment-requests', tag: 'Stock movements', summary: 'Adjustments waiting for approval, or decided',
    description: 'Newest first, at most 200: PENDING unless another status is asked for, each with its item, location, '
      + 'who asked and who decided. Needs approve:write_off or adjust:inventory.',
    query: adjustmentRequestQuerySchema, errors: [403],
  },
  {
    method: 'post', path: '/adjustment-requests/:id/approve', tag: 'Stock movements', summary: 'Approve an adjustment someone else asked for',
    description: 'Posts the ADJUSTMENT, booked to whoever asked for it, checked again against the stock now. 403 for your own '
      + 'request, 409 INVALID_STATE once decided, 422 when there is no longer enough stock. Retry-safe with an Idempotency-Key header.',
    permissions: [P.ApproveWriteOff], success: 201, errors: [404, 409, 422],
  },
  {
    method: 'post', path: '/adjustment-requests/:id/reject', tag: 'Stock movements', summary: 'Reject or withdraw an adjustment waiting for approval',
    description: 'Posts nothing. Whoever asked for it may withdraw it with adjust:inventory; anyone else needs approve:write_off. '
      + '409 INVALID_STATE once decided. Retry-safe with an Idempotency-Key header.',
    body: adjustmentRejectionSchema, success: 200, errors: [403, 404, 409],
  },
  {
    method: 'post', path: '/inventory-transactions/:id/returns', tag: 'Stock movements',
    summary: 'Return unused stock from an issue',
    description: 'Posts a RETURN that points at the issue and keeps its recipient and project, into the given location '
      + '(default: where it was issued from). At most the issued quantity less earlier returns and what was marked used up or broken. '
      + 'Refused with 400 when that is exceeded and 409 INVALID_STATE for anything but an unreversed issue.',
    permissions: [P.IssueInventory], body: returnSchema, success: 201, errors: [400, 404, 409],
  },
  {
    method: 'get', path: '/inventory-returns/returnable', tag: 'Stock movements',
    summary: 'What a recipient can still bring back',
    description: 'Their unreversed issues in the period (YYYY-MM-DD, the `to` day included), newest first, with the '
      + 'quantity issued, already returned, marked used up or broken (closedOff) and still out, and whether the item '
      + 'tracks use (trackUse); issues with nothing still out are left out. At most the latest '
      + '500 issues are looked at. Refused with 400 without a recipient.',
    permissions: [P.ViewReports], query: returnableQuerySchema, errors: [400],
  },
  {
    method: 'post', path: '/inventory-returns', tag: 'Stock movements',
    summary: 'Book what comes back at the counter',
    description: 'Up to 100 lines, each against its own issue, booked all-or-nothing. On each line, quantity goes '
      + 'back on the shelf as a RETURN (optionally into another location), and for an item that tracks use, usedUp '
      + 'and broken are marked against the issue without moving stock (ADR-026); at least one of the three. The '
      + 'three together, and lines for the same issue, are checked as one total against what is still out. Returns '
      + 'transactionIds (the RETURN rows) and outcomeIds. Refused with 400 when a line asks for more than is still '
      + 'out, 404 for an unknown issue, and 409 INVALID_STATE for anything but an unreversed issue or for used up or '
      + 'broken on an item that does not track use.',
    permissions: [P.IssueInventory], body: returnManySchema, success: 201, errors: [400, 404, 409],
  },
  {
    method: 'post', path: '/inventory-transactions/:id/reversal', tag: 'Stock movements',
    summary: 'Reverse a movement',
    description: 'Posts an opposite entry linked to the original; the ledger is never edited. Both legs of a transfer are reversed together. '
      + 'Refused with 409 CONFLICT when already reversed, 409 INVALID_STATE for a reversal, a receipt against a purchase order, '
      + 'or an adjustment over the write-off limit (put right by an adjustment the other way, for approval), '
      + 'and 422 INSUFFICIENT_BALANCE when the stock has already been used.',
    permissions: [P.ReverseInventoryTransaction], body: reversalSchema, success: 201, errors: [404, 409, 422],
  },
  {
    method: 'get', path: '/inventory-transactions/:id/outcomes', tag: 'Stock movements',
    summary: 'What became of an issue line: used up or broken',
    description: 'For an issue: quantity issued, returned, used up, broken and still out (issued less the other three), whether the '
      + 'item tracks use now, and every outcome oldest first, with its withdrawal when it was withdrawn. 404 for anything but an issue.',
    errors: [404],
  },
  {
    method: 'post', path: '/inventory-transactions/:id/outcomes', tag: 'Stock movements',
    summary: 'Mark part of an issue used up or broken',
    description: 'Only for an item that tracks use after issue (Material.trackUse). No stock moves: it left the shelf at the issue. At most '
      + 'what is still out, which returns share. Refused with 400 when that is exceeded and 409 INVALID_STATE for anything but an '
      + 'unreversed issue of a tracked item. Returns the outcome id and where the issue now stands. Retry-safe with an Idempotency-Key header.',
    permissions: [P.IssueInventory], body: consumableOutcomeSchema, success: 201, errors: [400, 404, 409],
  },
  {
    method: 'post', path: '/consumable-outcomes/:id/withdrawal', tag: 'Stock movements',
    summary: 'Withdraw a used up or broken outcome recorded by mistake',
    description: 'Adds a row naming the outcome, with the reason; both are kept and count for nothing together. Refused with 409 CONFLICT '
      + 'when already withdrawn and 409 INVALID_STATE for a withdrawal. An issue with outcomes is reversed only once they are withdrawn. '
      + 'Retry-safe with an Idempotency-Key header.',
    permissions: [P.ReverseInventoryTransaction], body: outcomeWithdrawalSchema, success: 201, errors: [404, 409],
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
  {
    method: 'get', path: '/projects/:projectNumber/leftovers', tag: 'Projects', summary: 'List the project material still in stock',
    description: 'Its leftovers (Stores stock of its own items) and any item with stock held for it, each with `held`, how much is held for the project, and `itemProject`, the item\'s own. '
      + 'Once the project is completed or cancelled (closed: true), these move to Stores.',
    errors: [404],
  },
  {
    method: 'post', path: '/projects/:projectNumber/leftovers/move', tag: 'Projects', summary: 'Move the leftovers of a closed project to Stores',
    description: 'All or none. Stock held for the project first becomes Stores stock where it is (a linked TRANSFER_OUT and TRANSFER_IN, reference MoveToStores, not reversed on its own). '
      + 'The project\'s own item, or one with no project, then becomes a Stores item in its chosen `category`, keeping its SKU, stock and history, with no project and no Required Stock. '
      + 'A Stores item, or another project\'s item, is sent with no category: it keeps what it is, and only the stock held for this project moves. '
      + 'Refused (400) for an item still on an open project order or request for quotation, or held for another project: it stays project material until that is finished.',
    permissions: [P.EditMaterial], body: moveLeftoversSchema, errors: [404, 409],
  },
  {
    method: 'get', path: '/materials/no-project/leftovers', tag: 'Projects', summary: 'List Projects items with no project still in stock',
    description: 'They are not issued, so they move to Stores. Returns { project: null, items }.',
  },
  {
    method: 'post', path: '/materials/no-project/leftovers/move', tag: 'Projects', summary: 'Move Projects items with no project to Stores',
    description: 'All or none, as for a closed project\'s leftovers: each item becomes a Stores item in its chosen category, keeping its SKU, stock and history, with no Required Stock. Refused (400) for an item still on an open project order or request for quotation: it stays project material until that is finished.',
    permissions: [P.EditMaterial], body: moveLeftoversSchema, errors: [404, 409],
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
    description: 'Names are unique ignoring case, and so are vendor codes. Refused with 409 when either is taken.',
    body: createSupplierSchema, success: 201, errors: [409],
  },
  { method: 'get', path: '/suppliers/:id', tag: 'Suppliers', summary: 'Get a supplier', errors: [404] },
  {
    method: 'patch', path: '/suppliers/:id', tag: 'Suppliers', summary: 'Update, deactivate or reactivate a supplier',
    description: 'Suppliers are deactivated, never deleted, so receipts and purchase orders keep their names. Null or an empty string clears an optional field.',
    permissions: [P.EditSupplier], body: updateSupplierSchema, errors: [404, 409],
  },

  // Purchase orders and goods receipts (PROCUREMENT_ENABLED)
  {
    method: 'get', path: '/purchase-orders', tag: 'Purchase orders', summary: 'List purchase orders', procurement: true,
    description: 'Each side lists only its own: Stores orders (no project) to those with `order:stores_stock`, project orders to those with `view:purchase_order`; one of the two is required (403 otherwise). Those who sign Stores orders (`approve:stores_order`) see them too. With awaitingMyApproval, the orders waiting on this user\'s signature now.',
    query: listPOQuerySchema, errors: [400, 403],
  },
  {
    method: 'get', path: '/purchase-orders/receivable', tag: 'Purchase orders', summary: 'Orders waiting for delivery that you receive',
    description: 'APPROVED and PARTIALLY_RECEIVED orders, for Receive stock: Stores orders to those with `order:stores_stock`, project orders to those with `receive:purchase_order`. '
      + 'A receiving view: the supplier, the project, and each line\'s item with what is ordered and received so far; no prices, approvals or RFQ. Empty for anyone who receives neither kind.',
    procurement: true, permissions: [P.ReceiveInventory], errors: [403],
  },
  {
    method: 'get', path: '/purchase-orders/:id', tag: 'Purchase orders', summary: 'Get a purchase order with its lines',
    description: 'A Stores order (no project) needs `order:stores_stock`, a project order `view:purchase_order`; to anyone without it the order is not found (404), and so are its history and approval.',
    procurement: true, errors: [403, 404],
  },
  {
    method: 'post', path: '/purchase-orders', tag: 'Purchase orders', summary: 'Create a draft purchase order',
    description: 'With a project, a project order of Projects items, any of them: the order says which project they are for, whatever project an item was tagged with. Without one, a Stores order of Stores items only.',
    procurement: true, byOrderKind: P.CreatePurchaseOrder, body: createPOSchema, success: 201, errors: [404],
  },
  {
    method: 'patch', path: '/purchase-orders/:id', tag: 'Purchase orders', summary: 'Update order details, VAT rate, line prices, discounts or delivery dates',
    description: "A project order stays on a project and a Stores order off one (400). A line's discount (`lineDiscounts`, in percent) comes off its unit price; the order's `totals.discount` is what the discounts save, before VAT. Changing a price, a discount or the VAT rate clears the signatures on an order still being signed, and sends an approved order back for approval, with its signatures cleared, when its value excluding VAT rises at all, its VAT rate changes, or it now needs a signature it doesn't have.",
    procurement: true, byOrderKind: P.CreatePurchaseOrder, body: updatePOSchema, errors: [404, 409],
  },
  {
    method: 'get', path: '/purchase-orders/:id/history', tag: 'Purchase orders', summary: 'Status change history',
    description: 'As the order: a Stores order needs `order:stores_stock`, a project order `view:purchase_order`, and to anyone else it is not found (404).',
    procurement: true, errors: [403, 404],
  },
  {
    method: 'post', path: '/purchase-orders/:id/submit', tag: 'Purchase orders', summary: 'Submit a draft',
    description: 'Goes to PENDING_APPROVAL, or straight to APPROVED when approval is turned off in settings. An order in another currency locks the exchange rate from Settings here, and is refused (400) when there is none.',
    procurement: true, byOrderKind: P.SubmitPurchaseOrder, errors: [404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/approve', tag: 'Purchase orders', summary: 'Sign a submitted order',
    description: 'Signs the next step the order needs; the last signature approves it. By value in rand excluding VAT: a project order under the threshold needs the Procurement Manager, one at or above it the Procurement Manager and then the Director; a Stores order needs the Procurement Manager at any value. The CEO or Workshop Manager may stand in on a project order, the Workshop Manager on a Stores order. Every line needs a price and a foreign order an exchange rate (400); anyone else, or someone who has already signed, is refused (403, naming who can sign). Requires `approve:purchase_order` for a project order, `approve:stores_order` for a Stores order.',
    procurement: true, errors: [400, 403, 404, 409],
  },
  {
    method: 'get', path: '/purchase-orders/:id/approval', tag: 'Purchase orders', summary: 'The signatures this order needs, and whether you can give the next',
    description: 'As the order: a Stores order needs `order:stores_stock` or `approve:stores_order`, a project order `view:purchase_order`, and to anyone else it is not found (404).',
    procurement: true, errors: [403, 404],
  },
  {
    method: 'post', path: '/purchase-orders/:id/receive', tag: 'Purchase orders',
    summary: 'Receive everything still outstanding',
    description: 'Receives each line\'s outstanding quantity into the given location and marks the order RECEIVED. '
      + 'Allowed when APPROVED or PARTIALLY_RECEIVED. Partial deliveries go through goods receipts. '
      + 'A Stores order also needs `order:stores_stock`. A project order\'s stock is held for its project. To anyone who receives neither kind the order is not found (404).',
    procurement: true, permissions: [P.ReceivePurchaseOrder], body: receiveSchema, errors: [400, 403, 404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/confirm-delivery', tag: 'Purchase orders',
    summary: 'Retired: project orders are received on Receive stock',
    description: 'Project material comes through the store, so a project order\'s delivery is received into stock held for the project (POST /goods-receipts). '
      + 'This refuses every request (400), pointing there; confirmations made before stay on the order\'s Activity.',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: confirmDeliverySchema, errors: [400, 404],
  },
  {
    method: 'post', path: '/purchase-orders/:id/close', tag: 'Purchase orders', summary: 'Close an order that will receive nothing more',
    description: 'Allowed when PARTIALLY_RECEIVED or RECEIVED. Closing an order that is not fully received needs a reason.',
    procurement: true, byOrderKind: P.ClosePurchaseOrder, body: closeSchema, errors: [400, 404, 409],
  },
  {
    method: 'post', path: '/purchase-orders/:id/cancel', tag: 'Purchase orders', summary: 'Cancel an order with a reason',
    description: 'Refused with 403 when cancellation is turned off in settings.',
    procurement: true, byOrderKind: P.CancelPurchaseOrder, body: cancelSchema, errors: [404, 409],
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
    method: 'post', path: '/goods-receipts', tag: 'Goods receipts', summary: 'Record a delivery (status SUBMITTED), or with post: true record and post it in one step',
    description: 'Against an approved order (purchaseOrderId is required: a receipt with no order is refused with 400): a Stores order needs `order:stores_stock`, '
      + 'a project order `receive:purchase_order`, and its stock is held for the order\'s project. Stock does not change until the receipt is posted. receivedAt is the delivery date (defaults to now; '
      + 'refused with 400 if still to come). Retry-safe with an Idempotency-Key header, as Receive stock sends: a '
      + 'repeat replays the first receipt, and the same key with other details is refused with 409.',
    procurement: true, permissions: [P.ReceiveInventory], body: createGRSchema, success: 201, errors: [404, 409],
  },
  {
    method: 'post', path: '/goods-receipts/:id/post', tag: 'Goods receipts', summary: 'Post a receipt into stock',
    description:
      'All-or-nothing. 400 when a line would exceed its order line\'s ordered quantity; 409 when already posted.',
    procurement: true, permissions: [P.ReceiveInventory], errors: [404, 409],
  },
  {
    method: 'get', path: '/sales-rfqs', tag: 'Sales requests for quotation', summary: 'List Sales requests for quotation',
    procurement: true, permissions: [P.ViewSalesRfq], query: listSalesRfqQuerySchema, errors: [400],
  },
  {
    method: 'get', path: '/sales-rfqs/:id', tag: 'Sales requests for quotation', summary: 'Get a Sales request for quotation with its lines, suppliers and quotes',
    description: "Each supplier carries its VAT rate and, once its quote is recorded, the quote's totals.",
    procurement: true, permissions: [P.ViewSalesRfq], errors: [404],
  },
  {
    method: 'post', path: '/sales-rfqs', tag: 'Sales requests for quotation', summary: 'Raise a draft Sales request for quotation',
    description: 'Lines are typed as the RFQ sheet has them, with a unit on the list; they are not catalogue items.',
    procurement: true, permissions: [P.ManageSalesRfq], body: createSalesRfqSchema, success: 201,
  },
  {
    method: 'patch', path: '/sales-rfqs/:id', tag: 'Sales requests for quotation', summary: 'Change a draft, or a sent RFQ\'s closing date and suppliers',
    procurement: true, permissions: [P.ManageSalesRfq], body: updateSalesRfqSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/sales-rfqs/:id/send', tag: 'Sales requests for quotation', summary: 'Mark a draft as sent to its suppliers',
    description: 'Nothing is emailed: each supplier\'s copy is downloaded and sent by hand.',
    procurement: true, permissions: [P.ManageSalesRfq], body: sendRfqSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/sales-rfqs/:id/cancel', tag: 'Sales requests for quotation', summary: 'Cancel a draft or sent Sales request for quotation',
    procurement: true, permissions: [P.ManageSalesRfq], body: cancelRfqSchema, errors: [404, 409],
  },
  {
    method: 'put', path: '/sales-rfqs/:id/suppliers/:supplierId/quote', tag: 'Sales requests for quotation', summary: "Record or correct a supplier's quote",
    procurement: true, permissions: [P.ManageSalesRfq], body: recordQuoteSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/sales-rfqs/:id/suppliers/:supplierId/decline', tag: 'Sales requests for quotation', summary: "Record that a supplier won't quote",
    procurement: true, permissions: [P.ManageSalesRfq], body: declineQuoteSchema, errors: [404, 409],
  },
  {
    method: 'put', path: '/sales-rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Sales requests for quotation', summary: "Attach the supplier's quotation PDF",
    description: 'The body is the PDF itself (application/pdf, up to 10 MB), with its name in the X-File-Name header.',
    procurement: true, permissions: [P.ManageSalesRfq], errors: [404, 409],
  },
  {
    method: 'get', path: '/sales-rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Sales requests for quotation', summary: "Download the supplier's quotation PDF",
    procurement: true, permissions: [P.ViewSalesRfq], errors: [404],
  },
  {
    method: 'delete', path: '/sales-rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Sales requests for quotation', summary: "Take off the supplier's quotation PDF",
    procurement: true, permissions: [P.ManageSalesRfq], errors: [404, 409],
  },
  {
    method: 'get', path: '/sales-rfqs/:id/history', tag: 'Sales requests for quotation', summary: "A Sales request for quotation's Activity",
    procurement: true, permissions: [P.ViewSalesRfq], errors: [404],
  },
  {
    method: 'get', path: '/rfqs', tag: 'Requests for quotation', summary: 'List requests for quotation',
    procurement: true, permissions: [P.ViewPurchaseOrder], query: listRfqQuerySchema, errors: [400],
  },
  {
    method: 'get', path: '/rfqs/:id', tag: 'Requests for quotation', summary: 'Get a request for quotation with its lines, suppliers and quotes',
    description: "Each supplier carries its VAT rate and, once its quote is recorded, the quote's totals.",
    procurement: true, permissions: [P.ViewPurchaseOrder], errors: [404],
  },
  {
    method: 'post', path: '/rfqs', tag: 'Requests for quotation', summary: 'Raise a draft request for quotation',
    description: "For one project and Projects items only, any of them (the RFQ says which project they are for): Stores stock is ordered without an RFQ. Numbered AFRI-02A-<project>-02-<nn> (other project numbers RFQ-<project>-<nn>). The description defaults to the project's name.",
    procurement: true, permissions: [P.CreatePurchaseOrder], body: createRfqSchema, success: 201,
  },
  {
    method: 'get', path: '/rfqs/:id/sales-lines', tag: 'Requests for quotation', summary: 'The Sales lines its lines can be linked to',
    description: "The lines of Sales RFQs sent for this RFQ's project: what was asked for, never a price or a supplier.",
    procurement: true, permissions: [P.CreatePurchaseOrder], errors: [404],
  },
  {
    method: 'put', path: '/rfqs/:id/lines/:lineId/sales-line', tag: 'Requests for quotation', summary: 'Link a line to a Sales line, or take the link off',
    description: 'For the savings report. Several lines can share a Sales line, which must be on a Sales RFQ sent for the same project. Can be corrected at any point until the RFQ is cancelled (409).',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: linkSalesLineSchema, errors: [404, 409],
  },
  {
    method: 'patch', path: '/rfqs/:id', tag: 'Requests for quotation', summary: 'Change a draft request for quotation',
    description: "On a draft, lines and suppliers, when sent, replace the draft's, and a new project gives it that project's next number. Once sent, only the closing date changes and suppliers are added, none taken off (409 otherwise).",
    procurement: true, permissions: [P.CreatePurchaseOrder], body: updateRfqSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/rfqs/:id/send', tag: 'Requests for quotation', summary: 'Send a draft to its suppliers',
    description: 'Issued today (South African time); closes on the date given, or four days later. Needs a supplier to ask; its lines and suppliers are checked again.',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: sendRfqSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/rfqs/:id/cancel', tag: 'Requests for quotation', summary: 'Cancel a draft or sent request for quotation',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: cancelRfqSchema, errors: [404, 409],
  },
  {
    method: 'put', path: '/rfqs/:id/suppliers/:supplierId/quote', tag: 'Requests for quotation', summary: "Record or correct a supplier's quote",
    description: 'A unit price per line the supplier priced (excluding VAT, in their currency); lines they don\'t offer are left out. Only while the RFQ is sent (409 otherwise). A supplier who had declined has now quoted.',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: recordQuoteSchema, errors: [404, 409],
  },
  {
    method: 'post', path: '/rfqs/:id/suppliers/:supplierId/decline', tag: 'Requests for quotation', summary: "Record that a supplier won't quote",
    description: 'Sets aside a quote recorded for them before. Only while the RFQ is sent.',
    procurement: true, permissions: [P.CreatePurchaseOrder], body: declineQuoteSchema, errors: [404, 409],
  },
  {
    method: 'put', path: '/rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Requests for quotation', summary: "Attach the supplier's quotation PDF",
    description: 'The PDF itself as the body, up to 10 MB, with its name URI-encoded in the X-File-Name header. Replaces one attached before. Only while the RFQ is sent.',
    procurement: true, permissions: [P.CreatePurchaseOrder], consumes: 'application/pdf', errors: [404, 409, 413, 415],
  },
  {
    method: 'get', path: '/rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Requests for quotation', summary: "Download the supplier's quotation PDF",
    procurement: true, permissions: [P.ViewPurchaseOrder], produces: ['application/pdf'], errors: [404],
  },
  {
    method: 'delete', path: '/rfqs/:id/suppliers/:supplierId/quote-file', tag: 'Requests for quotation', summary: "Take off the supplier's quotation PDF",
    procurement: true, permissions: [P.CreatePurchaseOrder], errors: [404, 409],
  },
  {
    method: 'post', path: '/rfqs/:id/award', tag: 'Requests for quotation', summary: 'Award to one supplier, raising a draft purchase order',
    description: "A draft order for the supplier, with the RFQ's project, penalties and lines at their quoted prices, saved with the award or not at all. A reason is required (400, listing why) when they didn't price every line, their quote has run out, or a complete quote in the same currency is cheaper. Only while sent (409 otherwise).",
    procurement: true, permissions: [P.CreatePurchaseOrder], body: awardRfqSchema, errors: [404, 409],
  },
  {
    method: 'get', path: '/rfqs/:id/history', tag: 'Requests for quotation', summary: 'Activity on a request for quotation',
    procurement: true, permissions: [P.ViewPurchaseOrder], errors: [404],
  },

  // Reports
  {
    method: 'get', path: '/reports/current-stock', tag: 'Reports', summary: 'Stock on hand per material, location and project it is held for',
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
      + 'otherwise OK; NOT_SET when the item has no Required Stock. With what is on order (still to come on approved '
      + 'or partly received Stores orders, per order with its due date), the re-order quantity (Required Stock '
      + 'less on hand and on order), stock per location, what is held for projects and the stock state (IN_STOCK, '
      + 'HELD_FOR_PROJECT, OUT_OF_STOCK or NEVER_RECEIVED). Optional ?status=URGENT,WARNING and ?category= filters. '
      + 'Stores items only unless ?section=PROJECTS or ALL; ?includeInactive=true adds inactive items. Most urgent first.',
    query: z.object({
      status: z.string().optional(), category: materialCategorySchema.optional(),
      section: z.enum(['STORES', 'PROJECTS', 'ALL']).optional(), includeInactive: yesNo.optional(),
    }),
    permissions: [P.ViewReports], errors: [400],
  },
  {
    method: 'get', path: '/reports/month-end', tag: 'Reports', summary: 'Stock report for a month or a range of days',
    description: 'Stock as at the end of ?from..?to (YYYY-MM-DD, both included) or of ?month=YYYY-MM (default this month), '
      + "rebuilt from the ledger, per category in the stock workbook's Summary columns (required, current, value, "
      + '% of required, re-order quantity, URGENCY), with the stock used in the period (Stock Report sheets). '
      + 'The response month is set only when the period is exactly one calendar month. Refused with 400 for a '
      + 'period that has not started, a reversed range, or only one of from/to.',
    permissions: [P.ViewReports], errors: [400],
  },
  {
    method: 'get', path: '/reports/month-end/export', tag: 'Reports', summary: 'Download the stock report',
    description: 'The stock report (same ?from/?to/?month) as Excel in the workbook layout: Overview, then a Summary and a Used sheet per category.',
    permissions: [P.ViewReports], errors: [400],
    produces: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  },
  {
    method: 'get', path: '/reports/stock-value', tag: 'Reports', summary: 'Value of the stock on hand, per category',
    description: 'For every active item: on hand across all locations × unit price, added up per category as the stock '
      + "workbook's Summary sheets do, with item counts, items in stock but without a price, each category's share, and "
      + 'the number of items URGENT, WARNING, OK, NOT_SET and out of stock. Projects material is also totalled per project, '
      + 'stock held for a project under that project, with `leftovers`: the items Move to Stores takes once it is closed (its leftovers, and items held for it).',
    permissions: [P.ViewReports],
  },
  {
    method: 'get', path: '/reports/procurement-savings', tag: 'Reports', summary: 'Sales, Procurement and order prices compared',
    description: 'Each line of a Procurement RFQ sent between ?from and ?to (YYYY-MM-DD, both included; default this month), optionally for one ?projectNumber=. '
      + 'Line totals excl. VAT: every quote by supplier, each side compared at its lowest, the order before line discounts. Only rand is compared; a figure that cannot be compared is null, with a note, and out of the totals. A selection of more than 2000 lines is refused (400).',
    procurement: true, permissions: [P.ViewSalesRfq], errors: [400],
  },
  {
    method: 'get', path: '/reports/procurement-savings/export', tag: 'Reports', summary: 'Download Procurement savings as Excel',
    description: 'The Procurement savings report, same query, one row per RFQ line with a total row.',
    procurement: true, permissions: [P.ViewSalesRfq], errors: [400],
  },
  {
    method: 'get', path: '/reports/consumption', tag: 'Reports', summary: 'Stock used in a date range',
    description: 'Issued less returned per item between ?from and ?to (YYYY-MM-DD, both included; default this month), '
      + 'valued at the unit price, with totals by project and by category. Reversed issues and returns are left out with '
      + 'their reversals. Totals by project, by recipient and by category. Optional ?projectNumber= (__none__ for issues '
      + 'with no project), ?category= and ?recipientId= (__none__ for issues with no recipient recorded); with a recipient, '
      + 'their issues and returns are listed one by one, newest first (up to 1000). For items that track use, each recipient and each '
      + 'issue line also carries usedUp, broken and stillOut, as of now.',
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
      + 'Optional ?category= for one category only, named in the title and the file name.',
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
  {
    method: 'get', path: '/activity', tag: 'Audit', summary: 'Other activity for the Movements page, described, newest first',
    description: 'Catalogue and master-data changes, users and imports. Leaves out stock counts (GET /stock-counts), settings changes, purchase orders and the entries '
      + 'the movement history already shows (stock receipts, returns, reversals).',
    permissions: [P.ViewAuditLog],
    query: z.object({
      from: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, from its start, UTC) or an ISO time.' }),
      to: z.string().optional().openapi({ description: 'A day (YYYY-MM-DD, included in full, UTC) or an ISO time.' }),
      entityType: z.enum(ACTIVITY_TYPES).optional(),
      actorId: z.string().optional(),
      before: z.string().optional().openapi({ description: 'Paging: the `cursor` of the last row already shown.' }),
      limit: z.coerce.number().int().positive().max(500).optional().openapi({ description: 'Default 100, at most 500.' }),
    }),
  },
  {
    method: 'get', path: '/activity/actors', tag: 'Audit', summary: 'Everyone with an entry in the activity list (id and name)',
    permissions: [P.ViewAuditLog],
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
  if (op.byOrderKind) {
    parts.push(`Requires permission \`${op.byOrderKind}\` for a project order, or \`${PermissionCode.OrderStoresStock}\` for a Stores order (one without a project).`);
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
        requestId: z.string().optional().openapi({
          description: 'Correlation id for this request; quote it to support. Matches the x-request-id response header and the server log line.',
        }),
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
    if (op.permissions?.length || op.byOrderKind) errors.add(403);
    if (op.body || op.query || op.consumes) errors.add(400);

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
        body: op.consumes
          ? { content: { [op.consumes]: { schema: z.string().openapi({ format: 'binary' }) } }, required: true }
          : op.body ? { content: { 'application/json': { schema: op.body } }, required: true } : undefined,
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
        'Errors always have the shape `{ "error": { "code", "message", "details"?, "requestId"? } }`; ' +
        'the `x-request-id` response header carries the same correlation id.' +
        (opts.procurementEnabled ? '' : '\n\nPurchase orders and goods receipts are switched off on this server.'),
    },
    servers: [{ url: API_PREFIX }],
  });
}
