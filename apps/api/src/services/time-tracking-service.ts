/**
 * Time Tracking & Payroll Service
 * Handles time entry management, payroll calculations, and payout processing
 */
import { Decimal } from '@prisma/client/runtime/library';

import {
  encryptBankingData,
  decryptBankingData,
  maskAccountNumber,
  isEncryptionConfigured,
} from '../lib/banking-encryption.js';
import { getPrismaClient } from '../lib/prisma.js';

// ============================================================================
// Types
// ============================================================================

interface LogHoursInput {
  userId: string;
  date: Date;
  hoursWorked: number;
  notes?: string;
}

interface UpdateBankingInput {
  userId: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
}

interface TimeEntryFilters {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}

interface PayrollReportEntry {
  userId: string;
  userName: string;
  userEmail: string;
  totalHours: number;
  payRate: number;
  totalDue: number;
  hasBankingInfo: boolean;
}

interface CreatePayoutInput {
  userId: string;
  startDate: Date;
  endDate: Date;
}

// ============================================================================
// Time Entry Operations
// ============================================================================

/**
 * Log hours for a user (creates new entry - multiple entries per day allowed)
 */
export async function logHours(input: LogHoursInput) {
  const prisma = getPrismaClient();

  // Validate hours
  if (input.hoursWorked <= 0 || input.hoursWorked > 24) {
    throw new Error('Hours worked must be between 0 and 24');
  }

  // Create new time entry
  const entry = await prisma.timeEntry.create({
    data: {
      userId: input.userId,
      date: input.date,
      hoursWorked: new Decimal(input.hoursWorked),
      notes: input.notes || null,
    },
  });

  return entry;
}

/**
 * Update an existing time entry (only if not locked to a payout)
 */
export async function updateTimeEntry(
  entryId: string,
  userId: string,
  hoursWorked: number,
  notes?: string
) {
  const prisma = getPrismaClient();

  // Find the entry
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error('Time entry not found');
  }

  if (entry.userId !== userId) {
    throw new Error('Unauthorized: You can only edit your own time entries');
  }

  // Check if locked (attached to a payout)
  if (entry.payrollPayoutId) {
    const error = new Error(
      'LOCKED: This time entry has been finalized in a payout and cannot be modified'
    );
    (error as any).statusCode = 403;
    throw error;
  }

  // Validate hours
  if (hoursWorked <= 0 || hoursWorked > 24) {
    throw new Error('Hours worked must be between 0 and 24');
  }

  // Update
  const updated = await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      hoursWorked: new Decimal(hoursWorked),
      notes: notes ?? entry.notes,
    },
  });

  return updated;
}

/**
 * Delete a time entry (only if not locked to a payout)
 */
export async function deleteTimeEntry(entryId: string, userId: string) {
  const prisma = getPrismaClient();

  // Find the entry
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error('Time entry not found');
  }

  if (entry.userId !== userId) {
    throw new Error('Unauthorized: You can only delete your own time entries');
  }

  // Check if locked
  if (entry.payrollPayoutId) {
    const error = new Error(
      'LOCKED: This time entry has been finalized in a payout and cannot be deleted'
    );
    (error as any).statusCode = 403;
    throw error;
  }

  await prisma.timeEntry.delete({
    where: { id: entryId },
  });

  return { success: true };
}

/**
 * Get time entries for a specific user
 */
export async function getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date) {
  const prisma = getPrismaClient();

  const where: any = { userId };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = startDate;
    if (endDate) where.date.lte = endDate;
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: { date: 'desc' },
    include: {
      payrollPayout: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  return entries;
}

/**
 * Get all time entries (admin view)
 */
export async function getAllTimeEntries(tenantId: string, filters: TimeEntryFilters) {
  const prisma = getPrismaClient();

  const where: any = {
    user: {
      tenantId,
    },
  };

  if (filters.userId) {
    where.userId = filters.userId;
  }

  if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) where.date.gte = filters.startDate;
    if (filters.endDate) where.date.lte = filters.endDate;
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      payrollPayout: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  return entries;
}

// ============================================================================
// User Financials & Banking
// ============================================================================

/**
 * Set pay rate for a user (admin only)
 */
