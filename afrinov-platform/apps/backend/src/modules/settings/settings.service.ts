// Settings module — typed system configuration.
//
// Settings are stored as `Setting` rows with a `key`, JSON `value`, and a
// declared `type` (string/number/boolean/enum). The catalog below is the
// authoritative list of supported keys; unknown keys are rejected on write.
//
// The service is the only writer. It validates the incoming value against
// the declared type, the allowed enum options, and any cross-field rule
// listed in `validateSetting`. Every change writes an `AuditLogEntry`.

import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { RolePermissions } from '../../shared/permissions.js';
import { checkUnitOfMeasure } from '../../shared/units.js';
import { parseClosedDays } from '../../shared/working-days.js';
import { parseStepTemplates } from '../operations/project-schedule.rules.js';

const SETTINGS_CACHE_TTL_MS = 60_000;
const settingsCache = new Map<string, { value: unknown; expires: number }>();
const isTest = process.env.NODE_ENV === 'test';

function invalidateSettingsCache(): void {
  for (const key of settingsCache.keys()) {
    settingsCache.delete(key);
  }
}

async function cachedGetValue<T>(key: string, tx?: Prisma.TransactionClient): Promise<T> {
  const client = tx ?? prisma;
  if (isTest) {
    const def = getDefinition(key);
    if (!def) return undefined as T;
    try {
      const row = await client.setting.findUnique({ where: { key } });
      return (row ? row.value : def.default) as T;
    } catch {
      return def.default as T;
    }
  }
  if (tx) {
    const def = getDefinition(key);
    if (!def) return undefined as T;
    try {
      const row = await tx.setting.findUnique({ where: { key } });
      return (row ? row.value : def.default) as T;
    } catch {
      return def.default as T;
    }
  }
  const cached = settingsCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.value as T;
  }
  const def = getDefinition(key);
  if (!def) return undefined as T;
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    const value = row ? row.value : def.default;
    settingsCache.set(key, { value, expires: Date.now() + SETTINGS_CACHE_TTL_MS });
    return value as T;
  } catch {
    return def.default as T;
  }
}

