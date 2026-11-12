-- Segnalazioni dei soci: il collegamento all'anagrafica.
--
-- Il socio che segnala si cerca nell'anagrafica (public.persone, soci Info4U
-- compresi) invece di scriverlo a mano: così le segnalazioni di una stessa
-- persona si raccolgono sotto un solo nome, e dalla segnalazione si apre la
-- sua scheda. `socio_nome` resta: per chi non è in anagrafica (un ospite, «le
-- socie della lezione») e come copia del nome al momento della segnalazione.
--
-- Aggiunge solo una colonna facoltativa: le segnalazioni già registrate non
-- cambiano.

alter table public.segnalazioni
	add column if not exists persona_id uuid references public.persone(id) on delete set null;

create index if not exists segnalazioni_persona_idx on public.segnalazioni (persona_id) where persona_id is not null;