export async function setPayRate(userId: string, payRate: number) {
  const prisma = getPrismaClient();

  if (payRate < 0) {
    throw new Error('Pay rate cannot be negative');
  }

  // Upsert user financials
  const financials = await prisma.userFinancials.upsert({
    where: { userId },
    create: {
      userId,
      payRate: new Decimal(payRate),
    },
    update: {
      payRate: new Decimal(payRate),
    },
  });

  return financials;
}

/**
 * Update banking information (encrypted)
 */
export async function updateBankingInfo(input: UpdateBankingInput) {
  const prisma = getPrismaClient();

  // Verify encryption is configured
  if (!isEncryptionConfigured()) {
    throw new Error('Banking encryption is not configured. Contact your administrator.');
  }

  // Validate input
  if (!input.bankName || !input.accountNumber || !input.routingNumber) {
    throw new Error('Bank name, account number, and routing number are required');
  }

  // Encrypt the banking data
  const encrypted = encryptBankingData({
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    routingNumber: input.routingNumber,
  });

  // Upsert user financials
  const financials = await prisma.userFinancials.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      maskedAccountNumber: encrypted.maskedAccountNumber,
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
    update: {
      maskedAccountNumber: encrypted.maskedAccountNumber,
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
  });

  return {
    id: financials.id,
    userId: financials.userId,
    payRate: financials.payRate,
    maskedAccountNumber: financials.maskedAccountNumber,
    hasBankingInfo: true,
  };
}

/**
 * Get banking information for a user (decrypted)
 * Only returns full data to the user themselves
 */
export async function getBankingInfo(userId: string, requestingUserId: string) {
  const prisma = getPrismaClient();

  const financials = await prisma.userFinancials.findUnique({
    where: { userId },
  });

  if (!financials) {
    return {
      userId,
      payRate: 0,
      hasBankingInfo: false,
      maskedAccountNumber: null,
      bankName: null,
      routingNumber: null,
      accountNumber: null,
    };
  }

  // If not the owner, only return masked info
  if (userId !== requestingUserId) {
    return {
      userId,
      payRate: Number(financials.payRate),
      hasBankingInfo: !!financials.encryptedData,
      maskedAccountNumber: financials.maskedAccountNumber,
      bankName: null,
      routingNumber: null,
      accountNumber: null,
    };
  }

  // Owner can see decrypted data
  if (financials.encryptedData && financials.iv && financials.authTag) {
    try {
      const decrypted = decryptBankingData(
        financials.encryptedData,
        financials.iv,
        financials.authTag
      );

      return {
        userId,
        payRate: Number(financials.payRate),
        hasBankingInfo: true,
        maskedAccountNumber: financials.maskedAccountNumber,
        bankName: decrypted.bankName,
        routingNumber: decrypted.routingNumber,
        accountNumber: decrypted.accountNumber,
      };
    } catch (err) {
      console.error('Failed to decrypt banking data:', err);
      throw new Error('Failed to decrypt banking information');
    }
  }

  return {
    userId,
    payRate: Number(financials.payRate),
    hasBankingInfo: false,
    maskedAccountNumber: null,
    bankName: null,
    routingNumber: null,
    accountNumber: null,
  };
}

/**
 * Get user's earnings summary
 */
export async function getEarningsSummary(userId: string, startDate: Date, endDate: Date) {
  const prisma = getPrismaClient();

  // Get financials for pay rate
  const financials = await prisma.userFinancials.findUnique({
    where: { userId },
  });

  const payRate = financials ? Number(financials.payRate) : 0;

  // Sum hours in date range (exclude already paid entries)
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.hoursWorked), 0);

  const pendingHours = entries
    .filter(e => !e.payrollPayoutId)
    .reduce((sum, entry) => sum + Number(entry.hoursWorked), 0);

  const paidHours = entries
    .filter(e => e.payrollPayoutId)
    .reduce((sum, entry) => sum + Number(entry.hoursWorked), 0);

  return {
    totalHours,
    pendingHours,
    paidHours,
    payRate,
    estimatedEarnings: totalHours * payRate,
    pendingEarnings: pendingHours * payRate,
    paidEarnings: paidHours * payRate,
  };
}

