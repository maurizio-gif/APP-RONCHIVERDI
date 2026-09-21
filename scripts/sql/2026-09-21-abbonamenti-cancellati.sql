-- Una vendita già sincronizzata che poi sparisce da Info4U — un operatore
-- l'annulla/cancella dopo che il giro dei 5 minuti l'ha già scritta su
-- Supabase. Senza questa colonna resterebbe un fantasma per sempre: nessuna
-- query di sync la ripesca più (non esiste nessun ID da confrontare), quindi
-- continuerebbe a contare come vendita reale e — per abbonamenti_attivi_al,
-- vedi 2026-09-21-abbonamenti-attivi.sql — anche come abbonato attivo.
--
-- Colonna e non riga cancellata: si preferisce sapere che qualcosa È STATA
-- una vendita poi annullata in origine, invece di farla sparire anche da
-- qui — stesso principio di data_disdetta/motivo_disdetta, non una DELETE.
-- La riconciliazione che la valorizza vive nello script
-- (sync-abbonamenti.ps1, Confronta-CancellazioniOrigine): periodicamente
-- confronta gli ID delle vendite ancora "aperte" secondo Supabase con quelli
-- che Info4U restituisce davvero in quel momento.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-attivi.sql.

alter table public.abbonamenti
	add column if not exists cancellato_il timestamptz;

comment on column public.abbonamenti.cancellato_il is
	'Valorizzato dalla riconciliazione periodica quando questo source_iscrizione_id non risulta più in AbbonamentiIscrizione su Info4U (cancellato da un operatore dopo il sync). Null in ogni riga scritta o riscritta da un upsert normale, che per definizione legge da una riga che in quel momento esiste ancora in Info4U.';

create index if not exists abbonamenti_cancellato_il_idx
	on public.abbonamenti (cancellato_il)
	where cancellato_il is not null;

-- Una vendita cancellata in origine non è mai un abbonamento attivo,
-- qualunque cosa dicano le sue date.
create or replace function public.abbonamenti_attivi_al(p_data date default current_date)
returns table (gruppo_id uuid, numero_attivi bigint)
language sql
stable
as $$
	select
		m.gruppo_id,
		count(*) as numero_attivi
	from public.abbonamenti a
	left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
	where a.cancellato_il is null
		and a.data_inizio is not null
		and a.data_inizio <= p_data
		and (a.data_fine is null or a.data_fine >= p_data)
	group by m.gruppo_id;
$$;

comment on function public.abbonamenti_attivi_al(date) is
	'Abbonamenti attivi per gruppo in una data qualsiasi (passata o odierna): non cancellato in origine, data_inizio <= p_data, e (data_fine null o >= p_data). Bloccato e disdetta non escludono dal conteggio.';

-- Le altre viste di reportistica (abbonamenti_mensili, abbonamenti_giornalieri,
-- abbonamenti_prodotti, abbonamenti_mensili_lavorati, le viste per canale di
-- 2026-09-21-dashboard-direzionale.sql) escludono cancellato_il a loro volta
-- da 2026-09-21-abbonamenti-cancellati-viste.sql, non da qui: quella
-- migration va eseguita dopo questa.
