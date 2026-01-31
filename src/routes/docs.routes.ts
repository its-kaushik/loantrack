import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry, openApiConfig } from '../config/openapi.js';

// Side-effect import: registers all paths on the shared registry
import '../config/openapi-routes.js';

const router = Router();

function generateDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument(openApiConfig);
}

const spec = generateDocument();

router.get('/swagger.json', (_req, res) => {
  res.json(spec);
});

router.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(spec, {
    swaggerOptions: {
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
  }),
);

export default router;
