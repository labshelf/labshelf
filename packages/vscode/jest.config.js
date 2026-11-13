const path = require('path');

// Core subpath exports (core package.json "exports") that the extension imports. Neither jest's resolver
// nor ts-jest's module resolution reads the exports map, so both get the paths here.
const coreSubpathFiles = {
  '@labshelf/core/deckWorkspace': '../core/src/decks/dom/workspace/index.ts',
  '@labshelf/core/sourceEditor': '../core/src/writing/dom/sourceEditor/index.ts',
  '@labshelf/core/consult': '../core/src/writing/consult/dom/index.ts',
};
const coreSubpaths = Object.fromEntries(
  Object.entries(coreSubpathFiles).map(([name, file]) => [name, [path.resolve(__dirname, file)]]),
);

module.exports = {
  preset: 'ts-jest',
  // At most 3 workers, each restarted past 1 GB, so a full run stays within a few GB of RAM.
  maxWorkers: 3,
  workerIdleMemoryLimit: '1GB',
  testEnvironment: 'node',
  // Agents read this output: print failures and totals only, and hide console output.
  reporters: [['summary', { summaryThreshold: 0 }]],
  silent: true,
  // TypeScript 7 ships only the native compiler, without the JS API ts-jest
  // needs, so tests compile with the aliased TypeScript 6 package instead.
  // See also .pnpmfile.cjs, which covers ts-jest's own require("typescript").
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js', tsconfig: { paths: coreSubpaths } }],
  },
  roots: ['<rootDir>/__tests__', '<rootDir>/src', '<rootDir>/../core/src'],
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
    ...Object.fromEntries(Object.entries(coreSubpaths).map(([name, [file]]) => [`^${name}$`, file])),
    // Remap .js extensions in relative imports to allow ts-jest to resolve .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 60000,
};
