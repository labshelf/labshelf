module.exports = {
  preset: 'ts-jest',
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
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/library-page/prefs/**/*.ts',
    'src/library-page/router.ts',
    'src/storage/folderTreeStore.ts',
    'src/capture/**/*.ts',
    'src/content/scholar/scholarParse.ts',
    'src/content/searchHitIds.ts',
    'src/popup/format.ts',
    'src/reader/sidecarChangeNotice.ts',
    'src/storage/idbSidecarPort.ts',
    'src/reader/inPageTransport.ts',
    // Injected into pages or driving real tabs: verified in a browser, not in node.
    '!src/capture/pageProbeContentScript.ts',
    '!src/capture/tab/**',
  ],
  coverageThreshold: { global: { branches: 50, functions: 50, lines: 50, statements: 50 } },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
