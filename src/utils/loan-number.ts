import type { LoanType } from '#generated/prisma/enums.js';

/**
 * Generates the next loan number for a given tenant, year, and loan type.
 *
 * Uses INSERT ... ON CONFLICT DO UPDATE ... RETURNING for atomicity —
 * no separate SELECT FOR UPDATE needed. Must be called inside a
 * Prisma interactive $transaction.
 *
 * @param tx   Prisma transaction client (from prisma.$transaction)
 * @param tenantId  The tenant UUID
 * @param year      Disbursement year (e.g. 2026)
 * @param loanType  'MONTHLY' | 'DAILY'
 * @returns Formatted loan number, e.g. 'ML-2026-0001'
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateLoanNumber(tx: any, tenantId: string, year: number, loanType: LoanType): Promise<string> {
  const prefix = loanType === 'MONTHLY' ? 'ML' : 'DL';

  const rows: Array<{ current_value: number }> = await tx.$queryRaw`
    INSERT INTO loan_number_sequences (tenant_id, year, loan_type, current_value)
    VALUES (${tenantId}::uuid, ${year}, ${loanType}::"LoanType", 1)
    ON CONFLICT (tenant_id, year, loan_type)
    DO UPDATE SET current_value = loan_number_sequences.current_value + 1
    RETURNING current_value
  `;

  const seq = rows[0]!.current_value;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}
