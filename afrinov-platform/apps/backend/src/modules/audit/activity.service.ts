// "Other activity" on the Movements page: the audit log's record of what was
// done at the shop besides stock movements (counts, catalogue and master-data
// changes, users, imports), each described in a plain sentence.
//
// Left out: settings changes (Settings > Change history has them),
// purchase-order entries (procurement is out of scope) and entries that the
// Movements list already shows as ledger rows (stock receipts, returns and
// reversals), so nothing appears twice.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { dayRange, pageCursor, parseCursor } from '../../shared/dates.js';

export const ACTIVITY_TYPES = [
  'StockCount', 'Material', 'Location', 'Rack', 'Project', 'Recipient', 'Supplier', 'User', 'WorkbookImport',
] as const;

export interface ActivityFilter {
  from?: string;
  to?: string;
  /** One of ACTIVITY_TYPES; anything else selects nothing. */
  entityType?: string;
  actorId?: string;
  /** Stock counts at this location (other entries carry no location). */
  locationId?: string;
  before?: string;
  limit?: number;
}

export interface ActivityRow {
  id: string;
  cursor: string;
  at: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorName: string;
  summary: string;
  /** Where in the app the record lives, when it has a page. */
  link: string | null;
}

type Json = Record<string, unknown>;
type Entry = { id: string; action: string; entityType: string; entityId: string; actorId: string | null; before: unknown; after: unknown; createdAt: Date };

export function activityWhere(filter: Omit<ActivityFilter, 'before' | 'limit'>): Prisma.AuditLogEntryWhereInput {
  const types: readonly string[] = ACTIVITY_TYPES;
  const where: Prisma.AuditLogEntryWhereInput = {
    entityType: filter.entityType ? (types.includes(filter.entityType) ? filter.entityType : '__none__') : { in: [...ACTIVITY_TYPES] },
  };
  const createdAt = dayRange(filter.from, filter.to);
  if (createdAt) where.createdAt = createdAt;
  if (filter.actorId) where.actorId = filter.actorId;
  if (filter.locationId) {
    where.entityType = 'StockCount';
    where.after = { path: ['locationId'], equals: filter.locationId };
  }
  return where;
}

const FIELD_LABEL: Record<string, string> = {
  name: 'name', description: 'description', unitOfMeasure: 'unit', requiredStock: 'required stock', unitCost: 'unit price',
  category: 'category', code: 'code', type: 'type', address: 'address', notes: 'notes', status: 'status', capacity: 'capacity',
  locationId: 'location', projectNumber: 'project', managerId: 'manager', startDate: 'start date', endDate: 'end date',
  contactPerson: 'contact person', contactPhone: 'contact phone', roles: 'roles',
};

/** The fields an edit changed, in words; activation is said separately. */
function changed(before: unknown, after: unknown): { fields: string[]; active?: boolean } {
  const b = (before ?? {}) as Json;
  const a = (after ?? {}) as Json;
  const fields: string[] = [];
  for (const key of Object.keys(FIELD_LABEL)) {
    if (key in a && JSON.stringify(a[key]) !== JSON.stringify(b[key])) fields.push(FIELD_LABEL[key]!);
  }
  const active = 'active' in a && a['active'] !== b['active'] ? Boolean(a['active']) : undefined;
  return { fields, active };
}

