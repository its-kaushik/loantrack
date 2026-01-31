import { z } from 'zod';
import { registry } from './openapi.js';
import { createSuccessResponse, errorResponses } from '../schemas/responses.schema.js';
import {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
  loginResponseSchema,
  refreshResponseSchema,
  messageResponseSchema,
  getMeResponseSchema,
} from '../schemas/auth.schema.js';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  userIdParamSchema,
  userResponseSchema,
  usersListResponseSchema,
} from '../schemas/user.schema.js';
import {
  customerIdParamSchema,
  listCustomersQuerySchema,
  createCustomerSchema,
  updateCustomerSchema,
  customerResponseSchema,
  customerDetailResponseSchema,
  customerLoansListResponseSchema,
  paginationSchema,
} from '../schemas/customer.schema.js';
import {
  loanIdParamSchema,
  listLoansQuerySchema,
  listLoanTransactionsQuerySchema,
  createLoanSchema,
  loanResponseSchema,
  monthlyLoanDetailResponseSchema,
  dailyLoanDetailResponseSchema,
  loanTransactionResponseSchema,
  paymentStatusResponseSchema,
  dailyPaymentStatusResponseSchema,
} from '../schemas/loan.schema.js';
import {
  createTransactionSchema,
  transactionResponseSchema,
} from '../schemas/transaction.schema.js';

const bearerAuth = [{ bearerAuth: [] }];

