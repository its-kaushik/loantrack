import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { Decimal } from 'decimal.js';
import { errorHandler } from './middleware/error-handler.js';
import { config } from './config/index.js';
import { apiLimiter, authLimiter } from './middleware/rate-limit.js';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';
import customersRoutes from './routes/customers.routes.js';
import loansRoutes from './routes/loans.routes.js';
import transactionsRoutes from './routes/transactions.routes.js';
import penaltiesRoutes from './routes/penalties.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import reportsRoutes from './routes/reports.routes.js';
import expensesRoutes from './routes/expenses.routes.js';
import fundRoutes from './routes/fund.routes.js';
import platformRoutes from './routes/platform.routes.js';
import docsRoutes from './routes/docs.routes.js';

// Configure Decimal.js rounding globally before any financial logic executes.
// ROUND_HALF_UP is standard in finance. This affects all Decimal operations app-wide.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const app = express();

// Trust the first reverse proxy (Railway, AWS ALB, etc.) so that req.ip
// reflects the real client IP from X-Forwarded-For, not the proxy's IP.
app.set('trust proxy', 1);

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// CORS
app.use(
  cors({
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  }),
);

// Body parser with size limit
app.use(express.json({ limit: '1mb' }));

// Rate limiting
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/refresh', authLimiter);
app.use('/api/v1/', apiLimiter);

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
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/reports', reportsRoutes);
app.use('/api/v1/expenses', expensesRoutes);
app.use('/api/v1/fund', fundRoutes);
app.use('/api/v1/platform', platformRoutes);

// Global error handler (must be last)
app.use(errorHandler);

export default app;
