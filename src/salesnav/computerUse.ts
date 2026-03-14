/**
 * salesnav/computerUse.ts
 * ─────────────────────────────────────────────────────────────────
 * GPT-5.4 Computer Use integration via OpenAI Responses API.
 *
 * Instead of fragile CSS selectors, this module sends screenshots to GPT-5.4
 * and receives structured actions (click, type, scroll, keypress) that are
 * executed via Playwright. The model sees the screen, decides what to do,
 * and we execute it — like a human operator.
 *
 * Flow: screenshot → GPT-5.4 → actions → execute → screenshot → repeat
 */

import type { Page } from 'playwright';
import { fetchWithRetryPolicy } from '../core/integrationPolicy';
import { logInfo, logWarn } from '../telemetry/logger';
import { humanMouseMoveToCoords, pulseVisualCursorOverlay, pauseInputBlock, resumeInputBlock } from '../browser/humanBehavior';
import { humanDelay } from '../browser';

// ── Types ──────────────────────────────────────────────────────

interface ComputerAction {
    type: 'click' | 'double_click' | 'scroll' | 'type' | 'keypress' | 'wait' | 'drag' | 'move' | 'screenshot';
    x?: number;
    y?: number;
    button?: 'left' | 'right' | 'middle';
    text?: string;
    keys?: string[];
    scroll_x?: number;
    scroll_y?: number;
}

interface ComputerCallOutput {
    type: 'computer_call';
    call_id: string;
    actions: ComputerAction[];
    status?: string;
}

interface ResponseMessage {
    type: 'message';
    content: Array<{ type: string; text?: string }>;
}

type ResponseOutputItem = ComputerCallOutput | ResponseMessage;

interface ResponsesApiResponse {
    id: string;
    status: string;
    output: ResponseOutputItem[];
    usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
    };
}

export interface ComputerUseResult {
    success: boolean;
    turns: number;
    totalActions: number;
    lastResponseText?: string;
    error?: string;
}

// ── Config ──────────────────────────────────────────────────────

function getApiKey(): string {
    const { config } = require('../config') as typeof import('../config');
    return config.openaiApiKey;
}

function getModel(): string {
    const { config } = require('../config') as typeof import('../config');
    return config.visionModelOpenai || 'gpt-5.4';
}

// ── Core API call ──────────────────────────────────────────────

