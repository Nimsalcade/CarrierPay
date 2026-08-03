/**
 * Zod request/response schemas shared by the API (validation) and web (forms).
 * PRD §15.1 field validation rules are enforced here.
 */
import { z } from 'zod';
import {
  EquipmentStatus,
  EquipmentType,
  LoadStatus,
  ManualItemStatus,
  RecurringItemType,
  RecurringSchedule,
  RuleComponentType,
  UserRole,
  UserStatus,
} from '../constants/enums.js';

const id = z.string().min(1).max(64);
const cents = z.number().int().safe();
const bps = z.number().int().min(0).max(10000);

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

export const userCreateSchema = z.object({
  role: z.enum(Object.values(UserRole) as [string, ...string[]]),
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  email: z.string().trim().email('Valid email required').toLowerCase().optional().or(z.literal('')),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/, 'Username may contain letters, numbers, _ . -').optional().or(z.literal('')),
  employeeCode: z.string().trim().min(1, 'Employee code required').max(20).regex(/^[A-Za-z0-9-]+$/, 'Employee code: letters, numbers, hyphen'),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  temporaryPassword: z.string().min(12, 'Temporary password must be at least 12 characters'),
  driverType: z.enum(['CONTRACTOR', 'EMPLOYEE', 'OTHER']).optional(),
  address: z.string().max(200).optional().or(z.literal('')),
});

export const userUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().toLowerCase().optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  driverType: z.enum(['CONTRACTOR', 'EMPLOYEE', 'OTHER']).optional(),
  address: z.string().max(200).optional().or(z.literal('')),
});

