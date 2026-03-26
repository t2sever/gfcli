const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 10000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js'],
      exclude: ['lib/windows/**'],
      reporter: ['text', 'lcov', 'html'],
    },
    server: {
      deps: {
        inline: ['change-case'],
      },
    },
  },
});
