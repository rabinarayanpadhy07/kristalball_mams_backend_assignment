/**
 * Writes one audit row. Always pass the transaction client of the business
 * operation being audited so the change and its audit row commit or roll back together.
 *
 * @param {import('../../generated/prisma/client.ts').Prisma.TransactionClient} tx
 * @param {object} entry
 * @param {{ id: number, email: string, role: string } | null} entry.actor
 * @param {string} entry.action       e.g. PURCHASE_CREATED
 * @param {string} entry.entityType   model name, e.g. Purchase
 * @param {number|string} [entry.entityId]
 * @param {number|null} [entry.baseId]
 * @param {object} [entry.before]
 * @param {object} [entry.after]
 * @param {object} [entry.metadata]
 * @param {{ requestId?: string, ip?: string, userAgent?: string }} [entry.context]
 */
export function recordAudit(tx, entry) {
  const { actor, action, entityType, entityId, baseId = null, before, after, metadata, context = {} } = entry;

  return tx.auditLog.create({
    data: {
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      action,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      baseId,
      requestId: context.requestId ?? null,
      ipAddress: context.ip ?? null,
      userAgent: context.userAgent ? String(context.userAgent).slice(0, 512) : null,
      before: toJson(before),
      after: toJson(after),
      metadata: toJson(metadata),
    },
  });
}

// Dates → ISO strings, Decimals → strings (via toJSON); undefined leaves the column NULL.
function toJson(value) {
  return value === undefined || value === null ? undefined : JSON.parse(JSON.stringify(value));
}
