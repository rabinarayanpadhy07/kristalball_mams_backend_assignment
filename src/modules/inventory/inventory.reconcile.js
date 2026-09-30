/**
 * Cross-checks the Inventory projection against its sources of truth.
 * Returns a list of discrepancies (empty = consistent). Read-only.
 *
 *  1. on-hand      == Σ ledger quantity_delta                  (per base × equipment)
 *  2. assigned     == Σ outstanding of ACTIVE assignments      (per base × equipment)
 *  3. SERIALIZED:  on-hand == assets at base not EXPENDED; assigned == assets ASSIGNED
 *  4. every ASSIGNED asset has exactly one ACTIVE assignment, and vice versa
 */
export async function findInventoryDiscrepancies(client) {
  const [ledger, assigned, serialized, assetAssignments] = await Promise.all([
    client.$queryRaw`
      SELECT COALESCE(i.base_id, m.base_id) AS baseId, COALESCE(i.equipment_id, m.equipment_id) AS equipmentId,
             i.quantity_on_hand AS projected, m.total AS expected
      FROM inventory i
      LEFT JOIN (SELECT base_id, equipment_id, SUM(quantity_delta) AS total
                 FROM inventory_movements GROUP BY base_id, equipment_id) m
        ON m.base_id = i.base_id AND m.equipment_id = i.equipment_id
      WHERE COALESCE(i.quantity_on_hand, 0) <> COALESCE(m.total, 0)
      UNION ALL
      SELECT m.base_id, m.equipment_id, NULL, SUM(m.quantity_delta)
      FROM inventory_movements m
      LEFT JOIN inventory i ON i.base_id = m.base_id AND i.equipment_id = m.equipment_id
      WHERE i.id IS NULL
      GROUP BY m.base_id, m.equipment_id`,
    client.$queryRaw`
      SELECT i.base_id AS baseId, i.equipment_id AS equipmentId,
             i.quantity_assigned AS projected, COALESCE(a.total, 0) AS expected
      FROM inventory i
      LEFT JOIN (SELECT base_id, equipment_id,
                        SUM(quantity - quantity_returned - quantity_expended) AS total
                 FROM assignments WHERE status = 'ACTIVE'
                 GROUP BY base_id, equipment_id) a
        ON a.base_id = i.base_id AND a.equipment_id = i.equipment_id
      WHERE i.quantity_assigned <> COALESCE(a.total, 0)`,
    client.$queryRaw`
      SELECT i.base_id AS baseId, i.equipment_id AS equipmentId,
             i.quantity_on_hand AS onHand, i.quantity_assigned AS assigned,
             COUNT(CASE WHEN s.status <> 'EXPENDED' THEN 1 END) AS assetsOnHand,
             COUNT(CASE WHEN s.status = 'ASSIGNED' THEN 1 END) AS assetsAssigned
      FROM inventory i
      JOIN equipment e ON e.id = i.equipment_id AND e.tracking_type = 'SERIALIZED'
      LEFT JOIN assets s ON s.equipment_id = i.equipment_id AND s.current_base_id = i.base_id
      GROUP BY i.id
      HAVING onHand <> assetsOnHand OR assigned <> assetsAssigned`,
    client.$queryRaw`
      SELECT s.id AS assetId, s.serial_number AS serialNumber, s.status,
             COUNT(a.id) AS activeAssignments
      FROM assets s
      LEFT JOIN assignments a ON a.asset_id = s.id AND a.status = 'ACTIVE'
      GROUP BY s.id
      HAVING (s.status = 'ASSIGNED' AND activeAssignments <> 1)
          OR (s.status <> 'ASSIGNED' AND activeAssignments <> 0)`,
  ]);

  const num = (v) => (v == null ? null : Number(v));
  return [
    ...ledger.map((r) => ({
      check: 'ON_HAND_VS_LEDGER',
      baseId: num(r.baseId),
      equipmentId: num(r.equipmentId),
      projected: num(r.projected),
      expected: num(r.expected) ?? 0,
    })),
    ...assigned.map((r) => ({
      check: 'ASSIGNED_VS_ASSIGNMENTS',
      baseId: num(r.baseId),
      equipmentId: num(r.equipmentId),
      projected: num(r.projected),
      expected: num(r.expected),
    })),
    ...serialized.map((r) => ({
      check: 'SERIALIZED_VS_ASSETS',
      baseId: num(r.baseId),
      equipmentId: num(r.equipmentId),
      projected: { onHand: num(r.onHand), assigned: num(r.assigned) },
      expected: { onHand: num(r.assetsOnHand), assigned: num(r.assetsAssigned) },
    })),
    ...assetAssignments.map((r) => ({
      check: 'ASSET_STATUS_VS_ASSIGNMENTS',
      assetId: num(r.assetId),
      serialNumber: r.serialNumber,
      status: r.status,
      activeAssignments: num(r.activeAssignments),
    })),
  ];
}
