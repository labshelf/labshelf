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
  // needs, so tests compile with the aliased TypeScript 6 package instead
  // (same arrangement as packages/vscode; see the root .pnpmfile.cjs).
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js', tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  roots: ['<rootDir>/__tests__', '<rootDir>/src', '<rootDir>/../core/src'],
  setupFiles: ['<rootDir>/__tests__/support/mockWebextensionPolyfill.ts', '<rootDir>/__tests__/support/webPlatformGlobals.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/libraryUi/prefs.ts',
    'src/libraryUi/folderHash.ts',
    'src/storage/records.ts',
    'src/capture/**/*.ts',
    'src/content/identifiers.ts',
    'src/popup/render.ts',
    'src/libraryUi/readerPreview.ts',
    // Injected into pages or driving real tabs: verified in a browser, not in node.
    '!src/capture/pageProbe.ts',
    '!src/capture/tabFetch.ts',
  ],
  coverageThreshold: { global: { branches: 50, functions: 50, lines: 50, statements: 50 } },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
