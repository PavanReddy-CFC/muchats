/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  moduleNameMapper: {
    '^@qennect/shared-types$': '<rootDir>/../shared-types/src/index.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/client/__mocks__/asyncStorage.ts',
  },
};