// ─── Auth Routes ────────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Login with phone and password',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: 'Login successful',
      content: { 'application/json': { schema: createSuccessResponse(loginResponseSchema) } },
    },
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Auth'],
  summary: 'Refresh access token',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: refreshSchema } },
    },
  },
  responses: {
    200: {
      description: 'Token refreshed',
      content: { 'application/json': { schema: createSuccessResponse(refreshResponseSchema) } },
    },
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Logout (revoke all refresh tokens)',
  security: bearerAuth,
  responses: {
    200: {
      description: 'Logged out',
      content: { 'application/json': { schema: createSuccessResponse(messageResponseSchema) } },
    },
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/auth/change-password',
  tags: ['Auth'],
  summary: 'Change current user password',
  security: bearerAuth,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: changePasswordSchema } },
    },
  },
  responses: {
    200: {
      description: 'Password changed',
      content: { 'application/json': { schema: createSuccessResponse(messageResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  summary: 'Get current authenticated user profile',
  security: bearerAuth,
  responses: {
    200: {
      description: 'Current user profile',
      content: { 'application/json': { schema: createSuccessResponse(getMeResponseSchema) } },
    },
    401: errorResponses[401],
  },
});

// ─── Users Routes ───────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/users',
  tags: ['Users'],
  summary: 'List all users in tenant',
  security: bearerAuth,
  responses: {
    200: {
      description: 'List of users',
      content: { 'application/json': { schema: createSuccessResponse(usersListResponseSchema) } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/users',
  tags: ['Users'],
  summary: 'Create a new user in tenant',
  security: bearerAuth,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createUserSchema } },
    },
  },
  responses: {
    201: {
      description: 'User created',
      content: { 'application/json': { schema: createSuccessResponse(userResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
  },
});

registry.registerPath({
  method: 'put',
  path: '/users/{id}',
  tags: ['Users'],
  summary: 'Update a user',
  security: bearerAuth,
  request: {
    params: userIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: updateUserSchema } },
    },
  },
  responses: {
    200: {
      description: 'User updated',
      content: { 'application/json': { schema: createSuccessResponse(userResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/users/{id}/deactivate',
  tags: ['Users'],
  summary: 'Deactivate a user',
  security: bearerAuth,
  request: {
    params: userIdParamSchema,
  },
  responses: {
    200: {
      description: 'User deactivated',
      content: { 'application/json': { schema: createSuccessResponse(messageResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/users/{id}/reset-password',
  tags: ['Users'],
  summary: 'Reset a user password (admin)',
  security: bearerAuth,
  request: {
    params: userIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: resetPasswordSchema } },
    },
  },
  responses: {
    200: {
      description: 'Password reset',
      content: { 'application/json': { schema: createSuccessResponse(messageResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

// ─── Customers Routes ──────────────────────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/customers',
  tags: ['Customers'],
  summary: 'List customers with search, filters, and pagination',
  security: bearerAuth,
  request: {
    query: listCustomersQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of customers',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(customerResponseSchema),
            pagination: paginationSchema,
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

registry.registerPath({
  method: 'post',
  path: '/customers',
  tags: ['Customers'],
  summary: 'Create a new customer',
  security: bearerAuth,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createCustomerSchema } },
    },
  },
  responses: {
    201: {
      description: 'Customer created',
      content: { 'application/json': { schema: createSuccessResponse(customerResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: errorResponses[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/customers/{id}',
  tags: ['Customers'],
  summary: 'Get customer detail with guarantor warnings',
  security: bearerAuth,
  request: {
    params: customerIdParamSchema,
  },
  responses: {
    200: {
      description: 'Customer detail',
      content: { 'application/json': { schema: createSuccessResponse(customerDetailResponseSchema) } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'put',
  path: '/customers/{id}',
  tags: ['Customers'],
  summary: 'Update a customer',
  security: bearerAuth,
  request: {
    params: customerIdParamSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: updateCustomerSchema } },
    },
  },
  responses: {
    200: {
      description: 'Customer updated',
      content: { 'application/json': { schema: createSuccessResponse(customerResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
  },
});

registry.registerPath({
  method: 'get',
  path: '/customers/{id}/loans',
  tags: ['Customers'],
  summary: 'List loans for a customer',
  security: bearerAuth,
  request: {
    params: customerIdParamSchema,
  },
  responses: {
    200: {
      description: 'Customer loans',
      content: { 'application/json': { schema: createSuccessResponse(customerLoansListResponseSchema) } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/customers/{id}/clear-defaulter',
  tags: ['Customers'],
  summary: 'Clear defaulter flag on a customer',
  security: bearerAuth,
  request: {
    params: customerIdParamSchema,
  },
  responses: {
    200: {
      description: 'Defaulter flag cleared',
      content: { 'application/json': { schema: createSuccessResponse(customerResponseSchema) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

// ─── Loans Routes ───────────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/loans',
  tags: ['Loans'],
  summary: 'Disburse a new loan (monthly or daily)',
  security: bearerAuth,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createLoanSchema } },
    },
  },
  responses: {
    201: {
      description: 'Loan created',
      content: { 'application/json': { schema: createSuccessResponse(z.union([monthlyLoanDetailResponseSchema, dailyLoanDetailResponseSchema])) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/loans',
  tags: ['Loans'],
  summary: 'List loans with filters and pagination',
  security: bearerAuth,
  request: {
    query: listLoansQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of loans',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(loanResponseSchema),
            pagination: paginationSchema,
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
  },
});

registry.registerPath({
  method: 'get',
  path: '/loans/{id}',
  tags: ['Loans'],
  summary: 'Get loan detail with computed fields',
  security: bearerAuth,
  request: {
    params: loanIdParamSchema,
  },
  responses: {
    200: {
      description: 'Loan detail',
      content: { 'application/json': { schema: createSuccessResponse(z.union([monthlyLoanDetailResponseSchema, dailyLoanDetailResponseSchema])) } },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/loans/{id}/transactions',
  tags: ['Loans'],
  summary: 'List transactions for a loan',
  security: bearerAuth,
  request: {
    params: loanIdParamSchema,
    query: listLoanTransactionsQuerySchema,
  },
  responses: {
    200: {
      description: 'Paginated list of loan transactions',
      content: {
        'application/json': {
          schema: z.object({
            success: z.literal(true),
            data: z.array(loanTransactionResponseSchema),
            pagination: paginationSchema,
          }),
        },
      },
    },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/loans/{id}/payment-status',
  tags: ['Loans'],
  summary: 'Get payment status for a loan',
  security: bearerAuth,
  request: {
    params: loanIdParamSchema,
  },
  responses: {
    200: {
      description: 'Payment status',
      content: { 'application/json': { schema: createSuccessResponse(z.union([paymentStatusResponseSchema, dailyPaymentStatusResponseSchema])) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'patch',
  path: '/loans/{id}/close',
  tags: ['Loans'],
  summary: 'Close a fully settled loan',
  security: bearerAuth,
  request: {
    params: loanIdParamSchema,
  },
  responses: {
    200: {
      description: 'Loan closed',
      content: { 'application/json': { schema: createSuccessResponse(z.union([monthlyLoanDetailResponseSchema, dailyLoanDetailResponseSchema])) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
  },
});

// ─── Transactions Routes ────────────────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/transactions',
  tags: ['Transactions'],
  summary: 'Record a transaction (interest payment, principal return, or daily collection)',
  security: bearerAuth,
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createTransactionSchema } },
    },
  },
  responses: {
    201: {
      description: 'Transaction(s) created',
      content: { 'application/json': { schema: createSuccessResponse(z.array(transactionResponseSchema)) } },
    },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: errorResponses[409],
  },
});
