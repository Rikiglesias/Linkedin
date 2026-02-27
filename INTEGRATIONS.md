# Integrations Guide

This bot can export control-plane events from `outbox_events` to one sink at a time:
- `SUPABASE` (table `cp_events`)
- `WEBHOOK` (for n8n, Make, Pipedream, custom middleware)

In addition, when enabled, it can pull campaign configuration from Supabase table `campaigns`
and apply it to local `lead_lists` (control-plane mode).

Set the active sink with:

```env
EVENT_SYNC_SINK=SUPABASE
```

Allowed values: `SUPABASE`, `WEBHOOK`, `NONE`.

## n8n Setup (recommended external orchestrator)

1. Create a workflow with a `Webhook` trigger (POST).
2. Add an auth guard step:
   - verify `x-signature-sha256` if `WEBHOOK_SYNC_SECRET` is configured
   - deduplicate by `x-idempotency-key`
3. Route by `topic` (for example `lead.transition`, `lead.reconciled`, `scheduler.snapshot`, `incident.opened`).
4. Add actions (alerts, CRM update, BI, ticketing, etc.).

Bot `.env` example:

```env
EVENT_SYNC_SINK=WEBHOOK
WEBHOOK_SYNC_ENABLED=true
WEBHOOK_SYNC_URL=https://your-n8n-host/webhook/linkedin-events
WEBHOOK_SYNC_SECRET=replace_with_long_random_secret
WEBHOOK_SYNC_BATCH_SIZE=100
WEBHOOK_SYNC_TIMEOUT_MS=10000
WEBHOOK_SYNC_MAX_RETRIES=8

# Optional: disable Supabase sink if not used
SUPABASE_SYNC_ENABLED=false
```

## Supabase Control Plane (campaign configs)

Enable remote campaign management:

```env
SUPABASE_SYNC_ENABLED=true
SUPABASE_CONTROL_PLANE_ENABLED=true
SUPABASE_CONTROL_PLANE_SYNC_INTERVAL_MS=300000
SUPABASE_CONTROL_PLANE_MAX_CAMPAIGNS=500
```

Source table: `campaigns` with fields:
- `name`
- `is_active`
- `priority`
- `daily_invite_cap`
- `daily_message_cap`

The bot maps those fields into local `lead_lists` (source=`control_plane`).

## Payload format sent to Webhook sink

```json
{
  "topic": "lead.transition",
  "payload": { "leadId": 123, "fromStatus": "READY_INVITE", "toStatus": "INVITED" },
  "idempotencyKey": "lead.transition:123:READY_INVITE:INVITED:invite_sent",
  "createdAt": "2026-02-25 20:10:00"
}
```

Headers:
- `x-idempotency-key`
- `x-event-topic`
- `x-signature-sha256` (only if `WEBHOOK_SYNC_SECRET` is configured)

## Operational commands

- Check sink status: `.\bot.ps1 sync-status`
- Force one sync batch: `.\bot.ps1 sync-run-once`
- Force control-plane pull now: `.\bot.ps1 control-plane-sync --force`

## Notes

- Do not enable stealth/evasion tooling. Keep automation conservative and policy-safe.
- Keep only one active sink in production to avoid configuration ambiguity.
- If both sink toggles are enabled, `EVENT_SYNC_SINK` decides which sink is used.
