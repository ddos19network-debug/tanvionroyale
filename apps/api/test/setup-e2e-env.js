// Environment for e2e runs. No real secrets — the DB is not required to be
// reachable; connection failures are tolerated outside production.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tanvionroyale_test?schema=public';
process.env.OPERATOR_PROVIDER = process.env.OPERATOR_PROVIDER ?? 'mock';
