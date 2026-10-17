// Runs the website's host tests against core's source, as core's own Jest setup does.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  reporters: [['summary', { summaryThreshold: 0 }]],
  silent: true,
  // TypeScript 7 has no JS API for ts-jest, so tests compile with the aliased TypeScript 6 package (see the root .pnpmfile.cjs).
  transform: { '^.+\\.tsx?$': ['ts-jest', { compiler: 'typescript-js', tsconfig: '<rootDir>/tsconfig.test.json' }] },
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    '^@labshelf/core$': '<rootDir>/../packages/core/src/index.ts',
    // pdfjs-dist is ESM-only; core maps it to the same mocks.
    'pdfjs-dist/legacy/build/pdf\\.worker\\.mjs': '<rootDir>/../packages/core/__mocks__/pdfjs-worker-legacy.js',
    'pdfjs-dist/legacy/build/pdf\\.mjs': '<rootDir>/../packages/core/__mocks__/pdfjs-dist-legacy.js',
    // The build imports stylesheets as text.
    '\\.css$': '<rootDir>/__tests__/support/cssText.cjs',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
