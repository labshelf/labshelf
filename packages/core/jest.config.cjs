module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Agents read this output: print failures and totals only, and hide console output.
  reporters: [['summary', { summaryThreshold: 0 }]],
  silent: true,
  // DOM tests opt into jsdom per file; they still resolve packages such as yaml to their Node (CommonJS) builds.
  testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
  // TypeScript 7 ships only the native compiler, without the JS API ts-jest
  // needs, so tests compile with the aliased TypeScript 6 package instead
  // (same arrangement as packages/vscode; see the root .pnpmfile.cjs).
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js', tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // Tests run against source, not the built package.
    '^@labshelf/core$': '<rootDir>/src/index.ts',
    // pdfjs-dist uses import.meta.url (ESM-only) and cannot be loaded in Jest CJS mode.
    'pdfjs-dist/legacy/build/pdf\\.worker\\.mjs': '<rootDir>/__mocks__/pdfjs-worker-legacy.js',
    'pdfjs-dist/legacy/build/pdf\\.mjs': '<rootDir>/__mocks__/pdfjs-dist-legacy.js',
    // Remap .js extensions in relative imports so ts-jest resolves the .ts files.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.ts'],
  testTimeout: 60000,
};
