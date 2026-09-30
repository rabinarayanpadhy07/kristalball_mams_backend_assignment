/**
 * DEVELOPMENT SEED DATA — NOT FOR PRODUCTION.
 *
 * All people, bases, suppliers and serial numbers are fictional. Every account
 * uses one development password (SEED_DEV_PASSWORD, or the default below) and an
 * @mams.com address (a reserved, non-routable domain).
 *
 * Stock is posted through the real inventory service, in chronological order, so
 * the ledger, the Inventory projection, asset states and audit logs are consistent
 * exactly as they would be in production. The seed finishes by running the
 * reconciliation check and fails loudly if anything has drifted.
 *
 * Run:  npx prisma migrate reset     (drops the DB, re-applies migrations, seeds)
 *  or:  npm run db:seed              (only on an empty, migrated database)
 */
import { hashPassword } from '../src/modules/auth/password.js';
import { env } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import {
  cancelTransfer,
  completeTransfer,
  createAssignment,
  createTransfer,
  postExpenditure,
  postPurchase,
  postStockAdjustment,
  returnAssignment,
} from '../src/modules/inventory/inventory.service.js';
import { findInventoryDiscrepancies } from '../src/modules/inventory/inventory.reconcile.js';
import { recordAudit } from '../src/modules/audit/audit.service.js';

const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD || 'DevOnly-Mams-2026!';
const CONTEXT = { requestId: 'dev-seed', userAgent: 'mams-dev-seed' };

// ─────────────────────────────────────────────────────────────────────────────
// Reference data
// ─────────────────────────────────────────────────────────────────────────────

const ROLES = [
  { code: 'ADMIN', name: 'Administrator', description: 'Full access to all bases, master data, users and audit logs.' },
  { code: 'BASE_COMMANDER', name: 'Base Commander', description: 'Full operational access limited to the assigned base.' },
  { code: 'LOGISTICS_OFFICER', name: 'Logistics Officer', description: 'Purchases and outbound transfers for the assigned base.' },
];

const BASES = [
  { code: 'FTA', name: 'Fort Alder', location: 'Northern Sector' },
  { code: 'CHW', name: 'Camp Harlow', location: 'Eastern Sector' },
  { code: 'KAF', name: 'Kestrel Airfield', location: 'Southern Sector' },
];

const USERS = [
  { key: 'admin', email: 'admin@mams.com', fullName: 'Rabi Narayan', serviceNumber: 'DEV-100001', role: 'ADMIN', base: null },
  { key: 'cmdrFTA', email: 'cmdr.alder@mams.com', fullName: 'Col. Srikanta Panigrahy', serviceNumber: 'DEV-100101', role: 'BASE_COMMANDER', base: 'FTA' },
  { key: 'cmdrCHW', email: 'cmdr.harlow@mams.com', fullName: 'Lt. Col. Kuresu Sahu', serviceNumber: 'DEV-100102', role: 'BASE_COMMANDER', base: 'CHW' },
  { key: 'cmdrKAF', email: 'cmdr.kestrel@mams.com', fullName: 'Maj. Vikram Singh Rathore', serviceNumber: 'DEV-100103', role: 'BASE_COMMANDER', base: 'KAF' },
  { key: 'logFTA', email: 'logistics.alder@mams.com', fullName: 'Capt. Mahes Kumar', serviceNumber: 'DEV-100201', role: 'LOGISTICS_OFFICER', base: 'FTA' },
  { key: 'logCHW', email: 'logistics.harlow@mams.com', fullName: 'Lt. Rohan Kulkarni', serviceNumber: 'DEV-100202', role: 'LOGISTICS_OFFICER', base: 'CHW' },
  { key: 'logKAF', email: 'logistics.kestrel@mams.com', fullName: 'Sub. Harpreet Kaur', serviceNumber: 'DEV-100203', role: 'LOGISTICS_OFFICER', base: 'KAF' },
  // Deactivated account, for testing that inactive users cannot sign in.
  { key: 'inactive', email: 'former.logistics@mams.com', fullName: 'Lt. Mahesh Pradhan', serviceNumber: 'DEV-100299', role: 'LOGISTICS_OFFICER', base: 'FTA', isActive: false },
];

