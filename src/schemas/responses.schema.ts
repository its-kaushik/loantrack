import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export function createSuccessResponse<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

export const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string().openapi({ example: 'Validation failed' }),
      details: z.array(z.string()).openapi({ example: ['Field is required'] }),
    }),
  })
  .openapi('ErrorResponse');

function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': { schema: errorResponseSchema },
    },
  };
}

export const errorResponses = {
  400: errorResponse('Bad request — validation failed'),
  401: errorResponse('Unauthorized — missing or invalid token'),
  403: errorResponse('Forbidden — insufficient permissions'),
  404: errorResponse('Not found'),
  409: errorResponse('Conflict — resource already exists'),
  500: errorResponse('Internal server error'),
} as const;
