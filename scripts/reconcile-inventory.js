// Usage: npm run db:reconcile   — exits 1 if the Inventory projection has drifted.
import { prisma } from '../src/db/prisma.js';
import { findInventoryDiscrepancies } from '../src/modules/inventory/inventory.reconcile.js';

try {
  const discrepancies = await findInventoryDiscrepancies(prisma);
  if (discrepancies.length === 0) {
    console.log('Inventory reconciliation passed: projection matches ledger, assignments and assets.');
  } else {
    console.error(`Inventory reconciliation FAILED with ${discrepancies.length} discrepancies:`);
    console.table(discrepancies.map((d) => ({ ...d, projected: JSON.stringify(d.projected), expected: JSON.stringify(d.expected) })));
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
