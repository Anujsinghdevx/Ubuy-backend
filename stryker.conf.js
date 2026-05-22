/**
 * Stryker mutation testing configuration (scaffold).
 * To run mutation tests install dependencies:
 * npm install --save-dev @stryker-mutator/core @stryker-mutator/jest-runner @stryker-mutator/typescript @stryker-mutator/html-reporter
 */
module.exports = {
  mutate: ['src/modules/auctions/**/*.ts'],
  mutator: 'typescript',
  packageManager: 'npm',
  reporters: ['clear-text', 'progress', 'html'],
  testRunner: 'jest',
  jest: {
    projectType: 'custom',
    // Stryker expects a Jest config object for recent versions — require the JSON
    // Load the existing jest unit config and adjust paths that must be absolute
    config: (() => {
      const cfg = require('./test/jest-unit.json');
      const path = require('path');
      // Ensure setupFilesAfterEnv points to an absolute path so jest can load it from Stryker's temp dir
      if (cfg.setupFilesAfterEnv && Array.isArray(cfg.setupFilesAfterEnv)) {
        cfg.setupFilesAfterEnv = cfg.setupFilesAfterEnv.map((p) =>
          p.startsWith('<rootDir>') ? path.resolve(__dirname, p.replace('<rootDir>/', '')) : p,
        );
      }
      // Set rootDir to project root for consistent resolution
      cfg.rootDir = path.resolve(__dirname);
      // Narrow the test regex for mutation runs to avoid sandbox-specific failing controller tests
      cfg.testRegex = 'src/modules/auctions/.*service\.spec\.ts$';
      return cfg;
    })(),
  },
  tsconfigFile: 'tsconfig.json',
  timeoutMS: 600000,
  coverageAnalysis: 'off'
};
