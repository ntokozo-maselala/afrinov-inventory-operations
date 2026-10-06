// Stock-item onboarding service.
//
// Creates a new inventory/stock item end-to-end in a single transaction:
//   1. Insert the Material master record (enforces SKU uniqueness).
//   2. If an initial quantity is supplied, record a RECEIPT inventory
//      transaction so the ledger remains the source of truth (ADR-002).
//   3. Recompute the affected inventory balance so reads stay in sync.
//   4. Write an audit log entry for the material creation.
//
// This is the canonical way to onboard stock in the system. The stock page
// and the materials page can both rely on this code path.
import { Prisma, InventoryTransactionType } from '@prisma/client';
import { prisma } from '../../shared/db.js';
import { Errors } from '../../shared/errors.js';
import { toDecimal, gtZero, ZERO } from '../../shared/decimal.js';
import { dispatchDomainEvents, type DomainEvent } from '../../shared/events.js';

export type MaterialCategory =
  | 'FASTENERS_SLUGS_INSULATION'
  | 'TOOLING_PPE_ELECTRICAL'
  | 'PROJECT_MATERIAL'
  | 'CONSUMABLES'
  | 'TOOLS';

export interface CreateStockItemInput {
  sku: string;
  name: string;
  category: MaterialCategory;
  description?: string;
  unitOfMeasure: string;
  requiredStock?: number;
  unitCost?: number;
  initialQuantity?: number;
  locationId?: string;
  supplierId?: string;
}

export interface CreateStockItemResult {
  material: {
    id: string;
    sku: string;
    name: string;
    category: string;
    description: string | null;
    unitOfMeasure: string;
    requiredStock: string;
    unitCost: string | null;
    active: boolean;
  };
  initialTransactionId: string | null;
}

async function recomputeBalance(
  materialId: string,
  locationId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const agg = await tx.inventoryTransaction.aggregate({
    where: { materialId, locationId },
    _sum: { quantity: true },
  });
  const total = agg._sum.quantity ?? ZERO;
  await tx.inventoryBalance.upsert({
    where: { materialId_locationId: { materialId, locationId } },
    create: { materialId, locationId, quantity: total },
    update: { quantity: total },
  });
}

export const StockItemService = {
  async createWithInitialStock(input: CreateStockItemInput, actorId: string): Promise<CreateStockItemResult> {
    const sku = input.sku.trim();
    const name = input.name.trim();
    const unitOfMeasure = input.unitOfMeasure.trim();

    if (!sku) throw Errors.validation('SKU is required');
    if (!name) throw Errors.validation('Name is required');
    if (!unitOfMeasure) throw Errors.validation('Unit of measure is required');

    const initialQty = input.initialQuantity !== undefined ? toDecimal(input.initialQuantity) : ZERO;
    if (initialQty.isNegative()) {
      throw Errors.validation('Initial quantity cannot be negative');
    }
    if (gtZero(initialQty) && !input.locationId) {
      throw Errors.validation('A location is required when an initial quantity is supplied');
    }
    if (gtZero(initialQty)) {
      const loc = await prisma.location.findUnique({ where: { id: input.locationId! } });
      if (!loc) throw Errors.notFound('Location');
      if (!loc.active) throw Errors.validation('Location is inactive');
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.material.findUnique({ where: { sku } });
      if (existing) throw Errors.conflict(`An item with this SKU already exists.`);

      const material = await tx.material.create({
        data: {
          sku,
          name,
          description: input.description?.trim() || null,
          category: input.category,
          unitOfMeasure,
          requiredStock: input.requiredStock ?? 0,
          unitCost: input.unitCost ?? null,
        },
      });

      let initialTransactionId: string | null = null;
      if (gtZero(initialQty)) {
        const trx = await tx.inventoryTransaction.create({
          data: {
            materialId: material.id,
            locationId: input.locationId!,
            type: InventoryTransactionType.RECEIPT,
            quantity: initialQty,
            referenceType: 'InitialStock',
            referenceId: material.id,
            actorId,
          },
        });
        initialTransactionId = trx.id;
        await recomputeBalance(material.id, input.locationId!, tx);
      }

      await tx.auditLogEntry.create({
        data: {
          actorId,
          action: 'CREATE',
          entityType: 'Material',
          entityId: material.id,
          after: material as unknown as Prisma.InputJsonValue,
        },
      });

      const events: DomainEvent[] = [];
      if (initialTransactionId) {
        events.push({
          type: 'InventoryIncreased',
          materialId: material.id,
          locationId: input.locationId!,
          quantity: initialQty.toNumber(),
        });
      }
      await dispatchDomainEvents(events);

      return {
        material: {
          id: material.id,
          sku: material.sku,
          name: material.name,
          category: material.category,
          description: material.description,
          unitOfMeasure: material.unitOfMeasure,
          requiredStock: material.requiredStock.toString(),
          unitCost: material.unitCost ? material.unitCost.toString() : null,
          active: material.active,
        },
        initialTransactionId,
      };
    });
  },
};