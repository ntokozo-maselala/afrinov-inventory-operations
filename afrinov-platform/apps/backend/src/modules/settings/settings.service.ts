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
  | 'users' | 'appearance' | 'security' | 'system' | 'data';

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

const CURRENCIES = ['ZAR', 'USD', 'EUR', 'GBP'] as const;
const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
const TIME_FORMATS = ['24h', '12h'] as const;
// 'by-role': each role where it works (technicians on Issue stock, everyone else on the Dashboard).
const LANDING_PAGES = ['by-role', 'dashboard', 'inventory', 'issue-stock', 'receive-stock', 'low-stock', 'movements', 'purchase-orders'] as const;
const THEMES = ['system', 'light', 'dark'] as const;
const DENSITIES = ['comfortable', 'compact'] as const;

export const SETTING_CATALOG: readonly SettingDefinition[] = [
  // ── General ────────────────────────────────────────────────────────────
  { key: 'general.companyName', type: 'string', category: 'general', description: 'Company or organisation name shown across the application.', default: 'Afrinov', validate: isLength(1, 120) },
  { key: 'general.systemDescription', type: 'string', category: 'general', description: 'Short description of the system shown on the dashboard.', default: 'Inventory & operations management', validate: isLength(0, 500) },
  { key: 'general.defaultCurrency', type: 'enum', category: 'general', description: 'Default currency for monetary values.', default: 'ZAR', enumOptions: CURRENCIES, validate: ENUM(CURRENCIES) },
  { key: 'general.dateFormat', type: 'enum', category: 'general', description: 'Date display format used throughout the application.', default: 'YYYY-MM-DD', enumOptions: DATE_FORMATS, validate: ENUM(DATE_FORMATS) },
  { key: 'general.timeFormat', type: 'enum', category: 'general', description: 'Time display format.', default: '24h', enumOptions: TIME_FORMATS, validate: ENUM(TIME_FORMATS) },
  { key: 'general.defaultPageSize', type: 'number', category: 'general', description: 'Default rows per page in tables.', default: 25, validate: POS_INT(5, 200) },
  { key: 'general.defaultLandingPage', type: 'enum', category: 'general', description: 'Where to go after sign-in. "By role" sends technicians to Issue stock and everyone else to the Dashboard.', default: 'by-role', enumOptions: LANDING_PAGES, validate: ENUM(LANDING_PAGES) },

  // ── Inventory ──────────────────────────────────────────────────────────
  { key: 'inventory.urgentBelowPercent', type: 'number', category: 'inventory', description: 'An item is URGENT when its stock on hand is below this percentage of its Required Stock.', default: 20, validate: NON_NEG(100) },
  { key: 'inventory.warningBelowPercent', type: 'number', category: 'inventory', description: 'An item is WARNING when its stock on hand is below this percentage of its Required Stock (and not URGENT). At or above it, the item is OK.', default: 40, validate: NON_NEG(1000) },
  { key: 'inventory.defaultUnitOfMeasure', type: 'string', category: 'inventory', description: 'Default unit of measure suggested for new materials.', default: 'each', validate: isLength(1, 20) },
  { key: 'inventory.toolOverdueDays', type: 'number', category: 'inventory', description: 'A tool checked out longer than this many days is overdue: flagged on the Tools page and counted on the Dashboard.', default: 7, validate: POS_INT(1, 365) },
  { key: 'inventory.enableStockAlerts', type: 'boolean', category: 'inventory', description: 'Show stock status (URGENT, WARNING, OK) and list items that need re-ordering.', default: true },

  // ── Purchase Orders ─────────────────────────────────────────────────────
  { key: 'purchaseOrders.requireApprovalBeforeProcessing', type: 'boolean', category: 'purchase_orders', description: 'When on, submitting a purchase order moves it to PENDING_APPROVAL; when off, submission auto-approves.', default: true },
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

  // ── Notifications ──────────────────────────────────────────────────────
  { key: 'notifications.enableInAppNotifications', type: 'boolean', category: 'notifications', description: 'Show operational alerts inside the application.', default: true },
  { key: 'notifications.enableLowStockNotifications', type: 'boolean', category: 'notifications', description: 'Generate alerts when materials fall below their reorder threshold.', default: true },
  { key: 'notifications.enablePurchaseOrderNotifications', type: 'boolean', category: 'notifications', description: 'Alert when purchase orders need approval or reach a new state.', default: true },

  // ── Appearance ────────────────────────────────────────────────────────
  { key: 'appearance.theme', type: 'enum', category: 'appearance', description: 'Default visual theme when no browser preference is saved. Users may choose Light, Dark, or System in their browser.', default: 'light', enumOptions: THEMES, validate: ENUM(THEMES) },
  { key: 'appearance.density', type: 'enum', category: 'appearance', description: 'Default table density.', default: 'comfortable', enumOptions: DENSITIES, validate: ENUM(DENSITIES) },

  // ── Security ──────────────────────────────────────────────────────────
  { key: 'security.sessionTimeoutMinutes', type: 'number', category: 'security', description: 'Inactivity time before a session is signed out.', default: 60, validate: POS_INT(5, 720) },
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
          category: def.category as 'general' | 'inventory' | 'purchase_orders' | 'notifications' | 'users' | 'appearance' | 'security' | 'system' | 'data',
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
    const coerced = coerceAndValidate(def, rawValue);
    const before = await prisma.setting.findUnique({ where: { key } });
    if (!before) throw Errors.notFound('Setting');
    const updated = await prisma.setting.update({
      where: { key },
      data: { value: coerced as Prisma.InputJsonValue, updatedById: actorId },
    });
    await prisma.auditLogEntry.create({
      data: {
        actorId,
        action: 'SETTING_UPDATE',
        entityType: 'Setting',
        entityId: key,
        before: { value: before.value as Prisma.InputJsonValue },
        after: { value: updated.value as Prisma.InputJsonValue },
      },
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
        const coerced = coerceAndValidate(def, raw);
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
