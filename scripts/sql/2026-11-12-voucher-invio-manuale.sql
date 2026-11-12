-- Voucher: invio manuale a un socio con abbonamento attivo.
--
-- Il permesso 'voucher-manuale' (vedi lib/auth/sezioni.ts) fa comparire nella
-- pagina Voucher il pulsante «Invia un voucher a un socio»: si cerca la
-- persona in anagrafica, si sceglie il suo abbonamento attivo e il codice
-- parte per email. Nessuna colonna nuova: il permesso sta in
-- staff_users.sezioni_consentite, come gli altri.
--
-- Lo ha Rita Oliverio. Si può rieseguire senza danni (non lo aggiunge due
-- volte). Per toglierlo:
--   update public.staff_users
--      set sezioni_consentite = array_remove(sezioni_consentite, 'voucher-manuale')
--    where email = 'rita.oliverio75@gmail.com';

update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'voucher-manuale')
where email = 'rita.oliverio75@gmail.com'
	and 'voucher' = any (sezioni_consentite)
	and not ('voucher-manuale' = any (sezioni_consentite));

select email, nome, cognome, sezioni_consentite
from public.staff_users
where email = 'rita.oliverio75@gmail.com';
