-- Voucher della visita medica per chi ha comprato PRIMA del 1° novembre 2026.
--
-- Dal 1° novembre la visita inclusa negli abbonamenti si prenota con Chiron e
-- un codice personale, che parte da solo a ogni nuova vendita (edge function
-- voucher-automatico). Chi ha comprato prima ha la visita «VISITA MEDICA ·
-- Compresa» ancora da fare in Info4U ma nessun codice: l'elenco arriva dal
-- gestionale («Visite mediche incluse nell'abbonamento al 31.10.26», esito
-- «Non effettuata», 510 righe, estratto il 05/11/2026).
--
-- Tre pezzi:
--
-- 1. `voucher_recupero`: la lista di lavoro, una riga per vendita della
--    visita, con l'esito della verifica (da inviare o escluso, e perché) e,
--    dopo l'invio, il voucher nato. È la traccia di cosa è partito e cosa no.
--    I dati del socio si copiano da `persone` al caricamento (Info4U è la
--    fonte, non il file): nel repo restano solo riga del file e istante della
--    vendita, che bastano a ritrovare la vendita e non sono dati personali.
--
-- 2. `voucher_recupero_prendi`: consegna alla edge function voucher-recupero
--    un lotto di righe da inviare, prenotandole (`in_corso`) in un colpo
--    solo, così due chiamate sovrapposte non spediscono due volte.
--
-- 3. L'interruttore `voucher_recupero` in `automazioni`, SPENTO, e il job
--    pg_cron che ogni 10 minuti chiama la function finché resta qualcosa da
--    inviare: 25 email a giro, circa 150 l'ora, e a lista vuota la function
--    spegne da sola l'interruttore.
--
-- Le regole di esclusione, decise il 10/11/2026, nell'ordine:
--
--   voucher_gia_presente  il socio ha già un voucher non annullato (per
--                         esempio il codice automatico di un rinnovo dopo
--                         il 1° novembre);
--   non_socio_oggi        nessun abbonamento in corso oggi;
--   doppione              lo stesso socio ha una vendita della visita più
--                         recente nel file: un codice a persona, si tiene
--                         quella;
--   certificato_recente   ha un certificato definitivo emesso dopo
--                         l'acquisto (la visita l'ha fatta per conto suo) e
--                         che scade fra più di 60 giorni. Se scade entro 60
--                         giorni, o è già scaduto, il codice gli serve e
--                         parte.
--
-- Il socio senza email valida nel gestionale riceve comunque il voucher,
-- creato e non spedito: il CRM lo segnala «Manca email» come quelli
-- automatici. Le email con un dominio palesemente sbagliato (gmai.com, …)
-- si trattano come mancanti, con l'indirizzo originale nel dettaglio.
--
-- Si può rieseguire: il caricamento non tocca le righe già presenti, quindi
-- le regole valgono per come erano al primo caricamento.
--
-- ACCENSIONE (solo su via libera, dopo aver letto il riepilogo in fondo):
--   update public.automazioni
--      set attiva = true, attiva_dal = now(), aggiornato_il = now()
--    where chiave = 'voucher_recupero';
--
-- SPEGNIMENTO (ferma i lotti successivi; il voucher già emesso resta):
--   update public.automazioni
--      set attiva = false, aggiornato_il = now()
--    where chiave = 'voucher_recupero';

create table if not exists public.voucher_recupero (
	id uuid primary key default gen_random_uuid(),
	lista text not null default 'pre-novembre-2026',
	-- Riga del file del gestionale: per ritrovare la persona sul foglio.
	riga_file integer,
	-- La vendita della visita («VISITA MEDICA · Compresa»): è anche
	-- l'abbonamento_id del voucher che nasce, e l'indice unico su
	-- voucher.abbonamento_id impedisce un secondo codice per la stessa vendita.
	abbonamento_id uuid not null unique references public.abbonamenti(id) on delete cascade,
	persona_id uuid references public.persone(id) on delete set null,
	data_vendita timestamptz not null,
	nome text not null default '',
	cognome text not null default '',
	email text not null default '',
	telefono text,
	certificato_emissione date,
	certificato_scadenza date,
	stato text not null default 'da_inviare',
	motivo text,
	dettaglio text,
	voucher_id uuid references public.voucher(id) on delete set null,
	elaborato_il timestamptz,
	creato_il timestamptz not null default now()
);

