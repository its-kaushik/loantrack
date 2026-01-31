import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

export const openApiConfig = {
  openapi: '3.0.3' as const,
  info: {
    title: 'LoanTrack API',
    version: '1.0.0',
    description:
      'Multi-tenant SaaS platform for loan businesses. All responses follow the envelope format: `{ success, data }` for success and `{ success, error }` for failures.',
  },
  servers: [{ url: '/api/v1', description: 'API v1' }],
};
