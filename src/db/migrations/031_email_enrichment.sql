-- Aggiunge campi estratti dai servizi di Enrichment (Dropcontact/Hunter/Apollo)
-- I campi sono gestiti a nullable per supportare logiche fault-tolerant.
ALTER TABLE leads ADD COLUMN email TEXT DEFAULT NULL;
ALTER TABLE leads ADD COLUMN phone TEXT DEFAULT NULL;
