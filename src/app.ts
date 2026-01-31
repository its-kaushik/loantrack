import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import Decimal from 'decimal.js';
import { errorHandler } from './middleware/error-handler.js';

// Configure Decimal.js rounding globally before any financial logic executes.
// ROUND_HALF_UP is standard in finance. This affects all Decimal operations app-wide.
Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

const app = express();

// Core middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler (must be last)
app.use(errorHandler);

export default app;
