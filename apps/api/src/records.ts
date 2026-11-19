import { z } from 'zod';
import { HttpError } from './http.ts';

export const recordQuery = z
  .object({
    q: z.string().trim().max(100).default(''),
    status: z.enum(['active', 'archived', 'all']).default('active'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();

export const recordPageSize = 20;

export function checkRecordVersion(
  current: number,
  version: number,
  kind: 'Contact' | 'Company' | 'Opportunity' | 'Stage',
) {
  if (current !== version)
    throw new HttpError(
      409,
      `${kind.toUpperCase()}_CONFLICT`,
      `This ${kind.toLowerCase()} changed. Reload it before saving.`,
    );
}
