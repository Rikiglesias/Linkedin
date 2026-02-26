-- Aggiunta campi per l'Estrazione Profilo (Autopilota AI) e Variante Prompt AI

ALTER TABLE leads ADD COLUMN about TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN experience TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN invite_prompt_variant TEXT DEFAULT NULL;
