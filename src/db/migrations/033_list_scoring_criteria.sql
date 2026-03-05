-- Criteri di scoring personalizzabili per lista/campagna.
-- Se NULL, il lead scorer usa i criteri B2B di default (CEO/Founder = alto, Intern = basso).
ALTER TABLE lead_lists ADD COLUMN scoring_criteria TEXT DEFAULT NULL;
