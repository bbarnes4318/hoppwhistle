/**
 * Time Tracking & Payroll Service
 * Handles time entries, banking info, and payroll operations
 */
import { Decimal } from '@prisma/client/runtime/library';

import { decryptBankingData, encryptBankingData } from '../lib/banking-encryption.js';
import { getPrismaClient } from '../lib/prisma.js';

// Get the Prisma client instance
const prisma = getPrismaClient();

// =============================================================================
// TIME ENTRY OPERATIONS
// =============================================================================

interface LogHoursInput {
  userId: string;
  date: Date;
  hoursWorked: number;
  notes?: string;
}

/**
 * Log hours for a specific date
 * Multiple entries per day are allowed
 */
export async function logHours(input: LogHoursInput) {
  const { userId, date, hoursWorked, notes } = input;

  // Validate hours
  if (hoursWorked <= 0 || hoursWorked > 24) {
    throw new Error('Hours worked must be between 0 and 24');
  }

  // Create the time entry
  const entry = await prisma.timeEntry.create({
    data: {
      userId,
      date,
      hoursWorked: new Decimal(hoursWorked),
      notes,
    },
  });

  return entry;
}

/**
 * Update a time entry (only if not locked)
 */
export async function updateTimeEntry(
  entryId: string,
  userId: string,
  hoursWorked: number,
  notes?: string
) {
  // First, get the entry to check ownership and lock status
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error('Time entry not found');
  }

  if (entry.userId !== userId) {
    const error = new Error('You can only modify your own time entries');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  // Check if locked (attached to a payout)
  if (entry.payrollPayoutId) {
    const error = new Error(
      'LOCKED: This time entry has been finalized in a payout and cannot be modified'
    );
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  // Update the entry
  const updated = await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      hoursWorked: new Decimal(hoursWorked),
      notes,
    },
  });

  return updated;
}

/**
 * Delete a time entry (only if not locked)
 */
export async function deleteTimeEntry(entryId: string, userId: string) {
  // First, get the entry to check ownership and lock status
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry) {
    throw new Error('Time entry not found');
  }

  if (entry.userId !== userId) {
    const error = new Error('You can only delete your own time entries');
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  // Check if locked (attached to a payout)
  if (entry.payrollPayoutId) {
    const error = new Error(
      'LOCKED: This time entry has been finalized in a payout and cannot be deleted'
    );
    (error as Error & { statusCode: number }).statusCode = 403;
    throw error;
  }

  await prisma.timeEntry.delete({
    where: { id: entryId },
  });

  return { success: true };
}

/**
 * Get all time entries for a user within a date range
 */
export async function getUserTimeEntries(userId: string, startDate?: Date, endDate?: Date) {
  const where: { userId: string; date?: { gte?: Date; lte?: Date } } = { userId };

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = startDate;
    if (endDate) where.date.lte = endDate;
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      payrollPayout: {
        select: {
          id: true,
          status: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  return entries;
}

/**
 * Get earnings summary for a user within a date range
 */
export async function getEarningsSummary(userId: string, startDate: Date, endDate: Date) {
  // Get user's pay rate
  const financials = await prisma.userFinancials.findUnique({
    where: { userId },
  });

  const payRate = financials?.payRate ? Number(financials.payRate) : 0;

  // Get all time entries in the period
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
  });

  // Calculate totals
  let totalHours = 0;
  let pendingHours = 0;
  let paidHours = 0;

  for (const entry of entries) {
    const hours = Number(entry.hoursWorked);
    totalHours += hours;

    if (entry.payrollPayoutId) {
      paidHours += hours;
    } else {
      pendingHours += hours;
    }
  }

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

// =============================================================================
// BANKING & FINANCIALS
// =============================================================================

interface UpdateBankingInput {
  userId: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
}

/**
 * Update user's banking information (encrypted)
 */
export async function updateBankingInfo(input: UpdateBankingInput) {
  const { userId, bankName, accountNumber, routingNumber } = input;

  // Encrypt the banking data
  const encrypted = encryptBankingData({
    bankName,
    accountNumber,
    routingNumber,
  });

  // Upsert the financials record
  const financials = await prisma.userFinancials.upsert({
    where: { userId },
    create: {
      userId,
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedAccountNumber: encrypted.maskedAccountNumber,
    },
    update: {
      encryptedData: encrypted.encryptedData,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedAccountNumber: encrypted.maskedAccountNumber,
    },
  });

  return {
    success: true,
    maskedAccountNumber: financials.maskedAccountNumber,
  };
}

/**
 * Get user's banking info (decrypted for authorized viewers)
 */
export async function getBankingInfo(userId: string, requesterId: string) {
  const financials = await prisma.userFinancials.findUnique({
    where: { userId },
  });

  if (!financials) {
    return {
      hasBankingInfo: false,
      maskedAccountNumber: null,
      bankName: null,
      routingNumber: null,
      accountNumber: null,
      payRate: 0,
    };
  }

  // Only decrypt if requesting own data
  if (userId === requesterId && financials.encryptedData && financials.iv && financials.authTag) {
    const decrypted = decryptBankingData(
      financials.encryptedData,
      financials.iv,
      financials.authTag
    );

    return {
      hasBankingInfo: true,
      maskedAccountNumber: financials.maskedAccountNumber,
      bankName: decrypted.bankName,
      routingNumber: decrypted.routingNumber,
      accountNumber: decrypted.accountNumber,
      payRate: Number(financials.payRate),
    };
  }

  // Return masked data for others
  return {
    hasBankingInfo: !!financials.encryptedData,
    maskedAccountNumber: financials.maskedAccountNumber,
    bankName: null,
    routingNumber: null,
    accountNumber: null,
    payRate: Number(financials.payRate),
  };
}

/**
 * Set pay rate for a user (admin only)
 */
export async function setPayRate(userId: string, payRate: number) {
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

// =============================================================================
// ADMIN / PAYROLL OPERATIONS
// =============================================================================

/**
 * Get all time entries for a tenant (admin view)
 */
export async function getAllTimeEntries(
  tenantId: string,
  filters: {
    startDate?: Date;
    endDate?: Date;
    userId?: string;
  }
) {
  interface WhereClause {
    user: { tenantId: string };
    date?: { gte?: Date; lte?: Date };
    userId?: string;
  }

  const where: WhereClause = {
    user: { tenantId },
  };

  if (filters.startDate || filters.endDate) {
    where.date = {};
    if (filters.startDate) where.date.gte = filters.startDate;
    if (filters.endDate) where.date.lte = filters.endDate;
  }

  if (filters.userId) {
    where.userId = filters.userId;
  }

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });

  return entries;
}

