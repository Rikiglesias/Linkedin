# Plugin SDK minimo

## Struttura richiesta
Ogni plugin deve avere:
- file runtime (`.js` o `.cjs`)
- manifest sibling `<nome>.manifest.json`

Esempio:
- `exampleEngagementBooster.js`
- `exampleEngagementBooster.manifest.json`

## Manifest
Campi obbligatori:
- `name`
- `version`
- `entry`

Campi consigliati:
- `enabled`
- `integritySha256` (sha256 del file plugin)
- `allowedHooks` (hook esplicitamente consentiti)

## Hook supportati
- `onInit`
- `onShutdown`
- `onInviteSent`
- `onInviteAccepted`
- `onMessage`
- `onReplyReceived`
- `onDailyReport`
- `onIdle`

## Config utili
- `PLUGIN_DIR` directory plugin (default: `plugins`)
- `PLUGIN_DIR_ALLOWLIST` root ammessi
- `PLUGIN_ALLOWLIST` allowlist nomi plugin
- `PLUGIN_ALLOW_TS` abilita plugin `.ts` solo in runtime TypeScript

## Smoke test rapido (plugin esempio)
1. Imposta:
   - `PLUGIN_ALLOWLIST=example-engagement-booster`
   - `PLUGIN_EXAMPLE_MARKER_FILE=data/plugin-example.marker.jsonl`
2. Avvia il bot (`run-loop` o comando che inizializza plugin system).
3. Verifica il marker file: deve contenere eventi `onInit`, `onIdle` e `onShutdown`.

