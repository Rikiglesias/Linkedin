export const NAVIGATION_STRATEGIES = ['search_organic', 'feed_organic', 'direct'] as const;

export type NavigationStrategy = (typeof NAVIGATION_STRATEGIES)[number];

export function normalizeNavigationStrategy(raw: unknown): NavigationStrategy | undefined {
    if (typeof raw !== 'string') {
        return undefined;
    }

    switch (raw.trim().toLowerCase()) {
        case 'search_organic':
        case 'organic_search':
            return 'search_organic';
        case 'feed_organic':
        case 'organic_feed':
            return 'feed_organic';
        case 'direct':
            return 'direct';
        default:
            return undefined;
    }
}
