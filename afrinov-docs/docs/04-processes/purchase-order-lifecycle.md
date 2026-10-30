# Process: Purchase Order Lifecycle

**Status:** IN REVIEW · **Owner:** Product/Engineering · **Last verified against code:** a7a7360, 2026-10-20

On unless switched off: `PROCUREMENT_ENABLED=false` (backend) and
`VITE_PROCUREMENT_ENABLED=false` (frontend) hide it (ADR-019, which
supersedes ADR-012). The order follows the AFRI-0000_x purchase order
template ("Item Description" workbook): its Inputs sheet for what is entered,
its Order sheet for the copy the supplier receives, and its vendor list for
suppliers (`supplier-management.md`).

Pages: Purchase orders (`/purchase-orders`), New purchase order
(`/purchase-orders/new`), Store → Order stock (`/stock/orders`) and its new
order (`/stock/orders/new`), the order (`/purchase-orders/:id`) and Edit
(`/purchase-orders/:id/edit`). There is no Goods receipts page any more:
deliveries are received from the order's page, and `/goods-receipts/*`
redirects to Purchase orders.

## Two kinds of order (ADR-020, ADR-021)
| | Project order | Stores order |
|---|---|---|
| Lives in | Procurement (`/purchase-orders/:id`) | Store → Order stock (`/stock/orders/:id`) |
| Raised by | Procurement, on New purchase order | The store controller, on Order stock |
| Seen by | Procurement, approvers and Admin (`view:purchase_order`) | The store controller and Admin (`order:stores_stock`) |
| Project | Required | None |
| Lines | That project's material | Stores items from the catalogue |
| Raise, edit, submit, cancel, close | `create`/`submit`/`cancel`/`close:purchase_order` | `order:stores_stock` |
| Approved by | Approvers, by value | The storeman, by value, against his own limit |
| Delivery | Straight to site: Procurement **confirms delivery** on the order (`POST /:id/confirm-delivery`); no stock is added | Into stock: on Receive stock, against the order |
| RFQ first | Possible | No: Stores stock is ordered at known prices |

The numbering, the order document and the statuses are the same for both.
An order can't change kind, and each side's orders are not found (404) to
the other. Orders raised before the split keep what they hold; those without
a project are Stores orders.

## States
`DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → RECEIVED → CLOSED`,
with `CANCELLED` before anything is received (ADR-007; full rules in
`03-domain/state-machines.md`). There is no `SENT`, `SHIPPED` or
`REJECTED` status.

## Steps
1. **Raise** (`POST /purchase-orders`) on the New purchase order page
   (a project order, PROCUREMENT or ADMIN) or Order stock's New order (a
   Stores order, STORE_CONTROLLER or ADMIN): supplier, lines (material,
   quantity, unit price excluding VAT, optional delivery date), VAT rate,
   expected delivery and the template's order details (below). **Save draft** keeps it as a
   `DRAFT` to finish later, for example once the quote arrives;
   **Create & submit** raises and submits it in one go.
   The order can also be started from where the need shows: the re-order
   list on Stock status and a Stores item's page link to
   `/stock/orders/new?supplierId=…&materialIds=…`, a Projects item's page to
   `/purchase-orders/new?materialIds=…`, and a supplier's page to the form
   the viewer orders from; each fills in the supplier and lines, prices from each item's unit cost and quantities up to
   Required Stock where it is set. Without a supplier, the items' last
   supplier is suggested when they share one.
2. **Submit** (`POST /:id/submit`): from `DRAFT` to `PENDING_APPROVAL`, or
   straight to `APPROVED` when `purchaseOrders.requireApprovalBeforeProcessing`
   is off.
3. **Approve** (`POST /:id/approve`, APPROVER or ADMIN), by order value (see
   *Approval*). `GET /:id/approval` tells the order's page who may approve it
   and whether the signed-in user can.
4. **Send:** download the order document (PDF) from the order's page and
   send it outside the system (email or phone); no status records it.
5. **Receive** from the order's page, as deliveries arrive (see *Receiving*).
   The order moves to `PARTIALLY_RECEIVED` or `RECEIVED`.
6. **Close** (`POST /:id/close`): from `PARTIALLY_RECEIVED` or `RECEIVED`;
   a reason is required when closing short.
7. **Cancel** (`POST /:id/cancel`): from `DRAFT`, `PENDING_APPROVAL` or
   `APPROVED`, with a reason, when `purchaseOrders.allowCancellation` allows it.

## Numbers and revisions
- New orders are numbered in the template's style, `AFRI-0001`, `AFRI-0002`,
  …: one past the highest AFRI number issued, and never below the
  `purchaseOrders.firstNumber` setting, which is set past the last number
  issued from the workbook. Older `PO-YYYY-NNNN` numbers stay as they are.
  An advisory lock keeps two orders from getting the same number.