alter table public.voucher_recupero drop constraint if exists voucher_recupero_stato_check;
alter table public.voucher_recupero add constraint voucher_recupero_stato_check
	check (stato in ('da_inviare', 'in_corso', 'inviato', 'senza_email', 'errore', 'escluso'));

comment on table public.voucher_recupero is
	'Lista di lavoro dei voucher visita medica per chi ha comprato prima del 01/11/2026 (edge function voucher-recupero).';
comment on column public.voucher_recupero.stato is
	'da_inviare | in_corso | inviato | senza_email (voucher creato, email mancante) | errore (email non partita, o voucher non creato se voucher_id è vuoto) | escluso (vedi motivo).';

create index if not exists voucher_recupero_stato_idx on public.voucher_recupero (stato);

-- Come `voucher`: RLS accesa e nessuna policy, la legge solo il server.
alter table public.voucher_recupero enable row level security;

-- Il caricamento. Ogni elemento è «riga del file | istante della vendita della
-- visita (ora di Roma, AAMMGGhhmmss)»: l'istante al secondo identifica la
-- vendita, verificato il 10/11/2026 su tutte le 510 righe (510 trovate, nessuna
-- ambigua).
with chiavi as (
	select split_part(k, '|', 1)::int as riga,
		to_timestamp(split_part(k, '|', 2), 'YYMMDDHH24MISS')::timestamp as vendita_roma
	from regexp_split_to_table($chiavi$
4|261016174356;5|260620092017;6|260922095136;7|260925174348;8|260225172905;9|261029145012;
10|260923134820;11|260331200233;12|261010103323;13|260630122558;14|261027172726;15|260415115215;
16|260709172710;17|260424092411;18|261002110315;19|260714175236;20|260512163126;21|260924175503;
22|260909160802;23|260731140552;24|251224114714;25|260825111351;26|260520141915;27|251014095628;
28|260630142426;29|260924112143;30|260309185649;31|261031152007;32|260911134712;33|260325130157;
34|260325150807;35|261007103210;36|261006122317;37|251105100504;38|260716162639;39|260916084903;
40|260216100334;41|260630144148;42|260429130234;43|261013173349;44|251229102526;45|260415123513;
46|260107154525;47|260114105446;48|251114174733;49|260630105707;50|260504132330;51|260821174313;
52|260910100213;53|260129123148;54|260907130047;55|260917110543;56|260422194120;57|260910100913;
58|260427120632;59|260312124520;60|251111105855;61|260616185339;62|260630143118;63|261011171712;
64|260113111241;65|260803151949;66|260610113451;67|251015153959;68|261015120625;69|260131183146;
70|260723100536;71|261028175411;72|260724165705;73|260421102829;74|260922113336;75|260220104441;
76|260729103528;77|260925174534;78|261014152448;79|260728101518;80|251016192928;81|261017140739;
82|260630143406;83|251128175838;84|260614155433;85|260826094135;86|260907130743;87|260331200022;
88|260617124922;89|260304123955;90|260613120113;91|260303164621;92|260407193426;93|261016172733;
94|261017120732;95|260728090740;96|260902103734;97|261013165903;98|260714143538;99|260625123027;
100|260308123438;101|251022103553;102|260515110235;103|260918140131;104|260224102829;
105|261019134440;106|260327185713;107|261027155303;108|260331200452;109|260729155635;
110|260630143947;111|251017100513;112|260327124715;113|260115124202;114|260605110451;
115|260323144652;116|260129184302;117|260909131712;118|251104183814;119|260604164101;
120|260925142948;121|260318185952;122|260118093726;123|260923110137;124|251220142300;
125|261020182338;126|261021182751;127|260129174255;128|260224124941;129|251024162347;
130|260915123741;131|251217120521;132|260619164052;133|260105144816;134|260105120744;
135|261024170159;136|260302182849;137|251017163847;138|261016153202;139|260925161206;
140|260619105042;141|251217191449;142|261009173953;143|251029141303;144|261027182607;
145|260630145252;146|260624183013;147|260910185754;148|251026100343;149|261023155548;
150|260629174305;151|260922181141;152|260103184352;153|260112105757;154|260115124013;
155|260904172258;156|260929192643;157|260930184913;158|260702175312;159|260929110958;
160|260521182711;161|251010111818;162|251210141314;163|261014100958;164|260901152730;
165|261017104001;166|261031154619;167|260710120717;168|260923193436;169|260630122505;
170|260727095253;171|260225191821;172|260109112637;173|260209195939;174|260323162127;
175|260930142835;176|260408163502;177|260608125719;178|260216120805;179|260928181741;
180|251030114002;181|251103181556;182|260623185322;183|260204162456;184|260610182630;
185|260728101912;186|261016114618;187|260603173823;188|260803123107;189|260803123741;
190|261013190337;191|261012123219;192|260625113035;193|260528143213;194|260831130050;
195|260122141225;196|261012160203;197|260420105656;198|251126145329;199|260527103124;
200|260120102443;201|260722101252;202|251118183619;203|260527161125;204|260917110241;
205|260724160946;206|261014103219;207|260205095803;208|260925143127;209|260922121743;
210|261026145847;211|260430190636;212|260924111216;213|260314104439;214|261027174051;
215|251219093306;216|261031180403;217|260911134118;218|260325142545;219|260504184102;
220|251105085147;221|260511142759;222|261009174253;223|260313101132;224|260317130401;
225|251030084627;226|260529135209;227|260107121713;228|251222145629;229|260423200256;
230|261023181410;231|260611192541;232|260317131245;233|260107132104;234|260923150743;
235|260530114837;236|260708165608;237|261020112141;238|261031154224;239|260414122149;
240|261019115823;241|260630122339;242|260924135221;243|260127151517;244|251021174131;
245|261028151327;246|260113123051;247|260606104618;248|261013190905;249|251218160149;
250|261006123920;251|260504165836;252|260511125557;253|260223184810;254|260905115657;
255|260916091016;256|260727155722;257|251111190517;258|260516164146;259|260513081337;
260|260408105958;261|251229102732;262|251108132632;263|261023193616;264|260318105544;
265|260317153604;266|260819192355;267|260410160411;268|260429134955;269|260511142608;
270|251020131501;271|260520141726;272|260922095306;273|260508132115;274|260615152714;
275|251017120944;276|260702174109;277|260731183641;278|260509115131;279|260609094304;
280|260902171642;281|260728100830;282|260812154906;283|260331141827;284|260116100716;
285|260207105049;286|261015124514;287|260105161533;288|260912145307;289|260916113929;
290|260531145144;291|261030170814;292|260518185234;293|260902184321;294|261012155238;
295|260731125248;296|260831180024;297|260413150852;298|251220154201;299|260813094814;
300|260901152819;301|251222115759;302|260606120057;303|261031154755;304|260506141902;
305|260702110626;306|260607112541;307|260423105025;308|260918151703;309|261008120435;
310|260507092830;311|260619173743;312|260108111858;313|251028135702;314|261026161758;
315|260109114227;316|260522190700;317|260907171042;318|261031120318;319|260125190519;
320|260630163827;321|260508190845;322|260608130527;323|260112143116;324|261031103929;
325|260323163536;326|260121104358;327|261001194443;328|260323175856;329|251103163135;
330|260928112210;331|260928112447;332|251023103447;333|260803134442;334|260929184443;
335|261013125912;336|261004122629;337|251115111508;338|260108113212;339|260605195817;
340|260223173733;341|260104175440;342|260729181557;343|260521095220;344|260915090802;
345|260905115023;346|260129173846;347|260513143058;348|251112125830;349|260207184621;
350|261009180634;351|260409133316;352|260225173100;353|260929191119;354|251126193830;
355|261031122105;356|260825173516;357|260825172056;358|260903080126;359|260113110641;
360|260720190750;361|260925121700;362|260925124635;363|261027154946;364|251026104509;
365|261014153326;366|251128174409;367|260415093315;368|260318185851;369|260108100650;
370|251016123729;371|260526173306;372|260323163734;373|260527100229;374|260225135335;
375|251127124743;376|260512163048;377|260831143305;378|260204095052;379|261009141955;
380|260128111741;381|260924135514;382|260529163125;383|260713193502;384|251224124100;
385|260503094239;386|251111171634;387|260929104501;388|260202175957;389|251009113315;
390|260914193711;391|260925152423;392|261026123209;393|251123172525;394|260723170545;
395|251212140142;396|260915172435;397|261028114325;398|260609095310;399|251219151445;
400|251020120059;401|261031135450;402|260225092747;403|261013114401;404|251222142128;
405|261010131744;406|260326165157;407|251028135028;408|260119144402;409|260617124808;
410|260905124604;411|260601110628;412|260109113939;413|260227120853;414|260225135019;
415|260109165329;416|260217181428;417|251229115043;418|260110141913;419|260326191126;
420|260918091122;421|261014181725;422|260131144102;423|260616125533;424|260519143322;
425|260831163739;426|260709095256;427|261014180100;428|261030122305;429|260522171445;
430|260623093019;431|260321105531;432|260914175525;433|260413193716;434|261023122724;
435|260608124858;436|260916113349;437|260102120258;438|261031111032;439|260204093424;
440|251010181722;441|260330130817;442|261013094721;443|251001095535;444|260901184039;
445|260203175320;446|251027165741;447|260402194945;448|260513142846;449|260116103749;
450|251001115527;451|260201180409;452|260316161315;453|260316133924;454|260630093842;
455|261005164148;456|260108141751;457|260112140712;458|260604163749;459|251015170906;
460|260223183945;461|260926183149;462|260114111858;463|260507153219;464|260922183329;
465|251113142514;466|260106103505;467|261031154456;468|260424130017;469|260831120852;
470|260115094338;471|260403160529;472|260422102147;473|260430191005;474|260504190209;
475|260107100948;476|251222120219;477|260507161345;478|260515154351;479|260130163708;
480|251031143002;481|260917101122;482|260115094146;483|261015105308;484|260414114731;
485|251128171208;486|251203152017;487|251010180143;488|260518155424;489|260917182031;
490|260907190445;491|260901104831;492|261030153542;493|260407204036;494|260926114934;
495|260228162740;496|260623101929;497|261023103249;498|261022100414;499|260611182444;
500|260626121248;501|260723150602;502|260718143120;503|260113171630;504|251106153524;
505|260107112338;506|260520181202;507|260930101919;508|260108111745;509|251016122830;
510|260910134029;511|261005181519;512|260726141831;513|260827112449
$chiavi$, '[;\s]+') as k
	where k <> ''
),
oggi as (select (now() at time zone 'Europe/Rome')::date as d),
vendite as (
	select c.riga, a.id as abbonamento_id, a.persona_id, a.data_vendita
	from chiavi c
	join public.abbonamenti a
		on (a.data_vendita at time zone 'Europe/Rome') = c.vendita_roma
		and a.abbonamento ilike 'VISITA MEDICA%'
		and a.cancellato_il is null
),
dati as (
	select v.*,
		coalesce(trim(p.nome), '') as nome,
		coalesce(trim(p.cognome), '') as cognome,
		lower(coalesce(trim(p.email), '')) as email_gestionale,
		nullif(trim(p.cellulare), '') as telefono,
		cert.data_emissione as certificato_emissione,
		cert.data_scadenza as certificato_scadenza,
		exists (select 1 from public.abbonamenti_attivi_oggi_dettaglio d where d.persona_id = v.persona_id) as socio_oggi,
		exists (
			select 1 from public.voucher x
			left join public.abbonamenti xa on xa.id = x.abbonamento_id
			where x.stato <> 'annullato'
			  and (xa.persona_id = v.persona_id
				or (lower(x.nome) = lower(p.nome) and lower(x.cognome) = lower(p.cognome)))
		) as ha_voucher,
		row_number() over (partition by v.persona_id order by v.data_vendita desc) as ordine
	from vendite v
	left join public.persone p on p.id = v.persona_id
	-- L'ultimo certificato vero, come in certificati_stato
	-- (2026-10-29-certificati-medici-stato.sql): i «provvisorio» non contano.
	left join lateral (
		select c.data_emissione, c.data_scadenza
		from public.certificati c
		where c.persona_id = v.persona_id
		  and c.data_scadenza is not null
		  and coalesce(c.descrizione, '') !~* 'provvisorio'
		order by c.data_scadenza desc, c.data_emissione desc nulls last
		limit 1
	) cert on true
),
valutati as (
	select d.*,
		-- Domini palesemente sbagliati: meglio un «Manca email» che un codice
		-- spedito nel vuoto.
		(d.email_gestionale ~* '@(gmai|gmial|gamil|gmal|gnail|hotmial|hotmai|libro|liber)\.(com|it)$'
			or d.email_gestionale ~* '\.(con|cmo|ocm|itt)$') as email_sospetta,
		case
			when d.ha_voucher then 'voucher_gia_presente'
			when not d.socio_oggi then 'non_socio_oggi'
			when d.ordine > 1 then 'doppione'
			when d.certificato_emissione >= (d.data_vendita at time zone 'Europe/Rome')::date
			 and d.certificato_scadenza >= (select o.d from oggi o) + 60 then 'certificato_recente'
		end as motivo
	from dati d
)
insert into public.voucher_recupero (
	riga_file, abbonamento_id, persona_id, data_vendita, nome, cognome, email, telefono,
	certificato_emissione, certificato_scadenza, stato, motivo, dettaglio
)
select riga, abbonamento_id, persona_id, data_vendita, nome, cognome,
	case when email_sospetta then '' else email_gestionale end,
	telefono, certificato_emissione, certificato_scadenza,
	case when motivo is null then 'da_inviare' else 'escluso' end,
	motivo,
	case when email_sospetta then 'Email nel gestionale da verificare: ' || email_gestionale end
