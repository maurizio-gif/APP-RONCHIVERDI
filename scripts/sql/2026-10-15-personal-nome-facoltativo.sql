-- Le sedute importate dai registri cartacei dei trainer portano spesso il
-- solo cognome («SERRAO», «BELLUZZI»): il cognome resta obbligatorio, il nome
-- no. Il responsabile le completa da Check personal, scegliendo il cliente
-- con Modifica.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-10-15-personal-training.sql.
-- Già applicata in produzione il 15 ottobre 2026.

alter table public.personal_sessioni drop constraint if exists personal_sessioni_cliente_check;
alter table public.personal_sessioni add constraint personal_sessioni_cliente_check
	check (nullif(btrim(cliente_cognome), '') is not null);
alter table public.personal_sessioni alter column cliente_nome set default '';
