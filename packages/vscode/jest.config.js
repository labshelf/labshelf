module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Agents read this output: print failures and totals only, and hide console output.
  reporters: [['summary', { summaryThreshold: 0 }]],
  silent: true,
  // TypeScript 7 ships only the native compiler, without the JS API ts-jest
  // needs, so tests compile with the aliased TypeScript 6 package instead.
  // See also .pnpmfile.cjs, which covers ts-jest's own require("typescript").
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js' }],
  },
  roots: ['<rootDir>/__tests__', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/extension.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^vscode$': '<rootDir>/__mocks__/vscode/index.js',
    // Remap .js extensions in relative imports to allow ts-jest to resolve .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 60000,
};
