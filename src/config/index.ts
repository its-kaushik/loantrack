import 'dotenv/config';
import { cleanEnv, str, port, num } from 'envalid';

const env = cleanEnv(process.env, {
  DATABASE_URL: str({ desc: 'PostgreSQL connection string' }),
  JWT_SECRET: str({ desc: 'Secret key for signing JWT access tokens' }),
  JWT_REFRESH_SECRET: str({ desc: 'Secret key for signing JWT refresh tokens' }),
  JWT_ACCESS_EXPIRY: str({ default: '15m', desc: 'Access token expiry duration' }),
  JWT_REFRESH_EXPIRY_DAYS: num({ default: 7, desc: 'Refresh token expiry in days' }),
  PORT: port({ default: 3000 }),
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  BCRYPT_ROUNDS: num({ default: 12, desc: 'bcrypt hashing rounds (minimum 12)' }),
});

export const config = {
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  isProduction: env.isProduction,
  isTest: env.isTest,
  isDev: env.isDevelopment,

  database: {
    url: env.DATABASE_URL,
  },

  jwt: {
    secret: env.JWT_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessExpiry: env.JWT_ACCESS_EXPIRY,
    refreshExpiryDays: env.JWT_REFRESH_EXPIRY_DAYS,
  },

  bcrypt: {
    rounds: env.BCRYPT_ROUNDS,
  },
} as const;
