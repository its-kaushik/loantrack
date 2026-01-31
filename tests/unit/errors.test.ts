import { AppError } from '../../src/utils/errors';

describe('AppError', () => {
  it('creates a badRequest error', () => {
    const err = AppError.badRequest('Invalid amount');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Invalid amount');
    expect(err.details).toEqual([]);
  });

  it('creates an unauthorized error', () => {
    const err = AppError.unauthorized();
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
  });

  it('creates a forbidden error', () => {
    const err = AppError.forbidden();
    expect(err.code).toBe('FORBIDDEN');
    expect(err.statusCode).toBe(403);
  });

  it('creates a notFound error', () => {
    const err = AppError.notFound('Loan not found');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Loan not found');
  });

  it('creates a conflict error', () => {
    const err = AppError.conflict('Version mismatch');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
  });

  it('creates an internal error', () => {
    const err = AppError.internal();
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('is an instance of Error', () => {
    const err = AppError.badRequest('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
  });

  it('accepts details array', () => {
    const details = [{ field: 'amount', message: 'must be positive' }];
    const err = AppError.badRequest('Validation failed', details);
    expect(err.details).toEqual(details);
  });
});
