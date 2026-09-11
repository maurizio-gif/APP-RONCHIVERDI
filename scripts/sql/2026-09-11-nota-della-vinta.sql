-- Anche una trattativa vinta ha un perché da scrivere.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-11-evento-assegnato-alla-trattativa.sql.
--
-- Va eseguita PRIMA del deploy: chiudere una trattativa come vinta scrive
-- questa colonna, e senza di lei il salvataggio fallisce.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Le chiusure avevano due note su tre:
--
--   perso      → motivo_perso, il motivo commerciale;
--   annullato  → motivo_annullato, la spiegazione di un errore di
--                inserimento (doppione, prova, attività spuntata al banco);
--   vinto      → niente.
--
-- Cioè l'unico esito che **produce fatturato** era anche il solo a non
-- lasciare traccia di cosa fosse. «Vinta» da sola non dice che abbonamento è
-- stato fatto né quanto vale: per saperlo bisogna cercare il contratto
-- altrove, e a sei mesi di distanza nessuno ricollega una riga di pipeline a
-- una vendita. Su una persa si è sempre saputo perché; su una vinta no.
--
-- Una colonna a sé e non un riuso di motivo_perso: ogni motivo vive solo nel
-- suo stato e uscendo da quello si azzera (vedi cambiaStato), quindi
-- condividere il campo vorrebbe dire perdere la nota della vinta al primo
-- passaggio in persa — che è esattamente il momento in cui si vuole poter
-- rileggere cos'era stato venduto.
--
-- ────────────────────────────────────── due colonne, non una sola
--
-- Il nome dell'abbonamento è **testo**: è la cosa che l'operatore scrive
-- parlando al telefono, e ogni anno i nomi dei prodotti cambiano.
--
-- Il valore è un **numero**, e sta in una colonna sua. Dentro la nota non si
-- somma e non si mette in un grafico: «Club Full annuale, 1.080 €» è
-- leggibile da una persona e opaco a una query. Estrarlo a posteriori con
-- un'espressione regolare dà il numero sbagliato in una quota dei casi — chi
-- scrive «1.080», chi «1080,00», chi «€1080 (rateizzato)» — e non si sa
-- quale, che sul fatturato è il tipo di errore peggiore: invisibile.
--
-- `numeric` e non `float`: i soldi in virgola mobile si sommano male, e
-- 1080.00 + 540.00 deve fare 1620.00 esatto. (10,2) tiene fino a
-- 99.999.999,99, che copre qualunque abbonamento di questo club con
-- larghezza da vendere.

alter table public.opportunita
	add column if not exists motivo_vinto text,
	add column if not exists valore_euro numeric(10, 2);

comment on column public.opportunita.motivo_vinto is
	'Quale abbonamento è stato venduto, scritto da chi chiude la trattativa come vinta. Obbligatorio come motivo_perso e motivo_annullato — «Vinta» da sola non dice cosa sia stato fatto. Il valore NON sta qui: ha la sua colonna numerica, valore_euro.';

comment on column public.opportunita.valore_euro is
	'Valore del contratto in euro, obbligatorio sulle trattative vinte. Colonna numerica e non un numero dentro la nota, così si somma: è la base del fatturato per periodo. numeric e non float — i soldi in virgola mobile si sommano male.';

-- Il fatturato per periodo: la query per cui la colonna esiste. Parziale
-- sulle sole vinte, perché è l'unico stato che la riempie.
create index if not exists opportunita_vinte_chiuse_idx
	on public.opportunita (chiuso_il)
	where stato = 'vinto';


-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. Le colonne ci sono.
select column_name, data_type, numeric_precision, numeric_scale
from information_schema.columns
where table_schema = 'public' and table_name = 'opportunita'
	and (column_name like 'motivo%' or column_name = 'valore_euro')
order by column_name;

-- 2. Le vinte che non hanno nota né valore: sono quelle chiuse prima di
--    questa migration, e restano senza — non si inventa a posteriori cosa fu
--    venduto né a quanto. Il conto serve solo a sapere quante sono, cioè da
--    quando il fatturato in pannello è completo.
select
	count(*) as vinte,
	count(*) filter (where motivo_vinto is null or btrim(motivo_vinto) = '') as senza_nota,
	count(*) filter (where valore_euro is null) as senza_valore
from public.opportunita
where stato = 'vinto';

-- 3. Il fatturato delle vinte, mese per mese: la prova che la colonna serve
--    a qualcosa. Vuoto adesso, si riempie dalle prossime chiusure.
select date_trunc('month', chiuso_il) as mese,
	count(*) as vinte,
	sum(valore_euro) as valore
from public.opportunita
where stato = 'vinto' and valore_euro is not null
group by 1
order by 1 desc;
