import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import Decimal from 'decimal.js';
import { errorHandler } from './middleware/error-handler.js';
import { config } from './config/index.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import customersRoutes from './routes/customers.routes.js';
import loansRoutes from './routes/loans.routes.js';
import transactionsRoutes from './routes/transactions.routes.js';
import penaltiesRoutes from './routes/penalties.routes.js';
import docsRoutes from './routes/docs.routes.js';

// Configure Decimal.js rounding globally before any financial logic executes.
// ROUND_HALF_UP is standard in finance. This affects all Decimal operations app-wide.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const app = express();

// Core middleware
app.use(cors());
app.use(express.json());

// Health check (raw response — not wrapped in envelope, it's an infra probe)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// API docs (dev/test only)
if (config.isDev || config.isTest) {
  app.use('/api-docs', docsRoutes);
}

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', usersRoutes);
app.use('/api/v1/customers', customersRoutes);
app.use('/api/v1/loans', loansRoutes);
app.use('/api/v1/transactions', transactionsRoutes);
app.use('/api/v1/penalties', penaltiesRoutes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