from valutati
on conflict (abbonamento_id) do nothing;

-- Il lotto per la edge function: prende fino a `p_quanti` righe da inviare e
-- le segna `in_corso` nella stessa istruzione (skip locked: una chiamata
-- sovrapposta prende righe diverse). Una riga rimasta `in_corso` da più di 15
-- minuti è di un giro interrotto e torna disponibile: la function, se il
-- voucher esiste già, lo riprende invece di crearne un altro.
create or replace function public.voucher_recupero_prendi(p_quanti integer)
returns setof public.voucher_recupero
language sql
security definer
set search_path = public
as $$
	update public.voucher_recupero r
	   set stato = 'in_corso', elaborato_il = now()
	 where r.id in (
		select q.id from public.voucher_recupero q
		 where q.stato = 'da_inviare'
		    or (q.stato = 'in_corso' and q.elaborato_il < now() - interval '15 minutes')
		 order by q.riga_file nulls last, q.data_vendita
		 limit greatest(least(coalesce(p_quanti, 0), 50), 0)
		 for update skip locked
	 )
	returning r.*
$$;

revoke all on function public.voucher_recupero_prendi(integer) from public, anon, authenticated;
grant execute on function public.voucher_recupero_prendi(integer) to service_role;

insert into public.automazioni (chiave, attiva, descrizione)
values (
	'voucher_recupero',
	false,
	'Codice della visita medica a chi ha comprato prima del 01/11/2026 (lista voucher_recupero), a lotti di 25.'
)
on conflict (chiave) do nothing;

-- Ogni 10 minuti, ma la function si chiama solo a interruttore acceso e con
-- qualcosa ancora da inviare: a lista finita il job non fa più richieste.
select cron.unschedule('voucher-recupero')
 where exists (select 1 from cron.job where jobname = 'voucher-recupero');

select cron.schedule(
	'voucher-recupero',
	'*/10 * * * *',
	$$select public.chiama_edge_function('voucher-recupero', '?lotto=25')
	   where exists (select 1 from public.automazioni where chiave = 'voucher_recupero' and attiva)
	     and exists (select 1 from public.voucher_recupero where stato in ('da_inviare', 'in_corso'))$$
);

-- Riepilogo: deve dare 510 righe in tutto, l'interruttore spento.
select stato, coalesce(motivo, '') as motivo, count(*) as righe,
	count(*) filter (where email = '') as senza_email
from public.voucher_recupero
group by 1, 2
order by 1, 2;

select chiave, attiva from public.automazioni where chiave = 'voucher_recupero';