const EQUIPMENT_TYPES = [
  { code: 'WPN', name: 'Weapons', description: 'Small arms and crew-served weapons.' },
  { code: 'VEH', name: 'Vehicles', description: 'Tactical and logistics vehicles.' },
  { code: 'AMM', name: 'Ammunition', description: 'Small-arms ammunition and ordnance.' },
  { code: 'COM', name: 'Communications', description: 'Radios and power supplies.' },
  { code: 'MED', name: 'Medical Supplies', description: 'Individual and unit medical consumables.' },
  { code: 'POL', name: 'Fuel & Lubricants', description: 'Petroleum, oils and lubricants.' },
];

const EQUIPMENT = [
  { code: 'WPN-M4A1', type: 'WPN', name: 'M4A1 Carbine', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'WPN-M17', type: 'WPN', name: 'M17 Pistol', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'WPN-M249', type: 'WPN', name: 'M249 Light Machine Gun', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'VEH-M1151', type: 'VEH', name: 'HMMWV M1151', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'VEH-JLTV', type: 'VEH', name: 'JLTV M1278 Heavy Guns Carrier', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'VEH-M1078', type: 'VEH', name: 'LMTV M1078 Cargo Truck', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'AMM-556', type: 'AMM', name: '5.56mm Ball M855A1', trackingType: 'QUANTITY', unitOfMeasure: 'ROUND' },
  { code: 'AMM-9MM', type: 'AMM', name: '9mm Ball M1152', trackingType: 'QUANTITY', unitOfMeasure: 'ROUND' },
  { code: 'AMM-762', type: 'AMM', name: '7.62mm Linked M80A1', trackingType: 'QUANTITY', unitOfMeasure: 'ROUND' },
  { code: 'AMM-M67', type: 'AMM', name: 'M67 Fragmentation Grenade', trackingType: 'QUANTITY', unitOfMeasure: 'UNIT' },
  { code: 'COM-PRC163', type: 'COM', name: 'AN/PRC-163 Handheld Radio', trackingType: 'SERIALIZED', unitOfMeasure: 'UNIT' },
  { code: 'COM-BA5590', type: 'COM', name: 'BA-5590 Lithium Battery', trackingType: 'QUANTITY', unitOfMeasure: 'UNIT' },
  { code: 'MED-IFAK', type: 'MED', name: 'IFAK II First Aid Kit', trackingType: 'QUANTITY', unitOfMeasure: 'UNIT' },
  { code: 'MED-CAT', type: 'MED', name: 'CAT Tourniquet', trackingType: 'QUANTITY', unitOfMeasure: 'UNIT' },
  { code: 'POL-JP8', type: 'POL', name: 'JP-8 Fuel', trackingType: 'QUANTITY', unitOfMeasure: 'LITRE' },
];