/**
 * Get payroll report for a tenant within a date range
 */
export async function getPayrollReport(tenantId: string, startDate: Date, endDate: Date) {
  // Get all users with time entries in this period
  const usersWithEntries = await prisma.user.findMany({
    where: {
      tenantId,
      timeEntries: {
        some: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          payrollPayoutId: null, // Only unpaid entries
        },
      },
    },
    include: {
      timeEntries: {
        where: {
          date: {
            gte: startDate,
            lte: endDate,
          },
          payrollPayoutId: null, // Only unpaid entries
        },
      },
      financials: true,
    },
  });

  // Build report
  const report = usersWithEntries.map(user => {
    const totalHours = user.timeEntries.reduce((sum, e) => sum + Number(e.hoursWorked), 0);
    const payRate = user.financials?.payRate ? Number(user.financials.payRate) : 0;
    const totalDue = totalHours * payRate;

    return {
      userId: user.id,
      userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      userEmail: user.email,
      totalHours,
      payRate,
      totalDue,
      hasBankingInfo: !!user.financials?.encryptedData,
    };
  });

  return report;
}

/**
 * Validate a batch of users before creating payouts
 */
export async function validatePayrollBatch(userIds: string[]) {
  const errors: string[] = [];

  for (const userId of userIds) {
    const financials = await prisma.userFinancials.findUnique({
      where: { userId },
    });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, firstName: true, lastName: true },
    });

    const userName = user
      ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email
      : userId;

    if (!financials) {
      errors.push(`${userName}: No pay rate or banking info on file`);
      continue;
    }

    if (!financials.payRate || Number(financials.payRate) === 0) {
      errors.push(`${userName}: Pay rate is $0`);
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

interface CreatePayoutInput {
  userId: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Create a payout for a user and lock associated time entries
 */
export async function createPayout(input: CreatePayoutInput) {
  const { userId, startDate, endDate } = input;

  // Get user's pay rate
  const financials = await prisma.userFinancials.findUnique({
    where: { userId },
  });

  if (!financials || !financials.payRate || Number(financials.payRate) === 0) {
    throw new Error('User does not have a pay rate set');
  }

  if (!financials.encryptedData) {
    throw new Error('User does not have banking information on file');
  }

  // Get all unlocked time entries in the period
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      date: {
        gte: startDate,
        lte: endDate,
      },
      payrollPayoutId: null, // Only unlocked entries
    },
  });

  if (entries.length === 0) {
    throw new Error('No unpaid time entries found in the specified period');
  }

  // Calculate totals
  const totalHours = entries.reduce((sum, e) => sum + Number(e.hoursWorked), 0);
  const totalAmount = totalHours * Number(financials.payRate);

  // Create payout and lock entries in a transaction
  const payout = await prisma.$transaction(async tx => {
    // Create the payout
    const newPayout = await tx.payrollPayout.create({
      data: {
        userId,
        startDate,
        endDate,
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
 * Get a user's payout history
 */
export async function getUserPayouts(userId: string) {
  const payouts = await prisma.payrollPayout.findMany({
    where: { userId },
    include: {
      _count: {
        select: { timeEntries: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return payouts;
}

/**
 * Mark a payout as paid
 */
export async function markPayoutPaid(payoutId: string) {
  const payout = await prisma.payrollPayout.update({
    where: { id: payoutId },
    data: {
      status: 'PAID',
      paidAt: new Date(),
    },
  });

  return payout;
}
