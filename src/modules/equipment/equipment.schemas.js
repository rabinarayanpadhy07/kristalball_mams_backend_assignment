import { z } from 'zod';
import { bodyId, id, optionalText, pagination } from '../../utils/schemas.js';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listEquipmentQuery = z
  .object({
    equipmentTypeId: id.optional(),
    trackingType: z.enum(['SERIALIZED', 'QUANTITY']).optional(),
    isActive: booleanString.optional(),
    /** Matches code or name. */
    q: z.string().trim().min(1).max(100).optional(),
    ...pagination,
  })
  .strict();

export const listEquipmentTypesQuery = z.object({ isActive: booleanString.optional() }).strict();

export const createEquipmentBody = z
  .object({
    equipmentTypeId: bodyId,
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/, 'Must be 2–40 letters, digits or hyphens'),
    name: z.string().trim().min(2).max(150),
    trackingType: z.enum(['SERIALIZED', 'QUANTITY']),
    unitOfMeasure: z.enum(['UNIT', 'ROUND', 'BOX', 'LITRE', 'KILOGRAM']).default('UNIT'),
    description: optionalText(500),
  })
  .strict()
  .refine((b) => b.trackingType !== 'SERIALIZED' || b.unitOfMeasure === 'UNIT', {
    message: 'Serialized equipment is counted in UNIT',
    path: ['unitOfMeasure'],
  });
