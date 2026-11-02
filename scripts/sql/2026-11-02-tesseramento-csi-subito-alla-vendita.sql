-- Tesseramento CSI: parte appena arriva una vendita, non al giro dei 10 minuti.
--
-- La edge function tesseramento-csi lavora già in tempo reale (la risposta di
-- CSI arriva nella stessa chiamata e la riga si aggiorna subito). Quello che
-- aspetta è il cron «nuovi», ogni 10 minuti. Con questo trigger la function
-- viene chiamata appena una vendita entra in `abbonamenti`: una sola chiamata
-- per ogni inserimento (anche se le righe sono tante), solo se l'interruttore
-- `tesseramento_csi` è acceso. Il cron resta come rete di sicurezza.
--
-- CSI non ha un webhook di conferma: il web service ha solo chiamate POST a cui
-- si risponde subito, quindi l'esito è quello della chiamata stessa.
--
-- Si può rieseguire senza danni. Per toglierlo:
--   drop trigger if exists tesseramento_csi_alla_vendita on public.abbonamenti;

create or replace function public.tesseramento_csi_alla_vendita()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	if exists (select 1 from public.automazioni where chiave = 'tesseramento_csi' and attiva) then
		perform public.chiama_edge_function('tesseramento-csi', '?giro=nuovi');
	end if;
	return null;
end;
$$;

revoke all on function public.tesseramento_csi_alla_vendita() from public, anon, authenticated;

drop trigger if exists tesseramento_csi_alla_vendita on public.abbonamenti;
create trigger tesseramento_csi_alla_vendita
	after insert on public.abbonamenti
	for each statement
	execute function public.tesseramento_csi_alla_vendita();
