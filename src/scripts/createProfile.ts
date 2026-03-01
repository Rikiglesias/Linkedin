import path from 'path';
import { chromium } from 'playwright';
import { ensureDirectoryPrivate } from '../security/filesystem';

export interface CreateProfileOptions {
    profileDir: string;
    loginUrl: string;
    timeoutSeconds: number;
}

const DEFAULT_PROFILE_DIR = path.resolve(process.cwd(), 'profiles', 'linkedin-profile');
const DEFAULT_LOGIN_URL = 'https://www.linkedin.com/login';

export function resolveProfileDir(rawDir: string | null | undefined): string {
    if (!rawDir || !rawDir.trim()) {
        return DEFAULT_PROFILE_DIR;
    }
    const trimmed = rawDir.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

export async function createPersistentProfile(options: Partial<CreateProfileOptions> = {}): Promise<void> {
    const profileDir = resolveProfileDir(options.profileDir);
    const loginUrl = options.loginUrl?.trim() || DEFAULT_LOGIN_URL;
    const timeoutSeconds = Math.max(60, Math.floor(options.timeoutSeconds ?? 900));

    ensureDirectoryPrivate(profileDir);
    const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        viewport: { width: 1366, height: 768 },
        locale: 'it-IT',
    });

    try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

        console.log(`[PROFILE] Directory: ${profileDir}`);
        console.log(`[PROFILE] Completa il login manualmente entro ${timeoutSeconds}s. I cookie verranno salvati nel profilo.`);

        const timeoutAt = Date.now() + timeoutSeconds * 1000;
        let loginDetected = false;
        while (Date.now() < timeoutAt) {
            const cookies = await context.cookies();
            if (cookies.some((cookie) => cookie.name === 'li_at')) {
                loginDetected = true;
                break;
            }
            await page.waitForTimeout(2500);
        }

        if (loginDetected) {
            console.log('[PROFILE] Login rilevato e profilo persistente aggiornato.');
        } else {
            console.log('[PROFILE] Timeout raggiunto. Il profilo è stato comunque salvato con lo stato corrente.');
        }
    } finally {
        await context.close().catch(() => { });
    }
}
