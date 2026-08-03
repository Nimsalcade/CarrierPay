/** Enums and state transitions (PRD Appendix A). */

export const UserRole = {
  SUPER_ACCOUNT_MANAGER: 'SUPER_ACCOUNT_MANAGER',
  ASSISTANT_ACCOUNT_MANAGER: 'ASSISTANT_ACCOUNT_MANAGER',
  DISPATCHER: 'DISPATCHER',
  DRIVER: 'DRIVER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const USER_ROLES: UserRole[] = Object.values(UserRole);

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  TERMINATED: 'TERMINATED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const EquipmentType = {
  TRUCK: 'TRUCK',
  TRAILER: 'TRAILER',
  OTHER: 'OTHER',
} as const;
export type EquipmentType = (typeof EquipmentType)[keyof typeof EquipmentType];

export const EquipmentStatus = {
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
  RETIRED: 'RETIRED',
} as const;
export type EquipmentStatus = (typeof EquipmentStatus)[keyof typeof EquipmentStatus];

export const LoadStatus = {
  DRAFT: 'DRAFT',
  BOOKED: 'BOOKED',
  ASSIGNED: 'ASSIGNED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  PAYROLL_LOCKED: 'PAYROLL_LOCKED',
} as const;
export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus];
export const LOAD_STATUSES: LoadStatus[] = Object.values(LoadStatus);

/** Allowed load state transitions per PRD Appendix A. */
export const LOAD_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  DRAFT: ['BOOKED', 'CANCELLED'],
  BOOKED: ['ASSIGNED', 'CANCELLED', 'DRAFT'],
  ASSIGNED: ['IN_TRANSIT', 'BOOKED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'ASSIGNED', 'CANCELLED'],
  DELIVERED: ['PAYROLL_LOCKED'],
  PAYROLL_LOCKED: [],
  CANCELLED: ['DRAFT'],
};

export const PayPeriodStatus = {
  DRAFT: 'DRAFT',
  CALCULATING: 'CALCULATING',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  GENERATING: 'GENERATING',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  VOID: 'VOID',
} as const;
export type PayPeriodStatus = (typeof PayPeriodStatus)[keyof typeof PayPeriodStatus];

export const PayrollEntryStatus = {
  CALCULATED: 'CALCULATED',
  STALE: 'STALE',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  SUPERSEDED: 'SUPERSEDED',
  VOID: 'VOID',
} as const;
export type PayrollEntryStatus = (typeof PayrollEntryStatus)[keyof typeof PayrollEntryStatus];

export const PayrollCategory = {
  EARNING: 'EARNING',
  OTHER_PAY: 'OTHER_PAY',
  REIMBURSEMENT: 'REIMBURSEMENT',
  ADVANCE: 'ADVANCE',
  DEDUCTION: 'DEDUCTION',
  MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
  GUARANTEE_TOP_UP: 'GUARANTEE_TOP_UP',
} as const;
export type PayrollCategory = (typeof PayrollCategory)[keyof typeof PayrollCategory];

export const RecurringSchedule = {
  EVERY_PAY_PERIOD: 'EVERY_PAY_PERIOD',
  WEEKLY: 'WEEKLY',
  BIWEEKLY: 'BIWEEKLY',
  MONTHLY: 'MONTHLY',
  FIXED_OCCURRENCES: 'FIXED_OCCURRENCES',
} as const;
export type RecurringSchedule = (typeof RecurringSchedule)[keyof typeof RecurringSchedule];

export const RecurringItemType = {
  DEDUCTION: 'DEDUCTION',
  REIMBURSEMENT: 'REIMBURSEMENT',
  ADVANCE: 'ADVANCE',
  OTHER_PAY: 'OTHER_PAY',
} as const;
export type RecurringItemType = (typeof RecurringItemType)[keyof typeof RecurringItemType];

export const PayrollLineSourceType = {
  LOAD: 'LOAD',
  RECURRING_ITEM: 'RECURRING_ITEM',
  MANUAL_ITEM: 'MANUAL_ITEM',
  GUARANTEE: 'GUARANTEE',
  OVERRIDE: 'OVERRIDE',
  /** Flat weekly / per-driver base components applied from a pay rule set. */
  RULE_COMPONENT: 'RULE_COMPONENT',
} as const;
export type PayrollLineSourceType = (typeof PayrollLineSourceType)[keyof typeof PayrollLineSourceType];