async function callResponsesApi(body: Record<string, unknown>): Promise<ResponsesApiResponse> {
    const apiKey = getApiKey();
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY non configurata — computer use richiede GPT-5.4');
    }

    const response = await fetchWithRetryPolicy(
        'https://api.openai.com/v1/responses',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        },
        {
            integration: 'computer_use.openai',
            circuitKey: 'computer_use.openai.api',
            timeoutMs: 90_000,
            maxAttempts: 2,
        },
    );

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Computer Use API error: HTTP ${response.status} ${response.statusText} — ${errorText.substring(0, 300)}`);
    }

    return (await response.json()) as ResponsesApiResponse;
}

// ── Screenshot capture ─────────────────────────────────────────

async function captureScreenshot(page: Page): Promise<string> {
    const buffer = await page.screenshot({ type: 'png', timeout: 10_000 });
    return buffer.toString('base64');
}

// ── Action execution ───────────────────────────────────────────

async function executeAction(page: Page, action: ComputerAction): Promise<void> {
    switch (action.type) {
        case 'click': {
            const x = action.x ?? 0;
            const y = action.y ?? 0;
            await humanMouseMoveToCoords(page, x, y);
            await pulseVisualCursorOverlay(page);
            await pauseInputBlock(page);
            await page.mouse.click(x, y, {
                button: action.button ?? 'left',
                delay: 40 + Math.floor(Math.random() * 60),
            });
            await resumeInputBlock(page);
            break;
        }

        case 'double_click': {
            const x = action.x ?? 0;
            const y = action.y ?? 0;
            await humanMouseMoveToCoords(page, x, y);
            await pauseInputBlock(page);
            await page.mouse.dblclick(x, y, { delay: 40 + Math.floor(Math.random() * 40) });
            await resumeInputBlock(page);
            break;
        }

        case 'move': {
            await humanMouseMoveToCoords(page, action.x ?? 0, action.y ?? 0);
            break;
        }

        case 'type': {
            if (action.text) {
                await pauseInputBlock(page);
                await page.keyboard.type(action.text, { delay: 25 + Math.floor(Math.random() * 30) });
                await resumeInputBlock(page);
            }
            break;
        }

        case 'keypress': {
            if (action.keys && action.keys.length > 0) {
                await pauseInputBlock(page);
                for (const key of action.keys) {
                    await page.keyboard.press(key);
                    await page.waitForTimeout(50 + Math.floor(Math.random() * 50));
                }
                await resumeInputBlock(page);
            }
            break;
        }

        case 'scroll': {
            const sx = action.scroll_x ?? 0;
            const sy = action.scroll_y ?? 0;
            if (action.x !== undefined && action.y !== undefined) {
                await humanMouseMoveToCoords(page, action.x, action.y);
            }
            await page.mouse.wheel(sx, sy);
            break;
        }

        case 'wait': {
            await page.waitForTimeout(1000 + Math.floor(Math.random() * 500));
            break;
        }

        case 'drag': {
            // drag: move to start → mousedown → move to end → mouseup
            // The API may provide startX/startY and x/y as the end
            if (action.x !== undefined && action.y !== undefined) {
                await page.mouse.down();
                await humanMouseMoveToCoords(page, action.x, action.y);
                await page.mouse.up();
            }
            break;
        }

        case 'screenshot': {
            // Model is requesting a fresh screenshot — no action needed,
            // the loop will capture one after executing all actions.
            break;
        }

        default:
            console.warn(`[COMPUTER USE] Azione sconosciuta: ${(action as ComputerAction).type}`);
    }
}

// ── Main loop ──────────────────────────────────────────────────

/**
 * Execute a task using GPT-5.4 Computer Use.
 *
 * The model receives a task description + initial screenshot, returns actions
 * to execute, and continues the loop until the task is complete or maxTurns
 * is reached.
 *
 * @param page - Playwright page instance
 * @param task - Natural language description of what to do
 * @param options - Configuration options
 * @returns Result with success status and stats
 */
export async function computerUseTask(
    page: Page,
    task: string,
    options?: {
        maxTurns?: number;
        systemPrompt?: string;
        onAction?: (action: ComputerAction, index: number) => void;
    },
): Promise<ComputerUseResult> {
    const maxTurns = options?.maxTurns ?? 15;
    const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
    let totalActions = 0;
    let turn = 0;
    let previousResponseId: string | null = null;
    let lastResponseText: string | undefined;

    const systemPrompt = options?.systemPrompt ??
        `You are controlling a browser showing LinkedIn Sales Navigator. ` +
        `The viewport is ${viewport.width}x${viewport.height}. ` +
        `Execute the task precisely. If you see an error or unexpected state, stop and explain.`;

    console.log(`[COMPUTER USE] Task: "${task.substring(0, 80)}..." (max ${maxTurns} turns)`);

    // Computer Use richiede modelli specifici (es. computer-use-preview).
    // GPT-5.4 e altri modelli vision generici non lo supportano — skip silenzioso.
    const model = getModel();
    const COMPUTER_USE_COMPATIBLE_MODELS = ['computer-use-preview', 'gpt-4o-computer-use'];
    if (!COMPUTER_USE_COMPATIBLE_MODELS.some((m) => model.includes(m))) {
        return {
            success: false,
            turns: 0,
            totalActions: 0,
            error: `Modello "${model}" non supporta Computer Use — usa fallback DOM`,
        };
    }

    try {
        // Initial request with screenshot
        const screenshot = await captureScreenshot(page);

        let response = await callResponsesApi({
            model: getModel(),
            tools: [{
                type: 'computer_use_preview',
                display_width: viewport.width,
                display_height: viewport.height,
                environment: 'browser',
            }],
            instructions: systemPrompt,
            input: [
                {
                    role: 'user',
                    content: [
                        { type: 'input_text', text: task },
                        {
                            type: 'input_image',
                            image_url: `data:image/png;base64,${screenshot}`,
                        },
                    ],
                },
            ],
            truncation: 'auto',
        });

        previousResponseId = response.id;

        if (response.usage) {
            void logInfo('computer_use.usage', {
                turn: 0,
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
            });
        }

        // Loop: execute actions → screenshot → send back
        while (turn < maxTurns) {
            turn++;

            // Find computer_call in output
            const computerCall = response.output.find(
                (item): item is ComputerCallOutput => item.type === 'computer_call',
            );

            // If no computer_call, check for text message (task complete or error)
            if (!computerCall) {
                const message = response.output.find(
                    (item): item is ResponseMessage => item.type === 'message',
                );
                if (message) {
                    lastResponseText = message.content
                        .filter(c => c.type === 'output_text' && c.text)
                        .map(c => c.text ?? '')
                        .join('\n');
                    console.log(`[COMPUTER USE] Modello risponde: "${lastResponseText.substring(0, 120)}"`);
                }
                // No more actions — task is done
                break;
            }

            // Execute all actions in sequence
            console.log(`[COMPUTER USE] Turn ${turn}: ${computerCall.actions.length} azioni`);
            for (let i = 0; i < computerCall.actions.length; i++) {
                const action = computerCall.actions[i];
                const actionDesc = action.type === 'click' ? `click(${action.x},${action.y})`
                    : action.type === 'type' ? `type("${action.text?.substring(0, 30)}")`
                        : action.type === 'scroll' ? `scroll(${action.scroll_x},${action.scroll_y})`
                            : action.type === 'keypress' ? `keypress(${action.keys?.join('+')})`
                                : action.type;
                console.log(`  [${i + 1}/${computerCall.actions.length}] ${actionDesc}`);

                options?.onAction?.(action, i);
                await executeAction(page, action);
                totalActions++;

                // Small delay between actions for page to react
                if (i < computerCall.actions.length - 1) {
                    await page.waitForTimeout(150 + Math.floor(Math.random() * 200));
                }
            }

            // Wait for page to settle after actions
            await humanDelay(page, 400, 800);

            // Capture new screenshot and send it back
            const newScreenshot = await captureScreenshot(page);

            response = await callResponsesApi({
                model: getModel(),
                tools: [{
                    type: 'computer_use_preview',
                    display_width_px: viewport.width,
                    display_height_px: viewport.height,
                    environment: 'browser',
                }],
                previous_response_id: previousResponseId,
                input: [
                    {
                        type: 'computer_call_output',
                        call_id: computerCall.call_id,
                        output: {
                            type: 'computer_screenshot',
                            image_url: `data:image/png;base64,${newScreenshot}`,
                        },
                    },
                ],
                truncation: 'auto',
            });

            previousResponseId = response.id;

            if (response.usage) {
                void logInfo('computer_use.usage', {
                    turn,
                    inputTokens: response.usage.input_tokens,
                    outputTokens: response.usage.output_tokens,
                });
            }
        }

        if (turn >= maxTurns) {
            console.warn(`[COMPUTER USE] Max turns (${maxTurns}) raggiunto`);
        }

        console.log(`[COMPUTER USE] Completato: ${turn} turns, ${totalActions} azioni totali`);

        return {
            success: true,
            turns: turn,
            totalActions,
            lastResponseText,
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[COMPUTER USE] Errore: ${msg}`);
        void logWarn('computer_use.error', { error: msg, turn, totalActions });
        return {
            success: false,
            turns: turn,
            totalActions,
            error: msg,
        };
    }
}

