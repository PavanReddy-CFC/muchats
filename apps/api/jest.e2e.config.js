/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/e2e/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@qennect/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
  setupFilesAfterEnv: ['<rootDir>/test/e2e/setup.ts'],
  testTimeout: 30000,
};
