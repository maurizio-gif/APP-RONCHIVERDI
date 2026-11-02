-- Tesseramenti CSI: il flag «Sistemato su Info4U» dei non tesserabili.
--
-- Chi ha un dato mancante in anagrafica (di solito il luogo di nascita) lo
-- corregge in Info4U; la segreteria spunta qui che l'ha fatto, così si vede
-- chi sta solo aspettando il sync (fino a 20 ore). Il flag non cambia nulla
-- per il tesseramento: quando il dato arriva nel CRM la persona passa da sola
-- in «Da tesserare» e la tessera parte in automatico. Una riga per persona.
--
-- Solo service role, come le altre tabelle dei tesseramenti. Si può
-- rieseguire senza danni.

create table if not exists public.tesseramenti_sistemati (
	persona_id uuid primary key references public.persone (id) on delete cascade,
	sistemato_il timestamptz not null default now(),
	-- L'email dell'operatore che ha messo il flag.
	sistemato_da text not null
);

comment on table public.tesseramenti_sistemati is
	'Non tesserabili segnati dalla segreteria come «sistemati su Info4U» (in attesa del sync). Solo service role.';

alter table public.tesseramenti_sistemati enable row level security;
