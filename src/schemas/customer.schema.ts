import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

// ─── Param Schemas ─────────────────────────────────────────────────────────

export const customerIdParamSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
  })
  .openapi('CustomerIdParam');

// ─── Query Schemas ─────────────────────────────────────────────────────────

export const listCustomersQuerySchema = z
  .object({
    search: z.string().optional().openapi({ example: 'John' }),
    phone: z.string().optional().openapi({ example: '9876543210' }),
    is_defaulter: z
      .string()
      .optional()
      .openapi({ example: 'true' }),
    page: z.string().optional().default('1').openapi({ example: '1' }),
    limit: z.string().optional().default('20').openapi({ example: '20' }),
  })
  .transform((data) => ({
    search: data.search,
    phone: data.phone,
    is_defaulter: data.is_defaulter === undefined ? undefined : data.is_defaulter === 'true',
    page: Math.max(1, parseInt(data.page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(data.limit, 10) || 20)),
  }))
  .openapi('ListCustomersQuery');

// ─── Request Schemas ───────────────────────────────────────────────────────

export const createCustomerSchema = z
  .object({
    full_name: z.string().min(1).max(200).openapi({ example: 'Rajesh Kumar' }),
    phone: z.string().min(10).max(15).openapi({ example: '9876543210' }),
    alternate_phone: z.string().min(10).max(15).optional().openapi({ example: '9876543211' }),
    address: z.string().max(1000).optional().openapi({ example: '123 Main St, Mumbai' }),
    aadhaar_number: z
      .string()
      .regex(/^\d{12}$/, 'Aadhaar number must be exactly 12 digits')
      .optional()
      .openapi({ example: '123456789012' }),
    pan_number: z
      .string()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must match format: ABCDE1234F')
      .optional()
      .openapi({ example: 'ABCDE1234F' }),
    id_proof_type: z.string().max(50).optional().openapi({ example: 'AADHAAR' }),
    occupation: z.string().max(200).optional().openapi({ example: 'Business Owner' }),
    notes: z.string().max(2000).optional().openapi({ example: 'Regular customer' }),
  })
  .openapi('CreateCustomerRequest');

export const updateCustomerSchema = z
  .object({
    full_name: z.string().min(1).max(200).nullable().optional().openapi({ example: 'Rajesh Kumar' }),
    phone: z.string().min(10).max(15).nullable().optional().openapi({ example: '9876543210' }),
    alternate_phone: z.string().min(10).max(15).nullable().optional().openapi({ example: '9876543211' }),
    address: z.string().max(1000).nullable().optional().openapi({ example: '123 Main St, Mumbai' }),
    aadhaar_number: z
      .string()
      .regex(/^\d{12}$/, 'Aadhaar number must be exactly 12 digits')
      .nullable()
      .optional()
      .openapi({ example: '123456789012' }),
    pan_number: z
      .string()
      .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must match format: ABCDE1234F')
      .nullable()
      .optional()
      .openapi({ example: 'ABCDE1234F' }),
    id_proof_type: z.string().max(50).nullable().optional().openapi({ example: 'AADHAAR' }),
    occupation: z.string().max(200).nullable().optional().openapi({ example: 'Business Owner' }),
    notes: z.string().max(2000).nullable().optional().openapi({ example: 'Regular customer' }),
  })
  .openapi('UpdateCustomerRequest');

// ─── Response Schemas ──────────────────────────────────────────────────────

export const customerResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
    fullName: z.string().openapi({ example: 'Rajesh Kumar' }),
    phone: z.string().openapi({ example: '9876543210' }),
    alternatePhone: z.string().nullable().openapi({ example: '9876543211' }),
    address: z.string().nullable().openapi({ example: '123 Main St, Mumbai' }),
    aadhaarNumber: z.string().nullable().openapi({ example: '123456789012' }),
    panNumber: z.string().nullable().openapi({ example: 'ABCDE1234F' }),
    idProofType: z.string().nullable().openapi({ example: 'AADHAAR' }),
    occupation: z.string().nullable().openapi({ example: 'Business Owner' }),
    notes: z.string().nullable().openapi({ example: 'Regular customer' }),
    isDefaulter: z.boolean().openapi({ example: false }),
    createdAt: z.string().openapi({ example: '2025-01-15T10:30:00.000Z' }),
  })
  .openapi('CustomerResponse');

export const guarantorWarningSchema = z
  .object({
    loanId: z.string().uuid().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'ML-2025-0001' }),
    borrowerName: z.string().openapi({ example: 'Suresh Patel' }),
    status: z.string().openapi({ example: 'DEFAULTED' }),
  })
  .openapi('GuarantorWarning');

export const customerDetailResponseSchema = customerResponseSchema
  .extend({
    guarantorWarnings: z.array(guarantorWarningSchema),
  })
  .openapi('CustomerDetailResponse');

export const customerLoanResponseSchema = z
  .object({
    id: z.string().uuid().openapi({ example: '660e8400-e29b-41d4-a716-446655440000' }),
    loanNumber: z.string().openapi({ example: 'ML-2025-0001' }),
    loanType: z.enum(['MONTHLY', 'DAILY']).openapi({ example: 'MONTHLY' }),
    principalAmount: z.number().openapi({ example: 100000 }),
    interestRate: z.number().openapi({ example: 2.5 }),
    status: z.string().openapi({ example: 'ACTIVE' }),
    disbursementDate: z.string().openapi({ example: '2025-01-15' }),
    createdAt: z.string().openapi({ example: '2025-01-15T10:30:00.000Z' }),
  })
  .openapi('CustomerLoanResponse');

export const customerLoansListResponseSchema = z.array(customerLoanResponseSchema).openapi('CustomerLoansListResponse');

export const paginationSchema = z
  .object({
    page: z.number().openapi({ example: 1 }),
    limit: z.number().openapi({ example: 20 }),
    total: z.number().openapi({ example: 50 }),
    totalPages: z.number().openapi({ example: 3 }),
  })
  .openapi('Pagination');