/**
 * Convenience: use Computer Use to select a specific list in the "Save to list" dialog.
 * This is the primary strategy — GPT-5.4 sees the dialog and clicks the right list.
 */
export async function computerUseSelectList(
    page: Page,
    targetListName: string,
): Promise<ComputerUseResult> {
    return computerUseTask(
        page,
        `You are looking at a LinkedIn Sales Navigator "Save to list" dialog. ` +
        `Find and click EXACTLY on the list named "${targetListName}". ` +
        `If you see a search field in the dialog, first type the list name to filter results. ` +
        `After clicking the correct list, if there is a "Save" or "Salva" confirmation button, click it. ` +
        `IMPORTANT: Do NOT click any other list. The exact name is: "${targetListName}". ` +
        `If you cannot find this exact list name, stop and explain what lists you see instead.`,
        {
            maxTurns: 8,
            systemPrompt:
                `You are a precise browser automation agent controlling LinkedIn Sales Navigator. ` +
                `The viewport matches the screenshot dimensions. Click coordinates must be accurate. ` +
                `You MUST select the EXACT list named "${targetListName}" — no other list. ` +
                `If the list is not visible, scroll down in the dialog to find it. ` +
                `After selecting, verify the correct list is highlighted before confirming.`,
        },
    );
}

/**
 * Convenience: use Computer Use to click "Select All" on a search results page.
 */
export async function computerUseSelectAll(
    page: Page,
): Promise<ComputerUseResult> {
    return computerUseTask(
        page,
        `You are looking at a LinkedIn Sales Navigator search results page. ` +
        `Find and click the "Select all" or "Seleziona tutto" checkbox to select all leads on this page. ` +
        `It is usually a checkbox at the top of the results list.`,
        { maxTurns: 4 },
    );
}

/**
 * Convenience: use Computer Use to click "Save to list" button.
 */
export async function computerUseSaveToList(
    page: Page,
): Promise<ComputerUseResult> {
    return computerUseTask(
        page,
        `You are looking at a LinkedIn Sales Navigator search results page with leads selected. ` +
        `Find and click the "Save to list" or "Salva nell'elenco" button. ` +
        `It should be visible at the top of the results after selecting leads.`,
        { maxTurns: 4 },
    );
}
