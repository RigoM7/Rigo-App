import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'], testTimeout: 60000, hookTimeout: 120000, pool: 'forks', fileParallelism: false,
    env: { RIGO_DATA_DIR: 'memory', RIGO_NO_WORKER: '1', RIGO_DEV_MAILBOX: '1', RIGO_TRUST_PROXY: '1', NODE_ENV: 'test' },
  },
});
