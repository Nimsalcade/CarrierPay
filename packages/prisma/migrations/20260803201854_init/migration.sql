-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyName" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "logoPath" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "weekStartDay" INTEGER NOT NULL DEFAULT 6,
    "payrollTriggerCron" TEXT NOT NULL DEFAULT '0 0 * * 6',
    "goLiveDate" DATETIME,
    "settlementPrefix" TEXT NOT NULL DEFAULT 'ST-',
    "settlementPadding" INTEGER NOT NULL DEFAULT 5,
    "batchPrefix" TEXT NOT NULL DEFAULT 'SB-',
    "batchPadding" INTEGER NOT NULL DEFAULT 3,
    "separateReimbursements" BOOLEAN NOT NULL DEFAULT false,
    "createZeroPayEntries" BOOLEAN NOT NULL DEFAULT false,
    "prorateAssistantPay" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "username" TEXT,
    "employeeCode" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "driverType" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "hireDate" DATETIME,
    "terminationDate" DATETIME,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfTokenHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME,
    "ipSummary" TEXT,
    "userAgentSummary" TEXT,
    "revokedAt" DATETIME,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "vin" TEXT,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "plate" TEXT,
    "plateState" TEXT,
    "odometerMiles" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EquipmentAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "equipmentId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL,
    "returnedAt" DATETIME,
    "assignedBy" TEXT,
    "notes" TEXT,
    "overrideReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EquipmentAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EquipmentAssignment_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loadNumber" TEXT NOT NULL,
    "bookedByUserId" TEXT NOT NULL,
    "driverUserId" TEXT,
    "truckId" TEXT,
    "trailerId" TEXT,
    "customerName" TEXT NOT NULL,
    "confirmationNumber" TEXT,
    "originFacility" TEXT NOT NULL,
    "originCity" TEXT,
    "originState" TEXT,
    "originZip" TEXT,
    "pickupAt" DATETIME,
    "destinationFacility" TEXT NOT NULL,
    "destinationCity" TEXT,
    "destinationState" TEXT,
    "destinationZip" TEXT,
    "deliveryAt" DATETIME,
    "grossRateCents" INTEGER NOT NULL,
    "accessorialGrossCents" INTEGER,
    "loadedMilesHundredths" INTEGER NOT NULL,
    "emptyMilesHundredths" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "internalNotes" TEXT,
    "driverInstructions" TEXT,
    "payrollLockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Load_bookedByUserId_fkey" FOREIGN KEY ("bookedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Load_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Load_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Equipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Load_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Equipment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoadStatusHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "loadId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoadStatusHistory_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoadStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayRuleSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "effectiveTo" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayRuleSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayRuleComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleSetId" TEXT NOT NULL,
    "componentType" TEXT NOT NULL,
    "calculationMethod" TEXT NOT NULL,
    "displayLabel" TEXT,
    "amountCents" INTEGER,
    "rateBasisPoints" INTEGER,
    "centsPerMile" INTEGER,
    "thresholdCents" INTEGER,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PayRuleComponent_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PayRuleSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "amountCents" INTEGER NOT NULL,
    "recurrence" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "maxOccurrences" INTEGER,
    "applyWhenNoEarnings" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualPayItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'APPROVED_FOR_CALCULATION',
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualPayItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ManualPayItem_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL,
    "schedulerKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "calculationStartedAt" DATETIME,
    "calculatedAt" DATETIME,
    "approvedAt" DATETIME,
    "publishedAt" DATETIME,
    "calculatorVersion" TEXT,
    "totalsHash" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payPeriodId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grossRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "earningsCents" INTEGER NOT NULL DEFAULT 0,
    "otherPayCents" INTEGER NOT NULL DEFAULT 0,
    "reimbursementsCents" INTEGER NOT NULL DEFAULT 0,
    "advancesCents" INTEGER NOT NULL DEFAULT 0,
    "deductionsCents" INTEGER NOT NULL DEFAULT 0,
    "netPayCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "validationJson" TEXT NOT NULL DEFAULT '[]',
    "calculationHash" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollEntry_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollEntryId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "ruleSetId" TEXT,
    "ruleComponentId" TEXT,
    "calculationJson" TEXT,
    "originalAmountCents" INTEGER,
    "overrideReason" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollLineItem_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollLineItem_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "PayRuleSet" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PayrollLineItem_ruleComponentId_fkey" FOREIGN KEY ("ruleComponentId") REFERENCES "PayRuleComponent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringItemOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recurringItemId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "payrollLineItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecurringItemOccurrence_recurringItemId_fkey" FOREIGN KEY ("recurringItemId") REFERENCES "RecurringItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringItemOccurrence_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payPeriodId" TEXT NOT NULL,
    "entryId" TEXT,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "totalsHash" TEXT,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayrollApproval_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollApproval_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Paystub" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payrollEntryId" TEXT NOT NULL,
    "settlementNumber" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "generatedAt" DATETIME,
    "publishedAt" DATETIME,
    "generatorId" TEXT,
    "supersedesPaystubId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Paystub_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "PayrollEntry" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Paystub_generatorId_fkey" FOREIGN KEY ("generatorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Paystub_supersedesPaystubId_fkey" FOREIGN KEY ("supersedesPaystubId") REFERENCES "Paystub" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paystubId" TEXT NOT NULL,
    "paidDate" DATETIME NOT NULL,
    "method" TEXT,
    "externalReference" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentRecord_paystubId_fkey" FOREIGN KEY ("paystubId") REFERENCES "Paystub" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentRecord_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipientUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "reason" TEXT,
    "requestId" TEXT,
    "ipSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_lastName_firstName_idx" ON "User"("lastName", "firstName");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "Equipment_status_type_idx" ON "Equipment"("status", "type");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_driverUserId_returnedAt_idx" ON "EquipmentAssignment"("driverUserId", "returnedAt");

-- CreateIndex
CREATE INDEX "EquipmentAssignment_equipmentId_returnedAt_idx" ON "EquipmentAssignment"("equipmentId", "returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Load_loadNumber_key" ON "Load"("loadNumber");

-- CreateIndex
CREATE INDEX "Load_status_deliveryAt_idx" ON "Load"("status", "deliveryAt");

-- CreateIndex
CREATE INDEX "Load_driverUserId_deliveryAt_idx" ON "Load"("driverUserId", "deliveryAt");

-- CreateIndex
CREATE INDEX "Load_bookedByUserId_deliveryAt_idx" ON "Load"("bookedByUserId", "deliveryAt");

-- CreateIndex
CREATE INDEX "LoadStatusHistory_loadId_idx" ON "LoadStatusHistory"("loadId");

-- CreateIndex
CREATE INDEX "PayRuleSet_userId_effectiveFrom_effectiveTo_idx" ON "PayRuleSet"("userId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "PayRuleSet_userId_version_key" ON "PayRuleSet"("userId", "version");

-- CreateIndex
CREATE INDEX "PayRuleComponent_ruleSetId_idx" ON "PayRuleComponent"("ruleSetId");

-- CreateIndex
CREATE INDEX "RecurringItem_userId_active_startDate_idx" ON "RecurringItem"("userId", "active", "startDate");

-- CreateIndex
CREATE INDEX "ManualPayItem_payPeriodId_idx" ON "ManualPayItem"("payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_schedulerKey_key" ON "PayPeriod"("schedulerKey");

-- CreateIndex
CREATE INDEX "PayPeriod_status_endAt_idx" ON "PayPeriod"("status", "endAt");

-- CreateIndex
CREATE INDEX "PayrollEntry_payPeriodId_role_idx" ON "PayrollEntry"("payPeriodId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_payPeriodId_userId_key" ON "PayrollEntry"("payPeriodId", "userId");

-- CreateIndex
CREATE INDEX "PayrollLineItem_payrollEntryId_category_idx" ON "PayrollLineItem"("payrollEntryId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLineItem_payrollEntryId_sourceType_sourceId_category_key" ON "PayrollLineItem"("payrollEntryId", "sourceType", "sourceId", "category");

-- CreateIndex
CREATE INDEX "RecurringItemOccurrence_payPeriodId_idx" ON "RecurringItemOccurrence"("payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringItemOccurrence_recurringItemId_payPeriodId_key" ON "RecurringItemOccurrence"("recurringItemId", "payPeriodId");

-- CreateIndex
CREATE INDEX "PayrollApproval_payPeriodId_idx" ON "PayrollApproval"("payPeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "Paystub_settlementNumber_key" ON "Paystub"("settlementNumber");

-- CreateIndex
CREATE INDEX "Paystub_payrollEntryId_version_idx" ON "Paystub"("payrollEntryId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Paystub_payrollEntryId_version_key" ON "Paystub"("payrollEntryId", "version");

-- CreateIndex
CREATE INDEX "PaymentRecord_paystubId_idx" ON "PaymentRecord"("paystubId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRecord_paystubId_externalReference_key" ON "PaymentRecord"("paystubId", "externalReference");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_readAt_createdAt_idx" ON "Notification"("recipientUserId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_name_key" ON "NumberSequence"("name");