// ============================================================================
// Payroll Reports & Payouts
// ============================================================================

/**
 * Get payroll report for all users in a tenant (admin)
 */
export async function getPayrollReport(
  tenantId: string,
  startDate: Date,
  endDate: Date
): Promise<PayrollReportEntry[]> {
  const prisma = getPrismaClient();

  // Get all users in tenant with their financials and time entries
  const users = await prisma.user.findMany({
    where: { tenantId },
    include: {
      financials: true,
      timeEntries: {
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          payrollPayoutId: null, // Only unpaid entries
        },
      },
    },
  });

  return users
    .map(user => {
      const totalHours = user.timeEntries.reduce(
        (sum, entry) => sum + Number(entry.hoursWorked),
        0
      );
      const payRate = user.financials ? Number(user.financials.payRate) : 0;

      return {
        userId: user.id,
        userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
        userEmail: user.email,
        totalHours,
        payRate,
        totalDue: totalHours * payRate,
        hasBankingInfo: !!user.financials?.encryptedData,
      };
    })
    .filter(entry => entry.totalHours > 0); // Only users with logged hours
}

/**
 * Validate users before creating payouts
 */
export async function validatePayrollBatch(
  userIds: string[]
): Promise<{ valid: boolean; errors: string[] }> {
  const prisma = getPrismaClient();
  const errors: string[] = [];

  for (const userId of userIds) {
    const financials = await prisma.userFinancials.findUnique({
      where: { userId },
      include: { user: true },
    });

    const userName = financials?.user
      ? `${financials.user.firstName || ''} ${financials.user.lastName || ''}`.trim() ||
        financials.user.email
      : userId;

    if (!financials) {
      errors.push(`${userName}: No financial record found`);
      continue;
    }

    if (Number(financials.payRate) === 0) {
      errors.push(`${userName}: Pay rate is $0.00`);
    }

    if (!financials.encryptedData) {
      errors.push(`${userName}: Missing banking information`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a payout and lock associated time entries
 */
export async function createPayout(input: CreatePayoutInput) {
  const prisma = getPrismaClient();

  // Validate user first
  const validation = await validatePayrollBatch([input.userId]);
  if (!validation.valid) {
    throw new Error(`Cannot create payout: ${validation.errors.join(', ')}`);
  }

  // Get user's pay rate
  const financials = await prisma.userFinancials.findUnique({
    where: { userId: input.userId },
  });

  if (!financials) {
    throw new Error('User has no financial record');
  }

  const payRate = Number(financials.payRate);

  // Find all unpaid time entries in the date range
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId: input.userId,
      date: {
        gte: input.startDate,
        lte: input.endDate,
      },
      payrollPayoutId: null,
    },
  });

  if (entries.length === 0) {
    throw new Error('No unpaid time entries found in the specified date range');
  }

  // Calculate totals
  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.hoursWorked), 0);
  const totalAmount = totalHours * payRate;

  // Create payout and link entries in a transaction
  const payout = await prisma.$transaction(async tx => {
    // Create the payout
    const newPayout = await tx.payrollPayout.create({
      data: {
        userId: input.userId,
        startDate: input.startDate,
        endDate: input.endDate,
        totalHours: new Decimal(totalHours),
        totalAmount: new Decimal(totalAmount),
        status: 'PROCESSING',
      },
    });

    // Lock the time entries by setting their payrollPayoutId
    await tx.timeEntry.updateMany({
      where: {
        id: { in: entries.map(e => e.id) },
      },
      data: {
        payrollPayoutId: newPayout.id,
      },
    });

    return newPayout;
  });

  return {
    ...payout,
    entriesLocked: entries.length,
  };
}

/**
 * Mark payout as paid
 */
export async function markPayoutPaid(payoutId: string) {
  const prisma = getPrismaClient();

  const payout = await prisma.payrollPayout.update({
    where: { id: payoutId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
    },
  });

  return payout;
}

/**
 * Get user's payouts
 */
export async function getUserPayouts(userId: string) {
  const prisma = getPrismaClient();

  const payouts = await prisma.payrollPayout.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { timeEntries: true },
      },
    },
  });

  return payouts;
}
