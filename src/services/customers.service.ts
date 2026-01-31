import prisma from '../lib/prisma.js';
import { AppError } from '../utils/errors.js';

const customerSelect = {
  id: true,
  fullName: true,
  phone: true,
  alternatePhone: true,
  address: true,
  aadhaarNumber: true,
  panNumber: true,
  idProofType: true,
  occupation: true,
  notes: true,
  isDefaulter: true,
  createdAt: true,
} as const;

export async function listCustomers(
  tenantId: string,
  query: {
    search?: string;
    phone?: string;
    is_defaulter?: boolean;
    page: number;
    limit: number;
  },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { tenantId };

  if (query.search) {
    where.fullName = { contains: query.search, mode: 'insensitive' };
  }

  if (query.phone) {
    where.phone = { contains: query.phone };
  }

  if (query.is_defaulter !== undefined) {
    where.isDefaulter = query.is_defaulter;
  }

  const skip = (query.page - 1) * query.limit;

  const [data, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: customerSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: query.limit,
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    data,
    pagination: { page: query.page, limit: query.limit, total },
  };
}

export async function getCustomer(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: customerSelect,
  });

  if (!customer) {
    throw AppError.notFound('Customer not found');
  }

  const defaultedLoans = await prisma.loan.findMany({
    where: {
      guarantorId: customerId,
      tenantId,
      status: { in: ['DEFAULTED', 'WRITTEN_OFF'] },
    },
    select: {
      id: true,
      loanNumber: true,
      status: true,
      borrower: { select: { fullName: true } },
    },
  });

  const guarantorWarnings = defaultedLoans.map((loan) => ({
    loanId: loan.id,
    loanNumber: loan.loanNumber,
    borrowerName: loan.borrower.fullName,
    status: loan.status,
  }));

  return { ...customer, guarantorWarnings };
}

export async function createCustomer(
  tenantId: string,
  createdById: string,
  data: {
    full_name: string;
    phone: string;
    alternate_phone?: string;
    address?: string;
    aadhaar_number?: string;
    pan_number?: string;
    id_proof_type?: string;
    occupation?: string;
    notes?: string;
  },
) {
  // Check aadhaar uniqueness within tenant (only when non-null)
  if (data.aadhaar_number) {
    const existing = await prisma.customer.findFirst({
      where: { tenantId, aadhaarNumber: data.aadhaar_number },
    });
    if (existing) {
      throw AppError.conflict('A customer with this Aadhaar number already exists');
    }
  }

  // Check PAN uniqueness within tenant (only when non-null)
  if (data.pan_number) {
    const existing = await prisma.customer.findFirst({
      where: { tenantId, panNumber: data.pan_number },
    });
    if (existing) {
      throw AppError.conflict('A customer with this PAN number already exists');
    }
  }

  return prisma.customer.create({
    data: {
      tenantId,
      createdById,
      fullName: data.full_name,
      phone: data.phone,
      alternatePhone: data.alternate_phone,
      address: data.address,
      aadhaarNumber: data.aadhaar_number,
      panNumber: data.pan_number,
      idProofType: data.id_proof_type,
      occupation: data.occupation,
      notes: data.notes,
    },
    select: customerSelect,
  });
}

export async function updateCustomer(
  tenantId: string,
  customerId: string,
  data: {
    full_name?: string | null;
    phone?: string | null;
    alternate_phone?: string | null;
    address?: string | null;
    aadhaar_number?: string | null;
    pan_number?: string | null;
    id_proof_type?: string | null;
    occupation?: string | null;
    notes?: string | null;
  } = {},
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!customer) {
    throw AppError.notFound('Customer not found');
  }

  // Check aadhaar uniqueness if changed (and non-null)
  if (data.aadhaar_number !== undefined && data.aadhaar_number !== null && data.aadhaar_number !== customer.aadhaarNumber) {
    const existing = await prisma.customer.findFirst({
      where: { tenantId, aadhaarNumber: data.aadhaar_number, id: { not: customerId } },
    });
    if (existing) {
      throw AppError.conflict('A customer with this Aadhaar number already exists');
    }
  }

  // Check PAN uniqueness if changed (and non-null)
  if (data.pan_number !== undefined && data.pan_number !== null && data.pan_number !== customer.panNumber) {
    const existing = await prisma.customer.findFirst({
      where: { tenantId, panNumber: data.pan_number, id: { not: customerId } },
    });
    if (existing) {
      throw AppError.conflict('A customer with this PAN number already exists');
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.full_name !== undefined) updateData.fullName = data.full_name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.alternate_phone !== undefined) updateData.alternatePhone = data.alternate_phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.aadhaar_number !== undefined) updateData.aadhaarNumber = data.aadhaar_number;
  if (data.pan_number !== undefined) updateData.panNumber = data.pan_number;
  if (data.id_proof_type !== undefined) updateData.idProofType = data.id_proof_type;
  if (data.occupation !== undefined) updateData.occupation = data.occupation;
  if (data.notes !== undefined) updateData.notes = data.notes;

  return prisma.customer.update({
    where: { id: customerId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: updateData as any,
    select: customerSelect,
  });
}

export async function getCustomerLoans(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  });
  if (!customer) {
    throw AppError.notFound('Customer not found');
  }

  return prisma.loan.findMany({
    where: { borrowerId: customerId, tenantId },
    select: {
      id: true,
      loanNumber: true,
      loanType: true,
      principalAmount: true,
      interestRate: true,
      status: true,
      disbursementDate: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function clearDefaulter(tenantId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!customer) {
    throw AppError.notFound('Customer not found');
  }

  if (!customer.isDefaulter) {
    throw AppError.badRequest('Customer is not marked as a defaulter');
  }

  return prisma.customer.update({
    where: { id: customerId },
    data: { isDefaulter: false },
    select: customerSelect,
  });
}
