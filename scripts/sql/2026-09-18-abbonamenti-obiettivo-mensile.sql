-- L'obiettivo di fatturato del mese per gli abbonamenti: come
-- obiettivi_giornalieri per il Core Manager (vedi
-- 2026-09-17-triple-pack-e-obiettivi-giornalieri.sql), non si deriva da
-- nessun dato — è una decisione della direzione — quindi vive nella sua
-- tabella, modificabile da /dashboard/abbonamenti.

create table if not exists public.abbonamenti_obiettivi_mensili (
	mese date primary key,
	goal numeric(12,2) not null,
	aggiornato_da text,
	aggiornato_il timestamptz not null default now()
);
