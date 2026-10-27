-- Quando nasce una persona (o le si assegna un source_utente_id), collega a
-- lei le righe dei dati Info4U che la riguardavano già: azioni e pratiche CRM,
-- memo, email, certificati, quote, prenotazioni, corsi, omaggi, ricevute.
--
-- Serve all'import delle persone senza acquisti (sync-abbonamenti.ps1,
-- «persone_senza_acquisti»): quei dati sono arrivati prima, con persona_id
-- nullo e solo source_utente_id, perché `persone` nasceva dalle vendite.
-- Il trigger riempie persona_id appena la scheda esiste, senza altro lavoro
-- nello script. Vedi 2026-10-27-dati-info4u-aggiuntivi.sql.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi PRIMA di
-- lanciare l'import (il file si può rieseguire senza danni). In fondo c'è il
-- riallineamento una tantum per le persone che già esistono.

create or replace function public.info4u_collega_persona_nuova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if new.source_utente_id is null then
		return new;
	end if;

	update public.crm_pratiche set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.crm_memo set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.email_info4u set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.certificati set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.quote_associative set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.prenotazioni_iscrizioni set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.corsi_iscrizioni set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.omaggi_iscrizioni set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	update public.ricevute set persona_id = new.id where source_utente_id = new.source_utente_id and persona_id is null;
	return new;
end;
$$;

drop trigger if exists persone_collega_info4u on public.persone;
create trigger persone_collega_info4u
	after insert or update of source_utente_id on public.persone
	for each row execute function public.info4u_collega_persona_nuova();

-- Una tantum: le persone che esistono già e che hanno righe ancora senza
-- persona_id (arrivate dopo la scheda, o prima del trigger).
select * from public.info4u_riallinea_persone();
