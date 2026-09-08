/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts'],
    // This machine can be heavily loaded; the recursive examples are quick
    // in isolation but should never flake on a busy CI box.
    testTimeout: 60_000,
  },
});
