/** Shared API payload types. */
import type {
  LoadStatus,
  PayPeriodStatus,
  PayrollCategory,
  PayrollEntryStatus,
  RecurringItemType,
  UserRole,
  UserStatus,
  ValidationFlag,
} from '../constants/enums.js';

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MeResponse {
  id: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  employeeCode: string;
  status: UserStatus;
  mustChangePassword: boolean;
  permissions: string[];
  activeRuleSummary: ActiveRuleSummary | null;
  unreadCount: number;
  company: { id: string; companyName: string; timezone: string } | null;
}

export interface ActiveRuleSummary {
  ruleSetId: string;
  name: string;
  effectiveFrom: string;
  components: string[];
}

export interface LoadSummary {
  id: string;
  loadNumber: string;
  status: LoadStatus;
  customerName: string;
  originFacility: string;
  originCity: string;
  originState: string;
  destinationFacility: string;
  destinationCity: string;
  destinationState: string;
  pickupAt: string | null;
  deliveryAt: string | null;
  grossRateCents: number;
  loadedMilesHundredths: number;
  emptyMilesHundredths: number;
  driverUserId: string | null;
  bookedByUserId: string;
  truckId: string | null;
  trailerId: string | null;
}

export interface PayrollEntryTotals {
  grossRevenueCents: number;
  earningsCents: number;
  otherPayCents: number;
  reimbursementsCents: number;
  advancesCents: number;
  deductionsCents: number;
  netPayCents: number;
}

export interface PayrollLineItem {
  id: string;
  category: PayrollCategory;
  sourceType: string;
  sourceId: string | null;
  description: string;
  amountCents: number;
  ruleSetId: string | null;
  ruleComponentId: string | null;
  calculationJson: unknown;
  originalAmountCents: number | null;
  overrideReason: string | null;
}

export interface PayrollEntry {
  id: string;
  payPeriodId: string;
  userId: string;
  role: UserRole;
  totals: PayrollEntryTotals;
  status: PayrollEntryStatus;
  validationFlags: ValidationFlag[];
  lineItems: PayrollLineItem[];
  ytdPreview: PayrollEntryTotals | null;
}

export interface PayPeriodSummary {
  id: string;
  startAt: string;
  endAt: string;
  status: PayPeriodStatus;
  peopleCount: number;
  grossRevenueCents: number;
  earningsCents: number;
  additionsCents: number;
  subtractionsCents: number;
  netPayCents: number;
  validationFlags: ValidationFlag[];
}

export interface RecurringItem {
  id: string;
  userId: string;
  itemType: RecurringItemType;
  name: string;
  description: string;
  amountCents: number;
  recurrence: string;
  intervalCount: number;
  dayOfMonth: number | null;
  startDate: string;
  endDate: string | null;
  maxOccurrences: number | null;
  applyWhenNoEarnings: boolean;
  active: boolean;
  quantity: number | null;
}

export interface DashboardData {
  currentPeriod: PayPeriodSummary | null;
  deliveredLoads: number;
  inTransitLoads: number;
  unassignedLoads: number;
  grossRevenueCents: number;
  activeDrivers: number;
  activeDispatchers: number;
  activeAssistants: number;
  suspendedAccounts: number;
  availableEquipment: number;
  assignedEquipment: number;
  outOfServiceEquipment: number;
  assignmentConflicts: number;
  publishedNetPayCents: number;
  unpaidPaystubs: number;
  missingPayRules: number;
  negativeNetEntries: number;
  staleEntries: number;
}