// Opening stock loaded on go-live day (per base).
const OPENING_DATE = '2026-07-01T06:00:00Z';
const OPENING_STOCK = {
  FTA: { 'WPN-M4A1': 60, 'WPN-M17': 20, 'WPN-M249': 8, 'VEH-M1151': 10, 'VEH-JLTV': 4, 'VEH-M1078': 6, 'AMM-556': 120000, 'AMM-9MM': 30000, 'AMM-762': 40000, 'AMM-M67': 300, 'COM-PRC163': 30, 'COM-BA5590': 400, 'MED-IFAK': 200, 'MED-CAT': 250, 'POL-JP8': 60000 },
  CHW: { 'WPN-M4A1': 40, 'WPN-M17': 12, 'WPN-M249': 6, 'VEH-M1151': 8, 'VEH-JLTV': 2, 'VEH-M1078': 4, 'AMM-556': 80000, 'AMM-9MM': 20000, 'AMM-762': 25000, 'AMM-M67': 150, 'COM-PRC163': 20, 'COM-BA5590': 250, 'MED-IFAK': 150, 'MED-CAT': 180, 'POL-JP8': 40000 },
  KAF: { 'WPN-M4A1': 25, 'WPN-M17': 15, 'WPN-M249': 2, 'VEH-M1151': 6, 'VEH-M1078': 8, 'AMM-556': 40000, 'AMM-9MM': 15000, 'AMM-762': 8000, 'AMM-M67': 50, 'COM-PRC163': 25, 'COM-BA5590': 300, 'MED-IFAK': 120, 'MED-CAT': 120, 'POL-JP8': 150000 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Transaction history, July–September 2026
// ─────────────────────────────────────────────────────────────────────────────
// `count` on serialized purchases generates new serials; serialized transfers,
// assignments and expenditures pick currently AVAILABLE assets at the source base.
// Transfers are raised by `by` and completed (approved) by the source base commander
// on the same date unless `status` says otherwise.

const PURCHASES = [
  { at: '2026-07-08T09:30:00Z', by: 'logFTA', base: 'FTA', eq: 'AMM-556', qty: 50000, unitCost: '0.42', supplier: 'Northwind Defense Supply Co.', po: 'PO-FTA-26-0107' },
  { at: '2026-07-15T10:00:00Z', by: 'logCHW', base: 'CHW', eq: 'WPN-M4A1', count: 10, unitCost: '1150.00', supplier: 'Granite Arms Distribution', po: 'PO-CHW-26-0112' },
  { at: '2026-07-22T08:15:00Z', by: 'logKAF', base: 'KAF', eq: 'POL-JP8', qty: 80000, unitCost: '0.95', supplier: 'Ridgeline Fuels Ltd.', po: 'PO-KAF-26-0118' },
  { at: '2026-08-03T11:45:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'VEH-JLTV', count: 2, unitCost: '245000.00', supplier: 'Harbor Fleet Services', po: 'PO-FTA-26-0131' },
  { at: '2026-08-05T09:00:00Z', by: 'logCHW', base: 'CHW', eq: 'AMM-9MM', qty: 20000, unitCost: '0.31', supplier: 'Northwind Defense Supply Co.', po: 'PO-CHW-26-0134' },
  { at: '2026-08-12T13:20:00Z', by: 'logKAF', base: 'KAF', eq: 'COM-PRC163', count: 10, unitCost: '7800.00', supplier: 'Summit Comms Systems', po: 'PO-KAF-26-0140' },
  { at: '2026-08-19T10:10:00Z', by: 'logFTA', base: 'FTA', eq: 'MED-IFAK', qty: 150, unitCost: '95.00', supplier: 'Caldera Medical Supply', po: 'PO-FTA-26-0146' },
  { at: '2026-08-26T14:00:00Z', by: 'logCHW', base: 'CHW', eq: 'COM-BA5590', qty: 200, unitCost: '145.00', supplier: 'Summit Comms Systems', po: 'PO-CHW-26-0153' },
  { at: '2026-09-02T09:40:00Z', by: 'logFTA', base: 'FTA', eq: 'AMM-762', qty: 30000, unitCost: '0.68', supplier: 'Northwind Defense Supply Co.', po: 'PO-FTA-26-0160' },
  { at: '2026-09-09T10:30:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'WPN-M4A1', count: 15, unitCost: '1150.00', supplier: 'Granite Arms Distribution', po: 'PO-KAF-26-0165' },
  { at: '2026-09-16T08:50:00Z', by: 'logCHW', base: 'CHW', eq: 'AMM-M67', qty: 100, unitCost: '48.50', supplier: 'Northwind Defense Supply Co.', po: 'PO-CHW-26-0171' },
  { at: '2026-09-23T15:05:00Z', by: 'logFTA', base: 'FTA', eq: 'MED-CAT', qty: 100, unitCost: '32.00', supplier: 'Caldera Medical Supply', po: 'PO-FTA-26-0178' },
  { at: '2026-09-25T09:15:00Z', by: 'logKAF', base: 'KAF', eq: 'AMM-556', qty: 30000, unitCost: '0.42', supplier: 'Northwind Defense Supply Co.', po: 'PO-KAF-26-0181' },
];

const TRANSFERS = [
  { at: '2026-07-10T07:30:00Z', by: 'logFTA', from: 'FTA', to: 'CHW', eq: 'AMM-556', qty: 20000, notes: 'Range allocation for Q3 qualification cycle.' },
  { at: '2026-07-18T08:00:00Z', by: 'cmdrFTA', from: 'FTA', to: 'KAF', eq: 'WPN-M4A1', count: 10, notes: 'Airfield security detachment reinforcement.' },
  { at: '2026-07-29T12:00:00Z', by: 'logKAF', from: 'KAF', to: 'CHW', eq: 'POL-JP8', qty: 25000, notes: 'Bulk fuel redistribution by tanker convoy.' },
  { at: '2026-08-07T06:45:00Z', by: 'cmdrFTA', from: 'FTA', to: 'CHW', eq: 'VEH-M1151', count: 2, notes: 'Motor pool rebalancing.' },
  { at: '2026-08-14T10:20:00Z', by: 'logCHW', from: 'CHW', to: 'KAF', eq: 'AMM-9MM', qty: 8000, notes: 'Sidearm qualification support.' },
  { at: '2026-08-28T09:00:00Z', by: 'logKAF', from: 'KAF', to: 'FTA', eq: 'COM-PRC163', count: 5, notes: 'Radio loan for field exercise NORTHERN LANTERN.' },
  { at: '2026-09-05T11:30:00Z', by: 'logCHW', from: 'CHW', to: 'FTA', eq: 'AMM-M67', qty: 50, notes: 'Replenishment after demolition range.' },
  { at: '2026-09-12T13:15:00Z', by: 'logFTA', from: 'FTA', to: 'KAF', eq: 'MED-IFAK', qty: 60, notes: 'Flight-line medical readiness.' },
  { at: '2026-09-20T07:50:00Z', by: 'cmdrCHW', from: 'CHW', to: 'KAF', eq: 'WPN-M4A1', count: 5, notes: 'Temporary duty weapons for airfield guard force.' },
  // Requested but not yet approved by the source commander.
  { at: '2026-09-27T10:00:00Z', by: 'logKAF', from: 'KAF', to: 'FTA', eq: 'POL-JP8', qty: 15000, notes: 'Fuel for exercise NORTHERN LANTERN phase 2.', status: 'PENDING' },
  // Raised in error and withdrawn before approval.
  { at: '2026-09-24T08:30:00Z', by: 'logFTA', from: 'FTA', to: 'CHW', eq: 'MED-CAT', qty: 40, notes: 'Duplicate of an earlier request.', status: 'CANCELLED', cancelReason: 'Raised in error: duplicate request.' },
];

const ASSIGNMENTS = [
  { key: 'a01', at: '2026-07-12T08:00:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'WPN-M4A1', assignee: 'Sgt. James Walker', serviceNo: 'DEV-P-20417', unit: '1st Platoon, A Company', purpose: 'Individual weapon issue', expectedReturn: '2026-08-31T00:00:00Z' },
  { key: 'a02', at: '2026-07-12T08:10:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'WPN-M17', assignee: 'Lt. Hannah Ortiz', serviceNo: 'DEV-P-20388', unit: 'A Company HQ', purpose: 'Officer sidearm issue' },
  { key: 'a03', at: '2026-07-20T06:30:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'AMM-556', qty: 2400, assignee: 'SSgt. Victor Alvarez', serviceNo: 'DEV-P-20502', unit: 'Range Detail, B Company', purpose: 'Rifle qualification range', expectedReturn: '2026-07-23T18:00:00Z' },
  { key: 'a04', at: '2026-08-02T07:00:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'VEH-M1151', assignee: 'Cpl. Aisha Rahman', serviceNo: 'DEV-P-30114', unit: 'Motor Pool, HHC', purpose: 'Perimeter patrol vehicle' },
  { key: 'a05', at: '2026-08-09T09:30:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'COM-PRC163', assignee: 'Sgt. Owen Fletcher', serviceNo: 'DEV-P-30187', unit: 'Signal Section', purpose: 'Field exercise communications', expectedReturn: '2026-09-01T00:00:00Z' },
  { key: 'a06', at: '2026-08-15T08:20:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'WPN-M17', assignee: 'Capt. Lena Fischer', serviceNo: 'DEV-P-40021', unit: 'Airfield Operations', purpose: 'Duty officer sidearm' },
  { key: 'a07', at: '2026-08-21T10:00:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'MED-IFAK', qty: 20, assignee: 'SSgt. Noor Haddad', serviceNo: 'DEV-P-40077', unit: 'Medic Section, Flight Line', purpose: 'Flight-line aid stations' },
  { key: 'a08', at: '2026-09-03T07:15:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'AMM-9MM', qty: 600, assignee: 'Sgt. Diego Santos', serviceNo: 'DEV-P-30240', unit: 'Military Police Platoon', purpose: 'Sidearm sustainment training', expectedReturn: '2026-10-15T00:00:00Z' },
  { key: 'a09', at: '2026-09-14T06:00:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'VEH-JLTV', assignee: 'SFC Grace Kim', serviceNo: 'DEV-P-20611', unit: 'Scout Platoon', purpose: 'Reconnaissance training rotation', expectedReturn: '2026-10-30T00:00:00Z' },
  { key: 'a10', at: '2026-09-18T08:45:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'COM-BA5590', qty: 40, assignee: 'SSgt. Mark Ellison', serviceNo: 'DEV-P-20655', unit: 'Signal Section', purpose: 'Radio power for field exercise' },
  { key: 'a11', at: '2026-09-22T07:30:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'WPN-M4A1', assignee: 'Sgt. Tyler Brooks', serviceNo: 'DEV-P-40103', unit: 'Airfield Guard Force', purpose: 'Guard force weapon issue' },
];

const RETURNS = [
  { at: '2026-07-23T17:30:00Z', by: 'cmdrFTA', assignment: 'a03', qty: 600, notes: 'Unused rounds returned to ammunition supply point.' },
  { at: '2026-08-20T15:00:00Z', by: 'cmdrFTA', assignment: 'a01', notes: 'Weapon returned after cleaning inspection.' },
  { at: '2026-09-01T16:00:00Z', by: 'cmdrCHW', assignment: 'a05', notes: 'Radio returned; minor antenna wear.' },
  { at: '2026-09-10T11:00:00Z', by: 'cmdrKAF', assignment: 'a07', qty: 5, notes: 'Surplus kits returned from aid station 3.' },
];

const EXPENDITURES = [
  { at: '2026-07-22T16:00:00Z', by: 'cmdrFTA', assignment: 'a03', qty: 1800, reason: 'TRAINING', notes: 'Rifle qualification, 45 firers.' },
  { at: '2026-07-25T15:30:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'AMM-556', qty: 5000, reason: 'TRAINING', notes: 'Company live-fire exercise.' },
  { at: '2026-08-06T18:00:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'POL-JP8', qty: 18000, reason: 'OPERATION', notes: 'Aircraft and ground support refuelling, week 32.' },
  { at: '2026-08-11T14:10:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'AMM-M67', qty: 40, reason: 'TRAINING', notes: 'Live grenade range.' },
  { at: '2026-08-18T16:45:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'AMM-762', qty: 3000, reason: 'TRAINING', notes: 'Machine gun gunnery table.' },
  { at: '2026-08-24T19:00:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'POL-JP8', qty: 12000, reason: 'OPERATION', notes: 'Convoy operations and generator fuel.' },
  { at: '2026-08-30T13:00:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'AMM-9MM', qty: 2500, reason: 'TRAINING', notes: 'Sidearm qualification.' },
  { at: '2026-09-04T10:30:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'VEH-M1151', reason: 'DAMAGED', notes: 'Rollover during convoy training; vehicle declared beyond economic repair.' },
  { at: '2026-09-11T17:20:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'MED-IFAK', qty: 18, reason: 'OPERATION', notes: 'Used during vehicle accident response.' },
  { at: '2026-09-17T15:00:00Z', by: 'cmdrFTA', base: 'FTA', eq: 'MED-CAT', qty: 15, reason: 'TRAINING', notes: 'Combat lifesaver course (training-use tourniquets).' },
  { at: '2026-09-26T12:00:00Z', by: 'cmdrFTA', assignment: 'a10', qty: 12, reason: 'OPERATION', notes: 'Batteries depleted during field exercise.' },
  { at: '2026-09-27T18:30:00Z', by: 'cmdrKAF', base: 'KAF', eq: 'POL-JP8', qty: 22000, reason: 'OPERATION', notes: 'Aircraft refuelling, week 39.' },
  { at: '2026-09-28T09:00:00Z', by: 'cmdrCHW', base: 'CHW', eq: 'WPN-M4A1', reason: 'LOST', notes: 'Lost during river-crossing exercise; investigation opened.' },
];

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the development seed with NODE_ENV=production.');
  }
  if ((await prisma.user.count()) > 0) {
    throw new Error('Database is not empty. Use `npx prisma migrate reset` to rebuild it with seed data.');
  }

  const roles = await seedRoles();
  const bases = await seedBases();
  const users = await seedUsers(roles, bases);
  const equipment = await seedCatalog();

  const serials = serialGenerator();
  const actor = (key) => ({ id: users[key].id, email: users[key].email, role: users[key].role });
  const admin = actor('admin');

  // Opening stock (admin adjustments)
  for (const [baseCode, items] of Object.entries(OPENING_STOCK)) {
    for (const [eqCode, qty] of Object.entries(items)) {
      const eq = equipment[eqCode];
      await postStockAdjustment(
        admin,
        {
          baseId: bases[baseCode].id,
          equipmentId: eq.id,
          reason: 'OPENING_STOCK',
          occurredAt: OPENING_DATE,
          notes: 'Opening balance at system go-live (development data).',
          ...(eq.trackingType === 'SERIALIZED' ? { serialNumbers: serials.next(eq, qty) } : { quantityDelta: qty }),
        },
        CONTEXT,
      );
    }
  }

  // Build one chronological event stream so every operation sees the stock
  // exactly as it was on that date.
  const assignmentIds = {};
  const events = [
    ...PURCHASES.map((p) => ({
      at: p.at,
      run: () => {
        const eq = equipment[p.eq];
        return postPurchase(actor(p.by), {
          baseId: bases[p.base].id,
          equipmentId: eq.id,
          ...(p.count ? { serialNumbers: serials.next(eq, p.count) } : { quantity: p.qty }),
          unitCost: p.unitCost,
          supplierName: p.supplier,
          purchaseOrderNo: p.po,
          purchasedAt: p.at,
        }, CONTEXT);
      },
    })),
    ...TRANSFERS.map((t) => ({
      at: t.at,
      run: async () => {
        const eq = equipment[t.eq];
        const serialized = eq.trackingType === 'SERIALIZED';
        const transfer = await createTransfer(actor(t.by), {
          sourceBaseId: bases[t.from].id,
          destinationBaseId: bases[t.to].id,
          equipmentId: eq.id,
          ...(serialized ? { assetIds: await pickAvailableAssets(eq.id, bases[t.from].id, t.count) } : { quantity: t.qty }),
          notes: t.notes,
          createdAt: t.at,
        }, CONTEXT);
        if (t.status === 'PENDING') return transfer;
        if (t.status === 'CANCELLED') {
          return cancelTransfer(actor(t.by), { transferId: transfer.id, reason: t.cancelReason }, CONTEXT);
        }
        return completeTransfer(actor(`cmdr${t.from}`), { transferId: transfer.id, completedAt: t.at }, CONTEXT);
      },
    })),
    ...ASSIGNMENTS.map((a) => ({
      at: a.at,
      run: async () => {
        const eq = equipment[a.eq];
        const serialized = eq.trackingType === 'SERIALIZED';
        const created = await createAssignment(actor(a.by), {
          baseId: bases[a.base].id,
          equipmentId: eq.id,
          ...(serialized ? { assetId: (await pickAvailableAssets(eq.id, bases[a.base].id, 1))[0] } : { quantity: a.qty }),
          assigneeName: a.assignee,
          assigneeServiceNo: a.serviceNo,
          assigneeUnit: a.unit,
          purpose: a.purpose,
          assignedAt: a.at,
          expectedReturnAt: a.expectedReturn,
        }, CONTEXT);
        assignmentIds[a.key] = created.id;
      },
    })),
    ...RETURNS.map((r) => ({
      at: r.at,
      run: () =>
        returnAssignment(actor(r.by), {
          assignmentId: assignmentIds[r.assignment],
          quantity: r.qty,
          returnedAt: r.at,
          notes: r.notes,
        }, CONTEXT),
    })),
    ...EXPENDITURES.map((e) => ({
      at: e.at,
      run: async () => {
        if (e.assignment) {
          return postExpenditure(actor(e.by), {
            assignmentId: assignmentIds[e.assignment],
            quantity: e.qty,
            reason: e.reason,
            expendedAt: e.at,
            notes: e.notes,
          }, CONTEXT);
        }
        const eq = equipment[e.eq];
        const serialized = eq.trackingType === 'SERIALIZED';
        return postExpenditure(actor(e.by), {
          baseId: bases[e.base].id,
          equipmentId: eq.id,
          ...(serialized ? { assetId: (await pickAvailableAssets(eq.id, bases[e.base].id, 1))[0] } : { quantity: e.qty }),
          reason: e.reason,
          expendedAt: e.at,
          notes: e.notes,
        }, CONTEXT);
      },
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  for (const event of events) await event.run();

  await recordAudit(prisma, {
    actor: null,
    action: 'DEV_SEED_COMPLETED',
    entityType: 'System',
    metadata: { environment: env.NODE_ENV, note: 'Development seed data; all records are fictional.' },
    context: CONTEXT,
  });

  const discrepancies = await findInventoryDiscrepancies(prisma);
  if (discrepancies.length) {
    console.error(discrepancies);
    throw new Error(`Seed produced ${discrepancies.length} inventory discrepancies`);
  }

  await printSummary();
}

// ─────────────────────────────────────────────────────────────────────────────

async function seedRoles() {
  const roles = {};
  for (const role of ROLES) roles[role.code] = await prisma.role.create({ data: role });
  return roles;
}

async function seedBases() {
  const bases = {};
  for (const base of BASES) bases[base.code] = await prisma.base.create({ data: base });
  return bases;
}

async function seedUsers(roles, bases) {
  const users = {};
  for (const u of USERS) {
    const user = await prisma.user.create({
      data: {
        email: u.email,
        fullName: u.fullName,
        serviceNumber: u.serviceNumber,
        passwordHash: await hashPassword(DEV_PASSWORD),
        roleId: roles[u.role].id,
        baseId: u.base ? bases[u.base].id : null,
        isActive: u.isActive ?? true,
        passwordChangedAt: new Date(),
      },
    });
    users[u.key] = { ...user, role: u.role };
  }
  return users;
}

async function seedCatalog() {
  const types = {};
  for (const t of EQUIPMENT_TYPES) types[t.code] = await prisma.equipmentType.create({ data: t });

  const equipment = {};
  for (const { type, ...e } of EQUIPMENT) {
    equipment[e.code] = await prisma.equipment.create({ data: { ...e, equipmentTypeId: types[type].id } });
  }
  return equipment;
}

/** Fictional serials, unique per equipment item: e.g. M4A1-DEV-000001. */
function serialGenerator() {
  const counters = {};
  return {
    next(equipment, count) {
      const stem = equipment.code.split('-')[1];
      return Array.from({ length: count }, () => {
        counters[stem] = (counters[stem] ?? 0) + 1;
        return `${stem}-DEV-${String(counters[stem]).padStart(6, '0')}`;
      });
    },
  };
}

async function pickAvailableAssets(equipmentId, baseId, count) {
  const assets = await prisma.asset.findMany({
    where: { equipmentId, currentBaseId: baseId, status: 'AVAILABLE' },
    orderBy: { serialNumber: 'asc' },
    take: count,
    select: { id: true },
  });
  if (assets.length < count) throw new Error(`Seed data error: only ${assets.length} available assets (needed ${count})`);
  return assets.map((a) => a.id);
}

async function printSummary() {
  const [movements, purchases, transfers, assignments, expenditures, assets, audit] = await Promise.all([
    prisma.inventoryMovement.count(),
    prisma.purchase.count(),
    prisma.transfer.count(),
    prisma.assignment.count(),
    prisma.expenditure.count(),
    prisma.asset.count(),
    prisma.auditLog.count(),
  ]);
  console.log('\nDevelopment seed complete.');
  console.table({ purchases, transfers, assignments, expenditures, serializedAssets: assets, ledgerRows: movements, auditLogs: audit });
  console.log('\n⚠  DEVELOPMENT CREDENTIALS ONLY — never use these outside local development.');
  console.log(`   Password for every seeded account: ${process.env.SEED_DEV_PASSWORD ? '(value of SEED_DEV_PASSWORD)' : DEV_PASSWORD}`);
  console.table(USERS.map((u) => ({ email: u.email, role: u.role, base: u.base ?? 'ALL', active: u.isActive ?? true })));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
