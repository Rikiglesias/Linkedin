import { describe, it, expect } from 'vitest';
import { PluginRegistry } from '../plugins/pluginLoader';

describe('PluginRegistry', () => {
    it('count iniziale = 0', () => {
        const registry = new PluginRegistry();
        expect(registry.count).toBe(0);
    });

    it('collectLoopSubTasks senza plugin → array vuoto', () => {
        const registry = new PluginRegistry();
        expect(registry.collectLoopSubTasks()).toEqual([]);
    });

    it('fireIdle senza plugin → non lancia', async () => {
        const registry = new PluginRegistry();
        await expect(registry.fireIdle({ cycle: 1, workflow: 'all', localDate: '2025-01-01' })).resolves.not.toThrow();
    });
});
