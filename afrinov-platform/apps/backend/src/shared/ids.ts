import { z } from 'zod';

// Supplier ids are not always UUIDs: the seed gives its demo suppliers
// readable ids such as "seed-sup-hydroscand", and imported suppliers may keep
// their own. Accept any non-empty id; the service checks that it exists.
export const supplierIdSchema = z.string().trim().min(1).max(100);
