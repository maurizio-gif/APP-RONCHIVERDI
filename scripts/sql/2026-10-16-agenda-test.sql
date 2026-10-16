-- Sezione «Agenda Test»: la nuova agenda a calendario (giorno e settimana),
-- in prova accanto a quella a elenco. Si dà a chi oggi ha l'Agenda: stessi
-- dati, stesso pubblico. Rilanciabile: chi ce l'ha già non la riceve due volte.

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'agenda-test')
where 'agenda' = any (sezioni_consentite)
	and not ('agenda-test' = any (sezioni_consentite));

select email from public.staff_users where 'agenda-test' = any (sezioni_consentite) order by email;
