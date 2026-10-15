process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-please-change-0000';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-please-change-0000';
process.env.DATABASE_URL ??= 'postgresql://qennect:qennect@localhost:5432/qennect_chat_test';
process.env.REDIS_URL ??= 'redis://localhost:6379/1';
