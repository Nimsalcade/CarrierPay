/**
 * Role permission rules (PRD §4.2 permission matrix).
 */
import { UserRole } from '@carrierpay/shared';

export const PERMISSIONS: Record<UserRole, string[]> = {
  SUPER_ACCOUNT_MANAGER: [
    'company.settings.manage',
    'users.manage',
    'users.create_staff',
    'equipment.manage',
    'loads.manage',
    'loads.view_all',
    'pay-rules.manage',
    'recurring.manage',
    'payroll.run',
    'payroll.adjust',
    'payroll.approve',
    'paystubs.manage',
    'paystubs.view_all',
    'payments.mark_paid',
    'audit.view_all',
    'settings.manage',
    'payroll.generate',
    'payroll.publish',
  ],
  ASSISTANT_ACCOUNT_MANAGER: [
    'users.create_drivers',
    'equipment.manage',
    'loads.view_all',
    'pay-rules.manage_drivers',
    'recurring.manage_drivers',
    'payroll.view',
    'payroll.prepare_notes',
    'payroll.propose_adjustment',
    'paystubs.view_all',
    'audit.view_own',
  ],
  DISPATCHER: [
    'loads.create',
    'loads.view_own_booked',
    'payroll.view_own_estimate',
    'paystubs.view_own',
    'audit.view_own',
  ],
  DRIVER: ['loads.view_own', 'equipment.view_assigned', 'payroll.view_own', 'paystubs.view_own', 'audit.view_own'],
};

export function permissionsFor(role: UserRole): string[] {
  return PERMISSIONS[role] ?? [];
}

export function hasPermission(role: UserRole, permission: string): boolean {
  return permissionsFor(role).includes(permission);
}
