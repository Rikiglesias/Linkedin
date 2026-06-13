/**
 * browser/human/overlayIds.ts
 * ─────────────────────────────────────────────────────────────────
 * ID DOM randomizzati per gli overlay iniettati dal bot (cursore visuale +
 * input-block + toast). Condivisi da cursorOverlay, inputBlock e removeAllOverlays.
 * Estratto da humanBehavior.ts (A13 split, verbatim). Solo constants — zero comportamento.
 * Gli ID sono randomizzati a runtime (crypto) per non essere hardcoded/rilevabili.
 */

import crypto from 'crypto';

const _cursorHex = crypto.randomBytes(8).toString('hex');

export const VISUAL_CURSOR_STYLE_ID = `__lk_style_${_cursorHex}__`;
export const VISUAL_CURSOR_ELEMENT_ID = `__lk_cursor_${_cursorHex}__`;
export const VISUAL_CURSOR_ROOT_CLASS = `__lk_root_${_cursorHex}__`;
export const INPUT_BLOCK_TOAST_ID = `__lk_toast_${_cursorHex}__`;
export const INPUT_BLOCK_OVERLAY_ID = `__lk_block_${_cursorHex}__`;
