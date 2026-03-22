/**
 * proxy/types.ts — Tipi condivisi per il sistema proxy.
 * Estratti da proxyManager.ts per rompere circular dependency
 * proxyManager.ts ↔ proxy/proxyQualityChecker.ts
 */

import type { ProxyType } from '../config';

export interface ProxyConfig {
    server: string;
    username?: string;
    password?: string;
    type?: ProxyType;
}

export interface GetProxyChainOptions {
    preferredType?: ProxyType;
    forceMobile?: boolean;
}