async function cachedGetValues(keys: readonly string[], tx?: Prisma.TransactionClient): Promise<Record<string, unknown>> {
  const client = tx ?? prisma;
  if (isTest) {
    const out: Record<string, unknown> = {};
    const rows = await client.setting.findMany({ where: { key: { in: [...keys] } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    for (const key of keys) {
      const def = getDefinition(key);
      if (!def) continue;
      out[key] = map.has(key) ? map.get(key) : def.default;
    }
    return out;
  }
  if (tx) {
    const out: Record<string, unknown> = {};
    const rows = await tx.setting.findMany({ where: { key: { in: [...keys] } } });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    for (const key of keys) {
      const def = getDefinition(key);
      if (!def) continue;
      out[key] = map.has(key) ? map.get(key) : def.default;
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  const now = Date.now();
  const missing: string[] = [];
  for (const key of keys) {
    const cached = settingsCache.get(key);
    if (cached && cached.expires > now) {
      out[key] = cached.value;
    } else {
      missing.push(key);
    }
  }
  if (missing.length === 0) return out;

  const rows = await prisma.setting.findMany({ where: { key: { in: missing } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  for (const key of missing) {
    const def = getDefinition(key);
    if (!def) continue;
    const value = map.has(key) ? map.get(key) : def.default;
    out[key] = value;
    settingsCache.set(key, { value, expires: now + SETTINGS_CACHE_TTL_MS });
  }
  return out;
}

export type SettingTypeLiteral = 'string' | 'number' | 'boolean' | 'enum';
export type SettingCategoryLiteral =
  | 'general' | 'inventory' | 'purchase_orders' | 'notifications'
  | 'users' | 'appearance' | 'security' | 'system' | 'data' | 'projects';

export interface SettingDefinition<T = unknown> {
  key: string;
  type: SettingTypeLiteral;
  category: SettingCategoryLiteral;
  description: string;
  default: T;
  enumOptions?: readonly string[];
  isEditable?: boolean;
  // Optional server-side cross-field rule. Throws Errors.validation on failure.
  validate?: (value: T) => string | null;
}

const T = (s: string) => s.trim();
const isLength = (min: number, max: number) => (v: unknown) => {
  if (typeof v !== 'string') return 'Must be text.';
  return v.length < min ? `Must be at least ${min} characters.` :
    v.length > max ? `Must be at most ${max} characters.` : null;
};

const POS_INT = (min: number, max: number) => (v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number.';
  if (!Number.isInteger(v)) return 'Must be a whole number.';
  if (v < min || v > max) return `Must be between ${min} and ${max}.`;
  return null;
};
const NON_NEG = (max: number) => (v: unknown) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 'Must be a number.';
  if (v < 0) return 'Must be at least 0.';
  if (v > max) return `Must be at most ${max}.`;
  return null;
};
const ENUM = <T extends string>(opts: readonly T[]) => (v: unknown) => {
  if (typeof v !== 'string') return 'Selection is required.';
  return opts.includes(v as T) ? null : 'Selected value is not supported.';
};

const UUID_OR_BLANK = (v: unknown) => {
  if (typeof v !== 'string') return 'Must be text.';
  return v === '' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? null : 'Choose a location.';
};

/**
 * Checks a setting that names a record which must exist, and returns the value
 * to store. The project receiving location has to be an active location, or
 * Receive stock would book project deliveries somewhere else without saying so
 * (Qodo, PR #146). The default unit has to be an active unit on the list, kept
 * under its listed code ("EA" is each), as an item's own unit is.
 */
async function resolveReference(key: string, value: unknown, db: Prisma.TransactionClient | typeof prisma): Promise<unknown> {
  if (key === 'inventory.projectReceivingLocationId' && value !== '') {
    const location = await db.location.findUnique({ where: { id: String(value) }, select: { active: true } });
    if (!location?.active) throw Errors.validation('Choose an active location for project deliveries.');
  }
  if (key === 'inventory.defaultUnitOfMeasure') {
    return (await checkUnitOfMeasure(String(value), db)).code;
  }
  return value;
}

/** Turns a parser's problems into a setting's error: the first two, and how many more. */
const parsed = (read: (text: string) => { problems: string[] }) => (v: unknown) => {
  if (typeof v !== 'string') return 'Must be text.';
  if (v.length > 10_000) return 'Must be at most 10000 characters.';
  const { problems } = read(v);
  if (problems.length === 0) return null;
  return problems.slice(0, 2).join(' ') + (problems.length > 2 ? ` (and ${problems.length - 2} more)` : '');
};

export const DEFAULT_STEP_TEMPLATES = [
  'Workshop job: Kick-off, Engineering, Procurement, Manufacturing, FAT, Packaging, Data Pack, Delivery, Postmortem, Closure',
  'Site job: Kick-off, Site induction and safety file, Engineering, Procurement, Manufacturing, FAT, Delivery, Site installation, Commissioning, Postmortem, Closure',
  'Buy and deliver: Kick-off, Procurement, Packaging, Data Pack, Delivery, Closure',
  'Maintenance visit: Site induction and safety file, Site inspection, Oil testing, Site report, Closure',
].join('\n');

const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const;
// 'by-role': each role where it works (technicians on Issue stock, everyone else on the Dashboard).
const LANDING_PAGES = ['by-role', 'dashboard', 'inventory', 'issue-stock', 'receive-stock', 'low-stock', 'movements', 'purchase-orders'] as const;
const THEMES = ['system', 'light', 'dark'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;
// Lending to someone with an overdue tool: warn (lend with a reason), or block contractors only, or block everyone.
export const TOOL_OVERDUE_CHECKOUT = ['warn', 'block-contractors', 'block'] as const;
// The hand-over step after an issue or check-out (ADR-034).
export const RECEIPT_CONFIRMATION = ['off', 'ask', 'require'] as const;
// Signature images are kept at least 24 months (owner's answer, 10 Nov 2026), or always (0).
const KEEP_MONTHS = (v: unknown) => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return 'Must be a whole number.';
  return v === 0 || (v >= 24 && v <= 240) ? null : 'Must be 0 (always) or between 24 and 240 months.';
};

// Every setting here has an effect; one that nothing reads is retired, not
// left on the page (migration 20260101000054 removed seven: the system
// description, date and time formats, rows per page and the three
// notification switches).
export const SETTING_CATALOG: readonly SettingDefinition[] = [
  // ── General ────────────────────────────────────────────────────────────
  { key: 'general.companyName', type: 'string', category: 'general', description: 'Company or organisation name shown across the application.', default: 'Afrinov', validate: isLength(1, 120) },
  { key: 'general.defaultCurrency', type: 'enum', category: 'general', description: 'Default currency for monetary values.', default: 'ZAR', enumOptions: CURRENCIES, validate: ENUM(CURRENCIES) },
  { key: 'general.defaultLandingPage', type: 'enum', category: 'general', description: 'Where to go after sign-in. "By role" sends technicians to Issue stock and everyone else to the Dashboard.', default: 'by-role', enumOptions: LANDING_PAGES, validate: ENUM(LANDING_PAGES) },

  // ── Inventory ──────────────────────────────────────────────────────────
  { key: 'inventory.urgentBelowPercent', type: 'number', category: 'inventory', description: 'An item is URGENT when its stock on hand is below this percentage of its Required Stock.', default: 20, validate: NON_NEG(100) },
  { key: 'inventory.warningBelowPercent', type: 'number', category: 'inventory', description: 'An item is WARNING when its stock on hand is below this percentage of its Required Stock (and not URGENT). At or above it, the item is OK.', default: 40, validate: NON_NEG(1000) },
  // Segregation of duties: a big write-off is never one person's say-so.
  { key: 'inventory.requireWriteOffApproval', type: 'boolean', category: 'inventory', description: 'When on, adjustments and write-offs worth more than the limit below wait for someone other than whoever asked for them to approve them. When off, every adjustment posts at once.', default: true },
  { key: 'inventory.writeOffApprovalAbove', type: 'number', category: 'inventory', description: "Adjustments and write-offs worth more than this, in rand at the item's unit cost, wait for someone else to approve them before stock moves. An item with no unit cost always waits. 0: every adjustment waits.", default: 1000, validate: NON_NEG(1_000_000) },
  // A unit on the list (resolveReference), as an item's own unit is.
  { key: 'inventory.defaultUnitOfMeasure', type: 'string', category: 'inventory', description: 'The unit a new material starts on. It can be changed on each material.', default: 'each', validate: isLength(1, 20) },
  // Tool loans (04-processes/tool-loans.md). The key predates due dates: it is the default loan period.
  { key: 'inventory.toolOverdueDays', type: 'number', category: 'inventory', description: 'Default tool loan period, in days: a tool checked out is due back this many days later unless another due date is set at check-out. Older loans with no due date fall due this many days after they went out.', default: 7, validate: POS_INT(1, 365) },
  { key: 'inventory.toolMaxLoanDays', type: 'number', category: 'inventory', description: 'The longest a tool may be lent for, in days from check-out, extensions included. Only an administrator can set a later due date.', default: 30, validate: POS_INT(1, 365) },
  { key: 'inventory.toolEscalateDays', type: 'number', category: 'inventory', description: 'A tool this many days past its due date needs a decision: check it in, extend the loan or write it off as lost. Flagged on the Tools page and the Dashboard.', default: 14, validate: POS_INT(1, 365) },
  { key: 'inventory.toolOverdueCheckout', type: 'enum', category: 'inventory', description: 'Lending more tools to someone who has an overdue tool. Warn: the tools can still be lent, with a reason. Block: the overdue tools must be checked in or extended first.', default: 'warn', enumOptions: TOOL_OVERDUE_CHECKOUT, validate: ENUM(TOOL_OVERDUE_CHECKOUT) },
  // Project material isn't shelved: it is received and issued straight to the workshop (Project Material Through the Store Roadmap, Phase 4).
  { key: 'inventory.projectReceivingLocationId', type: 'string', category: 'inventory', description: 'Where project deliveries are booked on Receive stock, such as the workshop floor: project material is not shelved, it is issued from there. Leave blank to choose a location on each delivery.', default: '', validate: UUID_OR_BLANK },
  // Proof of receipt (ADR-034).
  { key: 'inventory.receiptConfirmation', type: 'enum', category: 'inventory', description: 'Whether the person collecting stock or tools confirms they took it. Off: no hand-over step. Ask: the hand-over step opens after each issue and check-out, and can be skipped. Required: skipping needs a reason, and slips not confirmed are counted on the Dashboard.', default: 'ask', enumOptions: RECEIPT_CONFIRMATION, validate: ENUM(RECEIPT_CONFIRMATION) },
  { key: 'inventory.receiptPinTries', type: 'number', category: 'inventory', description: 'Wrong PIN tries before a counter PIN locks. A store controller unlocks it on Recipients.', default: 5, validate: POS_INT(3, 10) },
  { key: 'inventory.receiptImageKeepMonths', type: 'number', category: 'inventory', description: 'How long signatures and photos of signed slips are kept, in months: at least 24, or 0 to keep them always. After that the image is removed and the record that the slip was signed stays.', default: 24, validate: KEEP_MONTHS },
  { key: 'inventory.enableStockAlerts', type: 'boolean', category: 'inventory', description: 'Show stock status (URGENT, WARNING, OK) and list items that need re-ordering.', default: true },

  // ── Purchase Orders ─────────────────────────────────────────────────────
  { key: 'purchaseOrders.requireApprovalBeforeProcessing', type: 'boolean', category: 'purchase_orders', description: 'When on, submitting a purchase order moves it to PENDING_APPROVAL; when off, submission auto-approves.', default: true },
  // Who signs an order goes by its value in rand excluding VAT (po-approval.ts).
  { key: 'purchaseOrders.directorApprovalFrom', type: 'number', category: 'purchase_orders', description: 'From this value, in rand excluding VAT, a project order needs the Director as well as the Procurement Manager.', default: 200000, validate: NON_NEG(1e12) },
  // An order locks the rate when submitted. 0: not set, so an order in that currency can't be submitted.
  { key: 'purchaseOrders.exchangeRateUSD', type: 'number', category: 'purchase_orders', description: 'Rand per US dollar, to work out who signs an order in USD. An order keeps the rate it was submitted with.', default: 0, validate: NON_NEG(1e6) },
  { key: 'purchaseOrders.exchangeRateEUR', type: 'number', category: 'purchase_orders', description: 'Rand per euro, to work out who signs an order in EUR. An order keeps the rate it was submitted with.', default: 0, validate: NON_NEG(1e6) },
  { key: 'purchaseOrders.exchangeRateGBP', type: 'number', category: 'purchase_orders', description: 'Rand per pound, to work out who signs an order in GBP. An order keeps the rate it was submitted with.', default: 0, validate: NON_NEG(1e6) },
  { key: 'purchaseOrders.allowCancellation', type: 'boolean', category: 'purchase_orders', description: 'Allow cancelling purchase orders before delivery.', default: true },
  { key: 'purchaseOrders.allowEditAfterApproval', type: 'boolean', category: 'purchase_orders', description: 'Allow editing a purchase order once it has been approved.', default: true },
  { key: 'purchaseOrders.vatRate', type: 'number', category: 'purchase_orders', description: 'VAT rate, in percent, on new purchase orders to rand suppliers. Orders to suppliers in other currencies start at 0%. Either can be changed on the order.', default: 15, validate: NON_NEG(100) },
  { key: 'purchaseOrders.deliveryTo', type: 'string', category: 'purchase_orders', description: 'Who goods are delivered to, on new purchase orders.', default: 'Afrinov (PTY) Ltd', validate: isLength(0, 200) },
  { key: 'purchaseOrders.deliveryAddress', type: 'string', category: 'purchase_orders', description: 'Delivery address on new purchase orders. One line per address line.', default: '10 Lime Street, Icon Industrial Park\nSunderland Ridge, Centurion 0157', validate: isLength(0, 500) },
  { key: 'purchaseOrders.deliveryCountry', type: 'string', category: 'purchase_orders', description: 'Delivery country on new purchase orders.', default: 'South Africa', validate: isLength(0, 100) },
  { key: 'purchaseOrders.deliveryContactName', type: 'string', category: 'purchase_orders', description: 'Who receives deliveries at the delivery address, on new purchase orders.', default: '', validate: isLength(0, 200) },
  { key: 'purchaseOrders.deliveryContactPhone', type: 'string', category: 'purchase_orders', description: 'Phone number for that person.', default: '', validate: isLength(0, 50) },
  { key: 'purchaseOrders.firstNumber', type: 'number', category: 'purchase_orders', description: 'The first AFRI number the app issues: set it to one past the last purchase order number issued from the workbook. The app always continues after the highest AFRI number it has issued.', default: 1, validate: POS_INT(1, 999999) },
  // Printed on the purchase order document, as on the template's Order sheet.
  { key: 'purchaseOrders.companyVatNumber', type: 'string', category: 'purchase_orders', description: "Afrinov's VAT number, printed on every purchase order.", default: '4010288142', validate: isLength(0, 30) },
  // The small print under Remarks, as on the issued orders. Each order keeps
  // the wording it was approved with. A section left blank is left off.
  { key: 'purchaseOrders.terms', type: 'string', category: 'purchase_orders', description: 'TERMS printed on every purchase order. Each order keeps the wording it was approved with. Leave blank to leave it off.', default: 'The Supplier shall deliver all Goods and/or Services by the Purchase Order delivery date and notify the Purchaser in writing within 24 hours of any actual or anticipated delay.', validate: isLength(0, 4000) },
  { key: 'purchaseOrders.latePenalty', type: 'string', category: 'purchase_orders', description: 'The late delivery penalty, printed in bold at the end of TERMS, only on orders where penalties apply.', default: 'Late delivery will incur a penalty of 2% of the contract price per week (or part thereof), up to a maximum of 10%.', validate: isLength(0, 1000) },
  { key: 'purchaseOrders.documentation', type: 'string', category: 'purchase_orders', description: 'DOCUMENTATION the supplier must provide, printed on every purchase order. Leave blank to leave it off.', default: 'Provide Material Certificates and Material Data Sheets where applicable.', validate: isLength(0, 4000) },
  { key: 'purchaseOrders.invoicing', type: 'string', category: 'purchase_orders', description: 'INVOICING & PAYMENT printed on every purchase order, followed by where invoices are submitted. Leave blank to leave it off.', default: 'The Purchaser may withhold payment for late delivery, missing documentation, or defective/non-conforming Goods or Services.', validate: isLength(0, 4000) },
  { key: 'purchaseOrders.invoiceEmail', type: 'string', category: 'purchase_orders', description: 'Where suppliers submit invoices, printed at the end of INVOICING & PAYMENT.', default: 'accounts@afrinov.co.za', validate: isLength(0, 200) },
  { key: 'purchaseOrders.codeOfConduct', type: 'string', category: 'purchase_orders', description: 'The supplier code of conduct printed on every purchase order. Leave blank to leave it off.', default: '', validate: isLength(0, 4000) },
  // Printed on each request for quotation, as the RFQ sheet's Instructions.
  { key: 'purchaseOrders.rfqInstructions', type: 'string', category: 'purchase_orders', description: 'Instructions printed on every request for quotation, telling suppliers how to quote. Leave blank to leave them off.', default: 'Fill in the UNIT PRICE and SUBTOTAL for each line as per the headings below, and save as PDF. All files to be returned as PDF, quoting the RFQ number.', validate: isLength(0, 2000) },
  { key: 'purchaseOrders.rfqQuoteEmail', type: 'string', category: 'purchase_orders', description: 'Where suppliers return their quotations, printed under the instructions on every request for quotation. Leave blank to leave it off.', default: '', validate: isLength(0, 200) },

  // ── Appearance ────────────────────────────────────────────────────────
  { key: 'appearance.theme', type: 'enum', category: 'appearance', description: 'Default visual theme when no browser preference is saved. Users may choose Light, Dark, or System in their browser.', default: 'light', enumOptions: THEMES, validate: ENUM(THEMES) },
  { key: 'appearance.density', type: 'enum', category: 'appearance', description: 'Default table density.', default: 'comfortable', enumOptions: DENSITIES, validate: ENUM(DENSITIES) },

  // ── Security ──────────────────────────────────────────────────────────
  // Idle sign-out (ADR-035, identity/session-policy.ts); keep the range in step with IDLE_MIN/MAX_MINUTES.
  { key: 'security.sessionTimeoutMinutes', type: 'number', category: 'security', description: 'Minutes without activity before someone is signed out. A minute before, the screen offers to keep them signed in. A sign-in also ends 12 hours after it began, however active.', default: 60, validate: POS_INT(5, 720) },

  // ── Projects (job tracking, ADR-032) ───────────────────────────────────
  // Last, as the category is last in the schema's SettingCategory, which lists sort by.
  { key: 'projects.stepTemplates', type: 'string', category: 'projects', description: "The step lists a new schedule can start from, one per line: the template's name, a colon, then its steps separated by commas. A schedule's steps can be changed after it starts from one.", default: DEFAULT_STEP_TEMPLATES, validate: parsed(parseStepTemplates) },
  { key: 'projects.closedDays', type: 'string', category: 'projects', description: 'Days the business is closed, such as public holidays and shutdowns, one per line as YYYY-MM-DD with an optional note after it. Weekends are always left out. Durations and lateness are counted in working days.', default: '', validate: parsed(parseClosedDays) },
] as const;

const CATALOG_BY_KEY: Map<string, SettingDefinition> = new Map(SETTING_CATALOG.map((s) => [s.key, s]));

export function getDefinition(key: string): SettingDefinition | undefined {
  return CATALOG_BY_KEY.get(key);
}

export interface SettingValue {
  key: string;
  value: unknown;
  type: SettingTypeLiteral;
  category: SettingCategoryLiteral;
  description: string;
  isEditable: boolean;
  enumOptions: string[] | null;
  updatedAt: string;
  updatedById: string | null;
}

function coerceAndValidate(def: SettingDefinition, raw: unknown): unknown {
  switch (def.type) {
    case 'string': {
      if (typeof raw !== 'string') throw Errors.validation(`${def.key} must be a string`);
      const trimmed = T(raw);
      const v = trimmed === '' && def.default === '' ? '' : trimmed;
      const err = def.validate?.(v);
      if (err) throw Errors.validation(`${def.key}: ${err}`);
      return v;
    }
    case 'number': {
      const n = typeof raw === 'string' ? Number(raw) : raw;
      if (typeof n !== 'number' || !Number.isFinite(n)) throw Errors.validation(`${def.key} must be a number`);
      const err = def.validate?.(n);
      if (err) throw Errors.validation(`${def.key}: ${err}`);
      return n;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw Errors.validation(`${def.key} must be true or false`);
    }
    case 'enum': {
      if (typeof raw !== 'string') throw Errors.validation(`${def.key} must be one of: ${def.enumOptions!.join(', ')}`);
      const err = def.validate?.(raw);
      if (err) throw Errors.validation(`${def.key}: ${err}`);
      return raw;
    }
  }
}

function rowToValue(row: {
  key: string; value: unknown; type: string; category: string; description: string;
  isEditable: boolean; enumOptions: unknown; updatedAt: Date; updatedById: string | null;
}): SettingValue {
  return {
    key: row.key,
    value: row.value as unknown,
    type: row.type as SettingTypeLiteral,
    category: row.category as SettingCategoryLiteral,
    description: row.description,
    isEditable: row.isEditable,
    enumOptions: (row.enumOptions as string[] | null) ?? null,
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}

export const SettingsService = {
  /**
   * Idempotent: ensures every catalog key has a row, and deletes rows for
   * keys that have been retired from the catalog.
   */
  async ensureSeeded(): Promise<void> {
    await prisma.setting.deleteMany({ where: { key: { notIn: SETTING_CATALOG.map((s) => s.key) } } });
    for (const def of SETTING_CATALOG) {
      const existing = def.key === 'appearance.theme'
        ? await prisma.setting.findUnique({ where: { key: def.key } })
        : null;
      await prisma.setting.upsert({
        where: { key: def.key },
        update: {},
        create: {
          key: def.key,
          value: def.default as Prisma.InputJsonValue,
          // Cast: the Prisma client enum is generated from the schema and
          // exactly mirrors the literal types above, but the enum re-export
          // can drop out of the namespace typing.
          type: def.type as 'string' | 'number' | 'boolean' | 'enum',
          category: def.category as 'general' | 'inventory' | 'purchase_orders' | 'notifications' | 'users' | 'appearance' | 'security' | 'system' | 'data' | 'projects',
          description: def.description,
          isEditable: def.isEditable ?? true,
          enumOptions: (def.enumOptions as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      // Previous releases seeded `system` without recording who selected it.
      // Move only that untouched default to light; keep any saved choice,
      // including Dark or System, exactly as the user selected it.
      if (def.key === 'appearance.theme' && existing?.value === 'system' && existing.updatedById === null) {
        await prisma.setting.update({ where: { key: def.key }, data: { value: 'light' } });
      }
    }
  },

  async list(filter?: { category?: SettingCategoryLiteral }): Promise<SettingValue[]> {
    // Only catalog keys: a retired setting's row may linger until the next seed.
    const rows = await prisma.setting.findMany({
      where: {
        key: { in: SETTING_CATALOG.map((s) => s.key) },
        ...(filter?.category ? { category: filter.category } : {}),
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return rows.map(rowToValue);
  },

  async get(key: string): Promise<SettingValue> {
    if (!getDefinition(key)) throw Errors.notFound('Setting');
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) throw Errors.notFound('Setting');
    return rowToValue(row);
  },

  async set(key: string, rawValue: unknown, actorId: string): Promise<SettingValue> {
    const def = getDefinition(key);
    if (!def) throw Errors.notFound('Setting');
    if (def.isEditable === false) throw Errors.forbidden(`Setting "${key}" is not editable`);
    const coerced = await resolveReference(key, coerceAndValidate(def, rawValue), prisma);
    const before = await prisma.setting.findUnique({ where: { key } });
    if (!before) throw Errors.notFound('Setting');
    // The setting row and its audit record commit together, so a configuration
    // change can never be recorded without the history entry that explains it.
    const updated = await prisma.$transaction(async (tx) => {
      const setting = await tx.setting.update({
        where: { key },
        data: { value: coerced as Prisma.InputJsonValue, updatedById: actorId },
      });
      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'SETTING_UPDATE',
          entityType: 'Setting',
          entityId: key,
          before: { value: before.value as Prisma.InputJsonValue },
          after: { value: setting.value as Prisma.InputJsonValue },
        },
      });
      return setting;
    });
    invalidateSettingsCache();
    return rowToValue(updated);
  },

  async setMany(updates: Record<string, unknown>, actorId: string): Promise<SettingValue[]> {
    if (Object.keys(updates).length === 0) return [];
    const out: SettingValue[] = [];
    await prisma.$transaction(async (tx) => {
      for (const [key, raw] of Object.entries(updates)) {
        const def = getDefinition(key);
        if (!def) throw Errors.notFound(`Setting: ${key}`);
        if (def.isEditable === false) throw Errors.forbidden(`Setting "${key}" is not editable`);
        const coerced = await resolveReference(key, coerceAndValidate(def, raw), tx);
        const before = await tx.setting.findUnique({ where: { key } });
        if (!before) throw Errors.notFound(`Setting: ${key}`);
        const updated = await tx.setting.update({
          where: { key },
          data: { value: coerced as Prisma.InputJsonValue, updatedById: actorId },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'SETTING_BULK_UPDATE',
            entityType: 'Setting',
            entityId: key,
            before: { value: before.value as Prisma.InputJsonValue },
            after: { value: updated.value as Prisma.InputJsonValue },
          },
        });
        out.push(rowToValue(updated));
      }
    });
    invalidateSettingsCache();
    return out;
  },

  async resetDefaults(actorId: string): Promise<SettingValue[]> {
    const out: SettingValue[] = [];
    await prisma.$transaction(async (tx) => {
      for (const def of SETTING_CATALOG) {
        if (def.isEditable === false) continue;
        const before = await tx.setting.findUnique({ where: { key: def.key } });
        const updated = await tx.setting.update({
          where: { key: def.key },
          data: { value: def.default as Prisma.InputJsonValue, updatedById: actorId },
        });
        await tx.auditLogEntry.create({
          data: {
            actorId,
            action: 'SETTING_RESET',
            entityType: 'Setting',
            entityId: def.key,
            before: before ? { value: before.value as Prisma.InputJsonValue } : Prisma.JsonNull,
            after: { value: updated.value as Prisma.InputJsonValue, reset: true },
          },
        });
        out.push(rowToValue(updated));
      }
    });
    invalidateSettingsCache();
    return out;
  },

  /**
   * Read-only typed lookup helper used by other services. Falls back to the
   * catalog default if the row is missing (DB not yet seeded) or the value
   * is malformed. Never throws. Results are cached in-memory for 60s.
   * Pass a transaction client to read within a transaction boundary.
   */
  async getValue<T = unknown>(key: string, tx?: Prisma.TransactionClient): Promise<T> {
    return cachedGetValue<T>(key, tx);
  },

  /** Returns a flat key→value map for the keys provided. Missing rows fall back to default.
   * Pass a transaction client to read within a transaction boundary.
   */
  async getValues(keys: readonly string[], tx?: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    return cachedGetValues(keys, tx);
  },
};

export function isAdmin(roles: string[]): boolean {
  return roles?.includes('ADMIN') === true;
}

export function canManageSettings(roles: string[]): boolean {
  // Centralised: any role granted manage:settings may edit. Currently only ADMIN.
  return roles?.includes('ADMIN') === true;
}

export function listRolesWithPermission(perm: string): string[] {
  const out: string[] = [];
  for (const [role, perms] of Object.entries(RolePermissions)) {
    if (perms.includes(perm as never)) out.push(role);
  }
  return out;
}