- Changing an `APPROVED` order raises its revision (the template's "Rev 01"),
  so the supplier can tell the copies apart. A save that changes nothing
  raises no revision.

## Prices and VAT
Worked out in one place (`po-pricing.ts`) so every screen and the document
agree. Per line, as on the template: subtotal = unit price × quantity,
VAT = subtotal × rate, net = subtotal + VAT, each rounded to cents (half up);
the order totals are the sums of the lines. Lines without a price are left
out of the totals and counted as unpriced.

A new order's VAT rate is the `purchaseOrders.vatRate` setting for a rand
(`ZAR`) supplier and 0% for a supplier in another currency, and can be
changed on the order.

## Approval
As on the template, where the approver is chosen by the order total. Each
user who may approve has an approval limit (Settings → Users): the largest
order total, in rand including VAT, they may approve. No limit means any
order.
- Every line must have a price before approval, or the total is not known.
- An order in another currency needs an approver without a limit, since
  limits are in rand.
- When the signed-in approver's limit is too low, Approve is refused with the
  names of the approvers whose limit covers the order.
- If an approved order is edited so that its total is past its approver's
  limit, or a line loses its price, it goes back to `PENDING_APPROVAL`.
- Approvers land on the Purchase orders list filtered to the orders waiting
  for them (`/purchase-orders?status=mine`, from
  `GET /purchase-orders?awaitingMyApproval=true`). The Dashboard shows
  "Waiting for your approval": the orders they can approve now, oldest
  first, and how many more are pending but need prices or a higher limit.

## Order details (the template's Inputs sheet)
Project number, payment terms, payment milestone, settlement discount (%),
shipping terms, whether penalties apply, delivery method (`DELIVERY` or
`COLLECTION`), the delivery block (deliver to, address, country, contact
name and phone) and the Afrinov contact. Left out on a new order, they are
filled as the template fills them: payment terms from the supplier, the
delivery block from the `purchaseOrders.delivery*` settings (unless the
goods are collected), and the Afrinov contact from whoever raises the order.
A project number must be an open project.

## The order document (the template's Order sheet)
An A4 PDF built in the browser from the order as the server returns it, so
the copy matches the screen: logo and order number, supplier and delivery
details beside the order details, the lines with subtotal, VAT and net, the
order total, remarks, where to send invoices
(`purchaseOrders.invoiceEmail`), the company VAT number
(`purchaseOrders.companyVatNumber`), the code of conduct
(`purchaseOrders.codeOfConduct`), and the originator, authorization and
supplier acceptance blocks. An order not yet approved is marked "Draft, not
for issue" on every page; a cancelled one "Cancelled".

## Receiving
Every delivery to the store is booked on **Receive stock** (`/stock/receive`),
the one place to receive, and only against an approved Stores order
(ADR-022).
- The page lists the store's orders that are `APPROVED` or
  `PARTIALLY_RECEIVED`, with supplier and what each still owes; it is open to
  those who receive orders (the store controller and Admin). The order's page
  (**Receive delivery**) and Order stock (**Receive**) open it with the order
  chosen (`?order=<id>`); older `?receive=1` links on the order go there too.
- Against an order, its outstanding lines are filled in, each going where
  that item is kept now. What arrived is booked line by line, with the
  delivery note and date, as a goods receipt recorded and posted in one step
  (`POST /goods-receipts` with `post: true` and an `Idempotency-Key`, so a
  retry cannot book it twice). Each receipt credits the order's lines, so a
  part delivery leaves the rest showing as owed.
- **Closing:** when a delivery completes the order (`RECEIVED`), the
  confirmation offers **Close AFRI-…**. When nothing more is coming, ticking
  *close short* with a reason closes the order with the delivery (short, if part-received)
  (`POST /:id/close` with the reason), as Close PO does.
- There is no receipt without an order: the server refuses one
  (`goods-receiving.md`). Counter receipts are only for procurement off.
- `POST /:id/receive` books everything still outstanding to one location.

## Business rules
- Materials and quantities are fixed once the order is raised. Prices, line
  delivery dates, VAT, order details, remarks and expected delivery can be
  edited in `DRAFT` and `PENDING_APPROVAL`, and in `APPROVED` when
  `purchaseOrders.allowEditAfterApproval` is on.
- A line without its own delivery date is due on the order's expected
  delivery.
- An order cannot be cancelled once anything has been received.
- Received quantity per line is always ≤ ordered quantity. Over-receipt is
  refused when the receipt is recorded and rolls back if it is posted; an
  authorised override is **Planned**.
- An inactive supplier cannot be ordered from.
- Each transition and each edit is written to the audit log, with only the
  fields that changed, and shown as the order's history (`GET /:id/history`).

## Outputs
PurchaseOrder record with lifecycle timestamps and actors, totals, revision
and approver; the order document; goods receipts and RECEIPT movements in
the ledger (`goods-receiving.md`).

## Evidence
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.routes.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/procurement.service.ts` (`create`, `update`, `submit`, `approve`, `receive`, next number)
- `afrinov-platform/apps/backend/src/modules/procurement/po-approval.ts`, `po-pricing.ts`
- `afrinov-platform/apps/backend/src/modules/procurement/goods-receipt.service.ts`
- `afrinov-platform/apps/backend/src/modules/settings/settings.service.ts` (`purchaseOrders.*`)
- `afrinov-platform/apps/frontend/src/pages/PurchaseOrderForm.tsx`, `PurchaseOrderDetail.tsx`, `PurchaseOrders.tsx`
- `afrinov-platform/apps/frontend/src/lib/poDocument.ts`, `components/WaitingForApproval.tsx`
- `afrinov-platform/apps/frontend/src/pages/ReceiveStock.tsx` (open orders)
