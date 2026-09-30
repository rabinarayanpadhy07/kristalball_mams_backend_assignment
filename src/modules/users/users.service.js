import { prisma } from '../../db/prisma.js';
import { toPublicUser } from './user.serializer.js';

export async function listUsers({ page, pageSize }) {
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      include: { role: true, base: true },
      orderBy: { id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count(),
  ]);
  return { items: rows.map(toPublicUser), total };
}