export const ValidationFlag = {
  MISSING_PAY_RULE: 'MISSING_PAY_RULE',
  MISSING_LOAD_RATE: 'MISSING_LOAD_RATE',
  MISSING_MILEAGE: 'MISSING_MILEAGE',
  DUPLICATE_SOURCE: 'DUPLICATE_SOURCE',
  NEGATIVE_NET: 'NEGATIVE_NET',
  ZERO_NET: 'ZERO_NET',
  STALE_ENTRY: 'STALE_ENTRY',
  EQUIPMENT_CONFLICT: 'EQUIPMENT_CONFLICT',
} as const;
export type ValidationFlag = (typeof ValidationFlag)[keyof typeof ValidationFlag];
export const VALIDATION_FLAG_BLOCKS_APPROVAL: ReadonlySet<ValidationFlag> = new Set([
  ValidationFlag.MISSING_PAY_RULE,
  ValidationFlag.MISSING_LOAD_RATE,
  ValidationFlag.MISSING_MILEAGE,
  ValidationFlag.DUPLICATE_SOURCE,
  ValidationFlag.STALE_ENTRY,
]);

export const RuleComponentType = {
  LOAD_EARNING: 'LOAD_EARNING',
  LOAD_COMMISSION: 'LOAD_COMMISSION',
  WEEKLY_BASE: 'WEEKLY_BASE',
  ACTIVE_DRIVER_BONUS: 'ACTIVE_DRIVER_BONUS',
  PAYROLL_EARNINGS_PERCENT: 'PAYROLL_EARNINGS_PERCENT',
  MINIMUM_WEEKLY_GUARANTEE: 'MINIMUM_WEEKLY_GUARANTEE',
  TIERED_COMMISSION: 'TIERED_COMMISSION',
  ROLE_BONUS: 'ROLE_BONUS',
} as const;
export type RuleComponentType = (typeof RuleComponentType)[keyof typeof RuleComponentType];

export const CalculationMethod = {
  PERCENT_OF_LOAD_GROSS: 'PERCENT_OF_LOAD_GROSS',
  FIXED_PER_LOAD: 'FIXED_PER_LOAD',
  CENTS_PER_LOADED_MILE: 'CENTS_PER_LOADED_MILE',
  CENTS_PER_TOTAL_MILE: 'CENTS_PER_TOTAL_MILE',
  FLAT_WEEKLY: 'FLAT_WEEKLY',
  PERCENT_OF_BOOKED_LOAD_GROSS: 'PERCENT_OF_BOOKED_LOAD_GROSS',
  PERCENT_OF_PAYROLL_EARNINGS: 'PERCENT_OF_PAYROLL_EARNINGS',
  FIXED_PER_ACTIVE_DRIVER: 'FIXED_PER_ACTIVE_DRIVER',
  TIERED_MARGINAL: 'TIERED_MARGINAL',
  TIERED_WHOLE_PERIOD: 'TIERED_WHOLE_PERIOD',
  MANUAL_BONUS: 'MANUAL_BONUS',
} as const;
export type CalculationMethod = (typeof CalculationMethod)[keyof typeof CalculationMethod];

export const ManualItemStatus = {
  PROPOSED: 'PROPOSED',
  APPROVED_FOR_CALCULATION: 'APPROVED_FOR_CALCULATION',
  REJECTED: 'REJECTED',
} as const;
export type ManualItemStatus = (typeof ManualItemStatus)[keyof typeof ManualItemStatus];

export const NotificationType = {
  PAYROLL_READY: 'PAYROLL_READY',
  PAYROLL_RECALC_FAILED: 'PAYROLL_RECALC_FAILED',
  PAYSTUB_PUBLISHED: 'PAYSTUB_PUBLISHED',
  PAYSTUB_REVISED: 'PAYSTUB_REVISED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  LOAD_ASSIGNED: 'LOAD_ASSIGNED',
  EQUIPMENT_ASSIGNMENT_CHANGED: 'EQUIPMENT_ASSIGNMENT_CHANGED',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const PAYROLL_CALCULATOR_VERSION = '1.0.0';

/** Settlement number prefix default + batch prefix default (PRD §8.7). */
export const DEFAULT_SETTLEMENT_PREFIX = 'ST-';
export const DEFAULT_BATCH_PREFIX = 'SB-';
