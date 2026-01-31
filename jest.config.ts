import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      useESM: true,
      diagnostics: {
        ignoreCodes: [151002],
      },
    }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/tests/helpers/setup.ts'],
  clearMocks: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
};

export default config;
