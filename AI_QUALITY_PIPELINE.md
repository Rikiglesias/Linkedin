# AI Quality Pipeline

## Objective
- Validate invite/message/sentiment behavior on a fixed dataset.
- Track operational quality with measurable indicators.
- Compare A/B variants with statistical significance.

## Data Model
- `ai_validation_samples`: validation dataset (`invite`, `message`, `sentiment`).
- `ai_validation_runs`: run metadata and summary.
- `ai_validation_results`: per-sample output, similarity, match/fail.
- Existing runtime stats:
  - `ab_variant_stats` for acceptance/reply metrics by variant.
  - `lead_intents` + `leads.status` for sentiment false-positive tracking.

## Runbook
1. Run validation + quality snapshot:
```bash
npm run ai:quality
```
2. Run from CLI without validation (snapshot only):
```bash
npm start -- ai-quality --days 30
```
3. Force validation from CLI:
```bash
npm start -- ai-quality --days 30 --run
```

## API
- `GET /api/ai/quality?days=30`
- `POST /api/ai/quality/run`

## Key Metrics
- `intentFalsePositiveRate`: positive/question intents that ended in negative operational outcomes.
- `variants[*].acceptanceRate`, `variants[*].replyRate`
- `comparisons[*]`: baseline vs candidate with `pValue` and `significant`.

## Config
- `AI_QUALITY_MIN_SAMPLE_SIZE`
- `AI_QUALITY_SIGNIFICANCE_ALPHA`
- `AI_VALIDATION_AUTO_SEED_ENABLED`