export const userStatusSchema = z.object({
  status: z.enum(Object.values(UserStatus) as [string, ...string[]]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});

export const resetPasswordSchema = z.object({
  newTemporaryPassword: z.string().min(12, 'Temporary password must be at least 12 characters'),
});

export const equipmentCreateSchema = z.object({
  type: z.enum(Object.values(EquipmentType) as [string, ...string[]]),
  unitNumber: z.string().trim().min(1).max(30),
  vin: z.string().trim().max(30).optional().or(z.literal('')),
  year: z.number().int().min(1950).max(2100).optional().or(z.null()),
  make: z.string().trim().max(50).optional().or(z.literal('')),
  model: z.string().trim().max(50).optional().or(z.literal('')),
  plate: z.string().trim().max(20).optional().or(z.literal('')),
  plateState: z.string().trim().max(2).optional().or(z.literal('')),
  odometerMiles: z.number().int().min(0).optional().or(z.null()),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const equipmentUpdateSchema = equipmentCreateSchema.partial().extend({
  status: z.enum(Object.values(EquipmentStatus) as [string, ...string[]]).optional(),
});

export const equipmentAssignSchema = z.object({
  driverUserId: id,
  assignedAt: z.string().optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
  overrideReason: z.string().max(500).optional().or(z.literal('')),
});

export const equipmentReturnSchema = z.object({
  returnedAt: z.string().optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
});

export const loadCreateSchema = z.object({
  loadNumber: z.string().trim().min(1).max(40),
  bookedByUserId: id,
  driverUserId: id,
  truckId: id.nullable().optional(),
  trailerId: id.nullable().optional(),
  customerName: z.string().trim().min(1).max(120),
  confirmationNumber: z.string().trim().max(40).optional().or(z.literal('')),
  originFacility: z.string().trim().min(1).max(120),
  originCity: z.string().trim().max(80).optional().or(z.literal('')),
  originState: z.string().trim().max(2).optional().or(z.literal('')),
  originZip: z.string().trim().max(10).optional().or(z.literal('')),
  pickupAt: z.string().optional(),
  destinationFacility: z.string().trim().min(1).max(120),
  destinationCity: z.string().trim().max(80).optional().or(z.literal('')),
  destinationState: z.string().trim().max(2).optional().or(z.literal('')),
  destinationZip: z.string().trim().max(10).optional().or(z.literal('')),
  deliveryAt: z.string().optional(),
  grossRateCents: cents,
  accessorialGrossCents: cents.optional(),
  loadedMilesHundredths: z.number().int().min(0),
  emptyMilesHundredths: z.number().int().min(0).default(0),
  status: z.enum([LoadStatus.DRAFT, LoadStatus.BOOKED, LoadStatus.ASSIGNED] as const).optional(),
  internalNotes: z.string().max(2000).optional().or(z.literal('')),
  driverInstructions: z.string().max(2000).optional().or(z.literal('')),
});

export const loadUpdateSchema = loadCreateSchema.partial();

export const loadStatusSchema = z.object({
  status: z.enum(Object.values(LoadStatus) as [string, ...string[]]),
  reason: z.string().trim().max(500).optional().or(z.literal('')),
});

export const ruleComponentSchema = z.object({
  componentType: z.enum(Object.values(RuleComponentType) as [string, ...string[]]),
  calculationMethod: z.string().min(1),
  displayLabel: z.string().trim().max(80).optional().or(z.literal('')),
  amountCents: cents.optional(),
  rateBasisPoints: bps.optional(),
  centsPerMile: z.number().int().min(0).optional(),
  thresholdCents: cents.optional(),
  sequence: z.number().int().min(0).optional(),
});

export const payRuleSetCreateSchema = z.object({
  userId: id,
  role: z.enum(Object.values(UserRole) as [string, ...string[]]).optional(),
  name: z.string().trim().min(1).max(120),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(500).optional().or(z.literal('')),
  components: z.array(ruleComponentSchema).min(1, 'At least one component required'),
});

export const payRulePreviewSchema = z.object({
  role: z.enum(Object.values(UserRole) as [string, ...string[]]),
  components: z.array(ruleComponentSchema).min(1),
  sampleGrossCents: cents.default(100000),
  sampleMilesHundredths: z.number().int().min(0).default(10000),
  sampleLoadedMilesHundredths: z.number().int().min(0).default(8000),
});

export const recurringItemCreateSchema = z.object({
  userId: id,
  itemType: z.enum(Object.values(RecurringItemType) as [string, ...string[]]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  amountCents: z.number().int().positive('Amount must be greater than zero'),
  recurrence: z.enum(Object.values(RecurringSchedule) as [string, ...string[]]),
  intervalCount: z.number().int().min(1).default(1),
  dayOfMonth: z.number().int().min(1).max(31).optional().or(z.null()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  maxOccurrences: z.number().int().min(1).nullable().optional(),
  applyWhenNoEarnings: z.boolean().default(false),
  quantity: z.number().int().positive().optional().or(z.null()),
});

export const recurringItemUpdateSchema = recurringItemCreateSchema.partial();

export const manualPayItemSchema = z.object({
  userId: id,
  payPeriodId: id,
  itemType: z.enum(Object.values(RecurringItemType) as [string, ...string[]]),
  amountCents: cents,
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().optional().or(z.null()),
  status: z.enum(Object.values(ManualItemStatus) as [string, ...string[]]).optional(),
});

export const payrollAdjustmentSchema = z.object({
  payPeriodId: id,
  amountCents: cents,
  itemType: z.enum(Object.values(RecurringItemType) as [string, ...string[]]).or(z.literal('MANUAL_ADJUSTMENT')),
  description: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  quantity: z.number().int().positive().optional().or(z.null()),
});

export const approvalSchema = z.object({
  comments: z.string().trim().max(1000).optional().or(z.literal('')),
});

export const generatePaystubsSchema = z.object({
  entryIds: z.array(id).optional(),
});

export const markPaidSchema = z.object({
  paidDate: z.string().optional(),
  method: z.string().trim().max(50).optional().or(z.literal('')),
  reference: z.string().trim().max(100).optional().or(z.literal('')),
  note: z.string().max(500).optional().or(z.literal('')),
});

export const companySettingsSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name required').max(120),
  legalName: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().max(120).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(2).optional().or(z.literal('')),
  zip: z.string().trim().max(10).optional().or(z.literal('')),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  timezone: z.string().min(1),
  weekStartDay: z.number().int().min(0).max(6).default(6),
  payrollTriggerCron: z.string().regex(/^(\S+ ){4}\S+$/, 'Valid cron expression required').optional(),
  goLiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  settlementPrefix: z.string().trim().min(1).max(10).default('ST-'),
  settlementPadding: z.number().int().min(3).max(10).default(5),
  batchPrefix: z.string().trim().min(1).max(10).default('SB-'),
  batchPadding: z.number().int().min(2).max(10).default(3),
  separateReimbursements: z.boolean().default(false),
  createZeroPayEntries: z.boolean().default(false),
  prorateAssistantPay: z.boolean().default(false),
});

export const setupSchema = z.object({
  company: companySettingsSchema,
  admin: z.object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    email: z.string().trim().email().toLowerCase(),
    username: z.string().trim().min(3).max(40),
    employeeCode: z.string().trim().min(1).max(20),
    password: z.string().min(12, 'Password must be at least 12 characters'),
  }),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().optional(),
  q: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type LoadCreateInput = z.infer<typeof loadCreateSchema>;
export type PayRuleSetCreateInput = z.infer<typeof payRuleSetCreateSchema>;
export type RecurringItemCreateInput = z.infer<typeof recurringItemCreateSchema>;
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;
export type SetupInput = z.infer<typeof setupSchema>;
