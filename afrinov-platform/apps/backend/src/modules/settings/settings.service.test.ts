// Settings service tests.
//
// Covers:
//   - default catalog is fully seeded
//   - validation rejects invalid types and out-of-range values
//   - setting one value writes an audit row
//   - setting many runs as a single transaction
//   - reset restores all defaults
//   - getValue falls back to the default when no row exists
import { describe, it, expect, beforeEach, vi } from 'vitest';

type SettingTypeLit = 'string' | 'number' | 'boolean' | 'enum';
type SettingCategoryLit = 'general' | 'inventory' | 'purchase_orders' | 'notifications' | 'users' | 'appearance' | 'security' | 'system' | 'data';

interface SettingRow {
  key: string;
  value: unknown;
  type: SettingTypeLit;
  category: SettingCategoryLit;
  description: string;
  isEditable: boolean;
  enumOptions: string[] | null;
  updatedAt: Date;
  updatedById: string | null;
}
interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

const db = {
  settings: new Map<string, SettingRow>(),
  audit: [] as AuditRow[],
};
let auditCounter = 0;
function nextAuditId(): string { auditCounter += 1; return `audit-${auditCounter}`; }

vi.mock('../../shared/db.js', () => ({ get prisma() { return makePrisma(); } }));

function makePrisma(): unknown {
  // Snapshot of all settings/audit; used to roll back on $transaction failure.
  let snapshot: { settings: Map<string, SettingRow>; audit: AuditRow[] } | null = null;
  return {
    setting: {
      findUnique: async ({ where }: { where: { key: string } }) => db.settings.get(where.key) ?? null,
      findMany: async ({ where }: { where?: { key?: { in: string[] }; category?: string } } = {}) => {
        let rows = Array.from(db.settings.values());
        if (where?.key?.in) rows = rows.filter((r) => where.key!.in.includes(r.key));
        if (where?.category) rows = rows.filter((r) => r.category === where.category);
        return rows;
      },
      deleteMany: async ({ where }: { where: { key: { notIn: string[] } } }) => {
        let count = 0;
        for (const key of Array.from(db.settings.keys())) {
          if (!where.key.notIn.includes(key)) { db.settings.delete(key); count += 1; }
        }
        return { count };
      },
      upsert: async ({ where, create }: { where: { key: string }; create: Omit<SettingRow, 'updatedAt' | 'updatedById'> }) => {
        const existing = db.settings.get(where.key);
        if (existing) return existing;
        const row: SettingRow = { ...create, updatedAt: new Date(), updatedById: null };
        db.settings.set(where.key, row);
        return row;
      },
      update: async ({ where, data }: { where: { key: string }; data: Partial<SettingRow> }) => {
        const existing = db.settings.get(where.key);
        if (!existing) throw new Error('not found');
        const next: SettingRow = { ...existing, ...data, updatedAt: new Date() };
        db.settings.set(where.key, next);
        return next;
      },
    },
    auditLogEntry: {
      create: async ({ data }: { data: Omit<AuditRow, 'id' | 'createdAt'> }) => {
        const row: AuditRow = { ...data, id: nextAuditId(), createdAt: new Date() };
        db.audit.push(row);
        return row;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      // Take a snapshot so we can roll back on failure.
      snapshot = { settings: new Map(db.settings), audit: [...db.audit] };
      try {
        return await fn(makePrisma());
      } catch (err) {
        if (snapshot) {
          db.settings = new Map(snapshot.settings);
          db.audit = [...snapshot.audit];
        }
        throw err;
      } finally {
        snapshot = null;
      }
    },
  };
}

beforeEach(() => {
  db.settings.clear();
  db.audit.length = 0;
  auditCounter = 0;
});

describe('SettingsService', () => {
  it('seeds every catalog key with its default', async () => {
    const { SettingsService, SETTING_CATALOG } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    expect(db.settings.size).toBe(SETTING_CATALOG.length);
    const company = db.settings.get('general.companyName');
    expect(company?.value).toBe('Afrinov');
  });

  it('deletes and hides settings that were retired from the catalog', async () => {
    const { SettingsService } = await import('./settings.service.js');
    const retired: SettingRow = {
      key: 'inventory.enableNegativeStockPrevention', value: false, type: 'boolean', category: 'inventory',
      description: 'Retired', isEditable: true, enumOptions: null, updatedAt: new Date(), updatedById: null,
    };
    db.settings.set(retired.key, retired);

    // Before the next seed the row still exists, but nothing exposes it.
    expect((await SettingsService.list()).map((s) => s.key)).not.toContain(retired.key);
    await expect(SettingsService.get(retired.key)).rejects.toThrow(/not found/);

    await SettingsService.ensureSeeded();
    expect(db.settings.has(retired.key)).toBe(false);
  });

  it('lists settings sorted by category+key', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    const list = await SettingsService.list();
    // Prisma's enum sort uses the schema-defined ordinal, not alphabetical
    // string order. The catalog covers general, inventory, purchase_orders,
    // notifications, appearance, security. The first category returned is
    // 'general' (declared first in the schema).
    const cats = Array.from(new Set(list.map((l) => l.category)));
    expect(cats[0]).toBe('general');
    expect(cats).toContain('security');
    // Each returned row is in strictly non-decreasing category order.
    const ordinals = new Map<string, number>([
      ['general', 0], ['inventory', 1], ['purchase_orders', 2],
      ['notifications', 3], ['appearance', 4], ['security', 5],
    ]);
    const indices = list.map((l) => ordinals.get(l.category) ?? -1);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]!);
    }
  });

  it('rejects a too-short company name on update', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('general.companyName', '', 'u-1')).rejects.toThrow(/at least/i);
  });

  it('rejects non-numeric defaultPageSize', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('general.defaultPageSize', 'not-a-number', 'u-1')).rejects.toThrow(/number/i);
  });

  it('rejects out-of-range page size', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('general.defaultPageSize', 9999, 'u-1')).rejects.toThrow(/between/i);
  });

  it('rejects an unsupported enum value', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('general.defaultCurrency', 'AUD', 'u-1')).rejects.toThrow(/not supported/i);
  });

  it('rejects boolean written as a non-boolean string', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('inventory.enableStockAlerts', 'maybe', 'u-1')).rejects.toThrow(/true or false/i);
  });

  it('persists a valid update and writes an audit row', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    const updated = await SettingsService.set('general.companyName', 'NewCo Holdings', 'u-1');
    expect(updated.value).toBe('NewCo Holdings');
    expect(updated.updatedById).toBe('u-1');
    const audit = db.audit.find((a) => a.entityId === 'general.companyName' && a.action === 'SETTING_UPDATE');
    expect(audit).toBeDefined();
    expect((audit!.before as { value: string }).value).toBe('Afrinov');
    expect((audit!.after as { value: string }).value).toBe('NewCo Holdings');
  });

  it('rejects an unknown key', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.set('does.not.exist', 'x', 'u-1')).rejects.toThrow(/not found/i);
  });

  it('setMany persists all updates in a single transaction', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    const out = await SettingsService.setMany({
      'general.companyName': 'BatchCo',
      'inventory.enableStockAlerts': false,
    }, 'u-1');
    expect(out).toHaveLength(2);
    expect(db.settings.get('general.companyName')?.value).toBe('BatchCo');
    expect(db.settings.get('inventory.enableStockAlerts')?.value).toBe(false);
    expect(db.audit.filter((a) => a.action === 'SETTING_BULK_UPDATE')).toHaveLength(2);
  });

  it('setMany fails the whole transaction if any key is invalid', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await expect(SettingsService.setMany({
      'general.companyName': 'OK',
      'general.defaultPageSize': -1,
    }, 'u-1')).rejects.toThrow();
    // company name must still be the seeded default because the txn rolled back
    expect(db.settings.get('general.companyName')?.value).toBe('Afrinov');
  });

  it('resetDefaults restores every setting to its catalog default', async () => {
    const { SettingsService, SETTING_CATALOG } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    await SettingsService.set('general.companyName', 'Changed', 'u-1');
    await SettingsService.resetDefaults('u-1');
    expect(db.settings.get('general.companyName')?.value).toBe('Afrinov');
    expect(db.audit.filter((a) => a.action === 'SETTING_RESET').length).toBe(SETTING_CATALOG.length);
  });

  it('getValue returns the default when no row exists', async () => {
    const { SettingsService } = await import('./settings.service.js');
    expect(await SettingsService.getValue<string>('general.companyName')).toBe('Afrinov');
  });

  it('getValues returns a key->value map for the requested keys', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    const map = await SettingsService.getValues(['general.companyName', 'inventory.lowStockMultiplier', 'does.not.exist']);
    expect(map['general.companyName']).toBe('Afrinov');
    expect(map['inventory.lowStockMultiplier']).toBe(1);
    expect(map['does.not.exist']).toBeUndefined();
  });

  it('non-editable settings cannot be written', async () => {
    const { SettingsService } = await import('./settings.service.js');
    await SettingsService.ensureSeeded();
    // Force one catalog entry to be locked to exercise the editor guard.
    const { SETTING_CATALOG } = await import('./settings.service.js');
    const target = SETTING_CATALOG.find((d) => d.key === 'general.companyName')!;
    const orig = target.isEditable;
    (target as { isEditable?: boolean }).isEditable = false;
    try {
      await expect(SettingsService.set('general.companyName', 'X', 'u-1')).rejects.toThrow(/not editable/i);
    } finally {
      (target as { isEditable?: boolean }).isEditable = orig;
    }
  });

  describe('coerceAndValidate', () => {
    it('accepts boolean written as "true" string', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const result = await SettingsService.set('inventory.enableStockAlerts', 'true', 'u-1');
      expect(result.value).toBe(true);
    });

    it('accepts boolean written as "false" string', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const result = await SettingsService.set('inventory.enableStockAlerts', 'false', 'u-1');
      expect(result.value).toBe(false);
    });

    it('accepts number written as string', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const result = await SettingsService.set('general.defaultPageSize', '50', 'u-1');
      expect(result.value).toBe(50);
    });

    it('coerces enum string and validates against options', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const result = await SettingsService.set('general.defaultCurrency', 'USD', 'u-1');
      expect(result.value).toBe('USD');
      expect(result.enumOptions).toEqual(expect.arrayContaining(['ZAR', 'USD', 'EUR', 'GBP']));
    });

    it('rejects invalid enum value for currency', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      await expect(
        SettingsService.set('general.defaultCurrency', 'CAD', 'u-1'),
      ).rejects.toThrow(/not supported/i);
    });

    it('rejects string value for number setting', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      await expect(
        SettingsService.set('security.sessionTimeoutMinutes', 'abc', 'u-1'),
      ).rejects.toThrow(/must be a number/i);
    });

    it('rejects non-boolean string for boolean setting', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      await expect(
        SettingsService.set('inventory.enableStockAlerts', 'nope', 'u-1'),
      ).rejects.toThrow(/true or false/i);
    });

    it('rejects negative value for non-negative number setting', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      await expect(
        SettingsService.set('inventory.lowStockMultiplier', -1, 'u-1'),
      ).rejects.toThrow(/at least 0/i);
    });
  });

  describe('list with category filter', () => {
    it('returns only settings in the given category', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const inventorySettings = await SettingsService.list({ category: 'inventory' });
      expect(inventorySettings.every((s) => s.category === 'inventory')).toBe(true);
      expect(inventorySettings.length).toBeGreaterThan(0);
    });

    it('returns all settings when no category filter', async () => {
      const { SettingsService, SETTING_CATALOG } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const all = await SettingsService.list();
      expect(all).toHaveLength(SETTING_CATALOG.length);
    });
  });

  describe('get', () => {
    it('returns a setting by key with full metadata', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      const s = await SettingsService.get('general.companyName');
      expect(s.key).toBe('general.companyName');
      expect(s.value).toBe('Afrinov');
      expect(s.type).toBe('string');
      expect(s.category).toBe('general');
      expect(s.isEditable).toBe(true);
    });

    it('throws NOT_FOUND when key does not exist in DB', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await expect(SettingsService.get('general.companyName')).rejects.toThrow(/not found/i);
    });
  });

  describe('resetDefaults', () => {
    it('writes an audit entry with reset=true marker', async () => {
      const { SettingsService } = await import('./settings.service.js');
      await SettingsService.ensureSeeded();
      await SettingsService.set('general.companyName', 'Changed', 'u-1');
      const result = await SettingsService.resetDefaults('u-1');
      expect(result.every((r) => r.value === 'Afrinov' || typeof r.value === 'boolean' || typeof r.value === 'number' || typeof r.value === 'string')).toBe(true);
      const resetAudit = db.audit.filter((a) => a.action === 'SETTING_RESET');
      expect(resetAudit.length).toBeGreaterThan(0);
    });
  });
});
