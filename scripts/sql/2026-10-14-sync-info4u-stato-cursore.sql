-- Refresh delle vendite aperte a rate: il punto a cui è arrivato.
--
-- Il refresh rilegge da Info4U tutte le vendite ancora aperte (~28.000, 500
-- righe al minuto: circa un'ora). Fatto tutto in un'esecuzione sola teneva
-- occupato il task per un'ora — e con «non avviare una nuova istanza» le
-- vendite nuove aspettavano la fine — e se l'esecuzione si interrompeva a metà
-- (il 13-14 ottobre 2026 è successo, la macchina è andata in stand-by) il giro
-- dopo ripartiva da zero. Ora ogni esecuzione da 5 minuti ne fa pochi blocchi
-- e ricorda qui dove è arrivata.
--
-- Riga "refresh_aperti_in_corso": valore = quando è iniziato il refresh in
-- corso, cursore = l'ultimo IDIscrizione già riprocessato. cursore nullo vuol
-- dire nessun refresh in corso. Le altre righe lasciano cursore nullo.
--
-- Solo additiva: lo script vecchio non legge né scrive questa colonna.

alter table public.sync_info4u_stato
	add column if not exists cursore bigint;

comment on column public.sync_info4u_stato.cursore is
	'Riga "refresh_aperti_in_corso": ultimo IDIscrizione già riprocessato dal refresh delle vendite aperte in corso (null = nessun refresh in corso). Vedi ops/sync-info4u/sync-abbonamenti.ps1.';