function editSentence(noun: string, label: string, before: unknown, after: unknown): string {
  const { fields, active } = changed(before, after);
  const parts = [active === undefined ? null : active ? 'reactivated it' : 'deactivated it', fields.length ? `changed ${fields.join(', ')}` : null].filter(Boolean);
  return `Edited ${noun} ${label}${parts.length ? `: ${parts.join('; ')}` : ''}`;
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** A plain sentence for an entry, and where its record lives. `names` resolves ids the entry only refers to. */
export function describeActivity(e: Entry, names: Map<string, string>): { summary: string; link: string | null } {
  const a = (e.after ?? {}) as Json;
  const b = (e.before ?? {}) as Json;
  const known = (id: string) => names.get(id);
  switch (e.entityType) {
    case 'StockCount': {
      const where = known(String(a['locationId'])) ?? 'a location';
      const counted = Number(a['counted'] ?? 0);
      const adjusted = Number(a['adjusted'] ?? 0);
      const day = e.createdAt.toISOString().slice(0, 10);
      return {
        summary: `Counted ${where}: ${counted} item${counted === 1 ? '' : 's'}, ${adjusted === 0 ? 'no differences' : `${adjusted} adjusted`}${str(a['note']) ? ` (${a['note']})` : ''}`,
        link: a['locationId'] ? `/movements?from=${day}&to=${day}&type=ADJUSTMENT&locationId=${a['locationId']}` : null,
      };
    }
    case 'Material': {
      const label = [str(a['sku']) ?? str(b['sku']), str(a['name']) ?? str(b['name'])].filter(Boolean).join(' ') || 'an item';
      const link = `/materials/${e.entityId}`;
      if (e.action === 'CREATE') return { summary: `Added item ${label}`, link };
      if (e.action === 'UPDATE') return { summary: editSentence('item', label, e.before, e.after), link };
      break;
    }
    case 'Location': {
      const label = str(a['name']) ?? str(b['name']) ?? known(e.entityId) ?? 'a location';
      if (e.action === 'CREATE') return { summary: `Added location ${label}`, link: '/locations' };
      if (e.action === 'UPDATE') return { summary: editSentence('location', label, e.before, e.after), link: '/locations' };
      if (e.action === 'ACTIVATE') return { summary: `Activated location ${label}`, link: '/locations' };
      if (e.action === 'DEACTIVATE') return { summary: `Deactivated location ${label}`, link: '/locations' };
      if (e.action === 'DELETE') return { summary: `Deleted location ${label}`, link: null };
      break;
    }
    case 'Rack': {
      const label = [str(a['code']) ?? str(b['code']), str(a['name']) ?? str(b['name'])].filter(Boolean).join(' ') || known(e.entityId) || 'a rack';
      if (e.action === 'CREATE') return { summary: `Added rack ${label}`, link: '/racks' };
      if (e.action === 'UPDATE') return { summary: editSentence('rack', label, e.before, e.after), link: '/racks' };
      if (e.action === 'ARCHIVE') return { summary: `Archived rack ${label}`, link: '/racks' };
      break;
    }
    case 'Project': {
      const label = [e.entityId, str(a['name']) ?? str(b['name'])].filter(Boolean).join(' ');
      if (e.action === 'CREATE') return { summary: `Added project ${label}`, link: '/projects' };
      if (e.action === 'UPDATE') return { summary: editSentence('project', label, e.before, e.after), link: '/projects' };
      if (e.action === 'ARCHIVE') return { summary: `Cancelled project ${label}`, link: '/projects' };
      break;
    }
    case 'Recipient': {
      const label = str(a['name']) ?? str(b['name']) ?? 'a recipient';
      const type = str(a['type'])?.toLowerCase();
      if (e.action === 'CREATE') return { summary: `Added recipient ${label}${type ? ` (${type})` : ''}`, link: '/recipients' };
      if (e.action === 'UPDATE') return { summary: editSentence('recipient', label, e.before, e.after), link: '/recipients' };
      break;
    }
    case 'Supplier':
      if (e.action === 'CREATE') return { summary: `Added supplier ${str(a['name']) ?? ''}`.trim(), link: `/suppliers/${e.entityId}` };
      break;
    case 'User': {
      const label = str(a['name']) ?? str(b['name']) ?? 'a user';
      const roles = Array.isArray(a['roles']) ? (a['roles'] as string[]).map((r) => r.toLowerCase().replace(/_/g, ' ')).join(', ') : '';
      if (e.action === 'CREATE') return { summary: `Added user ${label}${str(a['email']) ? ` (${a['email']})` : ''}${roles ? ` as ${roles}` : ''}`, link: null };
      if (e.action === 'UPDATE') return { summary: editSentence('user', label, e.before, e.after), link: null };
      break;
    }
    case 'WorkbookImport':
      return {
        summary: `Imported opening balances${str(a['sourceFile']) ? ` from ${a['sourceFile']}` : ''}: ${Number(a['materials'] ?? 0)} items, ${Number(a['balances'] ?? 0)} balances${str(a['openingDate']) ? ` as at ${a['openingDate']}` : ''}`,
        link: null,
      };
  }
  // An action this list has no sentence for yet still shows, in plain terms.
  return { summary: `${e.action.charAt(0)}${e.action.slice(1).toLowerCase().replace(/_/g, ' ')} ${e.entityType} ${e.entityId}`, link: null };
}

export const ActivityService = {
  async list(filter: ActivityFilter): Promise<ActivityRow[]> {
    const base = activityWhere(filter);
    let where = base;
    if (filter.before) {
      const { at, id } = parseCursor(filter.before);
      where = { AND: [base, { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] }] };
    }
    const entries = await prisma.auditLogEntry.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(filter.limit ?? 100, 500),
    });

    // Names the sentences need but the entries only refer to by id.
    const userIds = new Set(entries.map((e) => e.actorId).filter((id): id is string => !!id));
    const locationIds = new Set<string>();
    const rackIds = new Set<string>();
    for (const e of entries) {
      const after = (e.after ?? {}) as Json;
      if (e.entityType === 'StockCount' && typeof after['locationId'] === 'string') locationIds.add(after['locationId']);
      if (e.entityType === 'Location' && (e.action === 'ACTIVATE' || e.action === 'DEACTIVATE')) locationIds.add(e.entityId);
      if (e.entityType === 'Rack' && e.action === 'ARCHIVE') rackIds.add(e.entityId);
    }
    const [users, locations, racks] = await Promise.all([
      userIds.size ? prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : [],
      locationIds.size ? prisma.location.findMany({ where: { id: { in: [...locationIds] } }, select: { id: true, name: true } }) : [],
      rackIds.size ? prisma.rack.findMany({ where: { id: { in: [...rackIds] } }, select: { id: true, code: true, name: true } }) : [],
    ]);
    const names = new Map<string, string>([
      ...locations.map((l) => [l.id, l.name] as [string, string]),
      ...racks.map((r) => [r.id, `${r.code} ${r.name}`] as [string, string]),
    ]);
    const userName = new Map(users.map((u) => [u.id, u.name]));

    return entries.map((e) => ({
      id: e.id,
      cursor: pageCursor(e.createdAt, e.id),
      at: e.createdAt.toISOString(),
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      actorId: e.actorId,
      actorName: e.actorId ? userName.get(e.actorId) ?? 'Unknown user' : 'System',
      ...describeActivity(e, names),
    }));
  },

  /** Everyone with an entry in the activity list, for the "by" filter. Names only. */
  async actors(): Promise<Array<{ id: string; name: string }>> {
    const ids = await prisma.auditLogEntry.findMany({
      where: { entityType: { in: [...ACTIVITY_TYPES] }, actorId: { not: null } },
      distinct: ['actorId'],
      select: { actorId: true },
    });
    const users = await prisma.user.findMany({ where: { id: { in: ids.map((r) => r.actorId!) } }, select: { id: true, name: true } });
    return users.sort((a, b) => a.name.localeCompare(b.name));
  },
};
