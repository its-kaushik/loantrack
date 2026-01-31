import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';

/** Strict rate limiter for auth endpoints (login, refresh). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.isTest ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      details: [],
    },
  },
});

/** General rate limiter for all API endpoints. */
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.isTest ? 10_000 : config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      details: [],
    },
  },
});
