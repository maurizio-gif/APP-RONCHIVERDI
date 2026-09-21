-- Restringe "rinnovato" (abbonamenti_scadenze, vedi
-- 2026-09-21-abbonamenti-scadenze.sql): non più "in qualunque momento dopo
-- la scadenza", ma entro 30 giorni da essa. Nato per il grafico "Andamento
-- rinnovi" (quanto siamo bravi a far rinnovare in fretta, non solo
-- prima o poi) — diventata la definizione unica: lo stesso "Rinnovato"
-- deve voler dire la stessa cosa dovunque compaia in questo pannello (il
-- badge del report scadenze compreso), altrimenti due punti della stessa
-- pagina racconterebbero numeri che sembrano contraddirsi.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-scadenze.sql.

create or replace view public.abbonamenti_scadenze as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	a.abbonamento,
	m.gruppo_id,
	a.data_inizio,
	a.data_fine,
	a.totale,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	exists (
		select 1
		from public.abbonamenti r
		left join public.abbonamenti_mappatura mr on mr.prodotto = r.abbonamento
		where r.persona_id = a.persona_id
			and r.cancellato_il is null
			and r.id <> a.id
			and r.data_inizio between a.data_fine and (a.data_fine + 30)
			and mr.gruppo_id is not distinct from m.gruppo_id
	) as rinnovato
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
where a.cancellato_il is null
	and a.data_fine is not null
	and a.persona_id is not null;

comment on view public.abbonamenti_scadenze is
	'Una riga per ogni vendita non cancellata con data_fine, con persona e gruppo, più "rinnovato": esiste un altro abbonamento non cancellato della stessa persona, stesso gruppo (gruppo_id compreso il caso "entrambi non categorizzati"), con data_inizio entro 30 giorni dalla scadenza di questa riga (compreso lo stesso giorno). Filtrare per data_fine per il report di /dashboard/abbonamenti/scadenze — senza filtro scansiona tutta la tabella. Un mese recente può risultare sottostimato: se la scadenza è a meno di 30 giorni da oggi, la finestra di rinnovo non si è ancora chiusa.';

-- abbonamenti_scadenze_mensili è un `create or replace view ... select ...
-- from abbonamenti_scadenze`: eredita la nuova definizione di "rinnovato"
-- automaticamente, senza bisogno di essere toccata.
