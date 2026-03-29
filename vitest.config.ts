import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['src/tests/**/*.vitest.ts'],
        exclude: [],
        testTimeout: 30_000,
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: [
                'src/tests/**',
                'src/frontend/**',
                'src/scripts/**',
                'src/cli/**',
                'src/types/**',
            ],
            reporter: ['text', 'text-summary', 'lcov'],
            reportsDirectory: './coverage',
        },
    },
});
