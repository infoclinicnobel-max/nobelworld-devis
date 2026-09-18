-- Bloc bancaire des devis et des factures (18/09/2026).
-- Copie de relecture de la migration « bloc_bancaire_paysera » appliquée sur
-- jvcybcpqraoxbkemmpax (clinic-nobel-crm-prod).
--
-- Le compte est chez Paysera LT, UAB, au nom de la société Clinic NobelWorld.
-- `bankName` portait « BUNQ: VEYSEL TURAN » — le nom d'une PERSONNE, et celui
-- d'une autre banque. Ce lot corrige ce libellé et nomme explicitement les
-- deux valeurs que le bloc affichait jusqu'ici par accident de saisie.
--
-- ⚠ CE QUI N'EST PAS TOUCHÉ, et doit le rester :
--   · `iban` et `bic` — relus et corrects (LT693500010019147464 / EVIULT2VXXX) ;
--   · `bankAddress` — conservée telle quelle, elle sert de repli au pays ;
--   · les 43 autres clés de la valeur `societe`, logo compris ;
--   · nw_devis, nw_factures, nw_paiements, patients — AUCUNE écriture. Les 48
--     documents déjà émis gardent leurs coordonnées photographiées.

-- 0) Sauvegarde datée AVANT toute écriture (méthode du 19/08 et du 30/08).
--    RLS activé, ZÉRO politique : ce vide EST la fermeture — en Postgres, RLS
--    sans politique refuse tout à `anon` et `authenticated`. Ne PAS y ajouter
--    de politique : la copie porte les coordonnées bancaires de la société.
create table sauvegarde_nw_parametres_20260918 as select * from nw_parametres;
alter table sauvegarde_nw_parametres_20260918 enable row level security;

-- 1) Les trois libellés du bloc, posés par fusion jsonb : `||` ne remplace que
--    les clés nommées et laisse les 43 autres strictement intactes.
--    `maj` est posé à la main — nw_parametres n'a aucun déclencheur.
update nw_parametres
set valeur = valeur || jsonb_build_object(
      'bankBeneficiary', 'Clinic NobelWorld',   -- le TITULAIRE du compte
      'bankName',        'Paysera LT, UAB',     -- la BANQUE (était : BUNQ: VEYSEL TURAN)
      'bankCountry',     'Lituanie'             -- le PAYS de la banque
    ),
    maj = now()
where cle = 'societe';

-- 2) Contrôle d'après-écriture (exécuté le 18/09, résultat au compte rendu) :
--    les cinq lignes du bloc, et la preuve que l'IBAN et le BIC n'ont pas bougé.
--
--   select valeur->>'bankBeneficiary' as beneficiaire,
--          valeur->>'iban'            as iban,
--          valeur->>'bic'             as bic,
--          valeur->>'bankName'        as banque,
--          valeur->>'bankCountry'     as pays,
--          (select count(*) from jsonb_object_keys(valeur)) as nb_cles
--     from nw_parametres where cle='societe';
