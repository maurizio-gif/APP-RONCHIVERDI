-- Stato della sincronizzazione Info4U che non è un watermark derivabile da
-- MAX() su una colonna di `abbonamenti` (quello, per source_iscrizione_id,
-- resta come oggi: letto al volo da Supabase, senza bisogno di essere
-- salvato qui). Nasce per il refresh periodico delle righe "aperte" (vedi
-- sync-abbonamenti.ps1) — serve un posto dove ricordare "quando l'ho fatto
-- l'ultima volta", e per lo stesso motivo del watermark principale non deve
-- vivere solo sul disco del server Windows.
--
-- Tabella generica a chiave/valore e non una colonna dedicata: qualunque
-- futuro "watermark" o stato di sincronizzazione che non sia un semplice
-- MAX() può appoggiarsi qui senza una migration nuova.

create table if not exists public.sync_info4u_stato (
	chiave text primary key,
	valore timestamptz not null,
	aggiornato_il timestamptz not null default now()
);

comment on table public.sync_info4u_stato is
	'Stato della sincronizzazione Info4U → Supabase che non è derivabile con un MAX() su abbonamenti. Riga "refresh_aperti": quando è stato fatto l''ultimo giro di refresh delle vendite ancora aperte (per intercettare sospensioni/disdette applicate dopo il primo sync — vedi sync-abbonamenti.ps1).';
