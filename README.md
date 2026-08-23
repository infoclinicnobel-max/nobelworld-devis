# Clinic NobelWorld — Devis & Factures

Application Next.js 15 (App Router) · TypeScript · Tailwind · Supabase, déployée sur Vercel.
Elle remplace la page unique `index.html` (React par CDN + Babel navigateur) et le backend
Google Apps Script, **à iso-fonctionnalité et iso-apparence**.

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis renseigner les deux variables
npm run dev
```

Variables d'environnement (les seules ; **aucune clé ne doit être écrite dans le code**) :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase `clinic-nobel-crm-prod` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publiable (les droits réels viennent des règles RLS) |

## Base de données — règles non négociables

La base est **partagée avec le CRM Clinic Nobel**, sur lequel un système d'IA est en
construction. Les garde-fous sont posés à trois niveaux : les règles RLS côté Postgres,
la liste blanche `TABLES_ECRITURE` de `lib/data.ts`, et l'interface.

| Table | Droit de Nobel World |
| --- | --- |
| `nw_devis`, `nw_factures`, `nw_paiements`, `nw_historique`, `nw_options`, `nw_parametres` | lecture + écriture |
| `nw_catalogue_descriptions` | lecture (alimentée par le client, hors application) |
| `patients` | lecture + écriture, **jamais de suppression** (liste unique partagée) |
| `catalogue_interventions`, `catalogue_correspondances`, `profiles` | **lecture seule** |
| `rdvs` | lecture + **`INSERT` seul**, par une seule porte, et pour le seul type « Opération ». Ni `UPDATE`, ni `DELETE`. **Hors de `TABLES_ECRITURE`** — voir l'invariant plus bas |
| toute autre table (`finances`, `taches`, `devis`, `devis_lignes`, `ia_*`…) | **interdite** |

Autres invariants :

- **Un devis envoyé est figé.** Ses montants et ses textes ne sont jamais recalculés depuis
  le catalogue ; l'éditeur exige une confirmation explicite avant de réécrire un devis
  envoyé ou accepté.
- **Aucune normalisation silencieuse.** Les convertisseurs de `lib/mappers.ts` conservent
  la valeur stockée dès lors qu'elle est métier-équivalente : la base mélange `'€'` et
  `'EUR'`, `remise_type` `null` et `'montant'` — réécrire ces valeurs modifierait des
  documents déjà partis chez des patientes.
- **Le catalogue est en lecture seule.** Une prestation manquante est signalée à l'écran ;
  l'application ne crée jamais de ligne au catalogue.
- **La description patient d'une prestation vit dans `nw_catalogue_descriptions`**, pas dans
  `catalogue_interventions.notes` : cette colonne porte du commentaire interne au CRM
  (arbitrages de tarif, doublons signalés) qui n'a rien à faire sur un document remis à une
  patiente. Appliquer un modèle **recopie** la description dans l'acte à cet instant ; elle
  n'est plus jamais relue ensuite. Une prestation sans description donne une case
  « Inclus / détail » vide, signalée à l'écran, jamais une erreur.
- **Une option ne gonfle pas le montant engagé.** Une option se décide en consultation :
  tant qu'elle n'est pas *retenue*, elle s'affiche avec son prix dans un bloc distinct et
  reste hors du total, de l'acompte et du reste à payer. ⚠ Le champ `retenue` **absent vaut
  `true`** — toutes les options écrites avant ce lot en sont dépourvues, et les lire comme
  non retenues retrancherait des montants de devis déjà acceptés. La lecture passe toujours
  par `estRetenue()` de `lib/calc.ts`, jamais par `o.retenue` en direct.
- **Le groupement et la recherche du catalogue vivent dans `lib/catalogue.ts`**, source unique
  des deux listes « Appliquer un modèle » (actes et options). La recherche porte aussi sur
  `synonymes`, ce qui permet de trouver « liposuccion 360 + BBL » quand la ligne s'appelle
  « SAFE BBL + Liposuccion Vaser HD 360° ».
- **Un modèle appliqué remplace, il ne concatène jamais.** Il remplit la première ligne vide
  de la section d'où la liste a été ouverte, sinon il en crée une neuve — libellé et détail
  dans deux champs distincts, pour un acte comme pour une option.
- **Le devis nourrit la fiche patiente, il ne la corrige pas.** Six champs — et six
  seulement — remontent vers `patients` : `dateOperation`, `dateDevis`, `medecin`,
  `budget`, `procedure` (au SINGULIER : c'est la colonne qu'affiche la carte patient ;
  `procedures` au pluriel est un vestige) et `stade`. La remontée part dès que **l'un** des
  deux signaux est vrai — un devis accepté **ou** un paiement — parce que le statut d'un
  document ne suit pas la réalité : des factures en brouillon portent des paiements
  encaissés. ⚠ `aPaye()` cherche par `patient_id` **et** par `facture_id` : 3 paiements sur
  12 n'ont pas de `patient_id`. `procedure` et `stade` sont marqués `silencieux` dans
  `CHAMPS_REMONTES` — un écart n'y est jamais signalé, un stade en avance étant le cours
  normal des choses.
- **`stade` est la SEULE colonne à règle ordonnée**, et c'est une nécessité, pas un confort :
  avec « on n'écrit que si vide », une fiche passée à « Devis envoyé » à l'envoi ne pourrait
  plus jamais avancer à « Confirmé » — toutes les fiches se figeraient au premier étage. On
  écrit donc si et seulement si le rang proposé est **strictement supérieur** au rang actuel
  (`vide -1 < Nouveau 0 < Devis envoyé 1 < Confirmé 2 < Post-opératoire 3 < Clôturé ✓ 4`).
  Une valeur hors échelle laisse la fiche intacte **et** apparaît au rapport : une fiche mal
  orthographiée se gèlerait sinon en silence. Un devis `envoye` n'écrit **que** le stade ;
  le bouton manuel force les cinq colonnes de données mais jamais l'avancement — **et il dit
  les deux moitiés**, sans quoi l'utilisateur croit à une panne. ⚠ **On n'écrit que dans un champ vide** (chaîne vide :
  ces colonnes sont `text NOT NULL DEFAULT ''`, un test `is null` ne trouverait rien). Une
  valeur du CRM différente n'est jamais écrasée : elle est affichée dans une fenêtre de
  divergence. `UPDATE` ciblé, jamais d'`INSERT` — un devis ne crée jamais une fiche.
  `patients.procedures` (pluriel) et `hopital` restent hors périmètre. Voir `lib/fiche.ts`.
- **La clause d'annulation conditionne « Confirmé »** : une facture **annulée** rattachée à
  la patiente, **sans facture vivante qui la remplace**, bloque la promotion du stade — les
  cinq colonnes de données, elles, continuent de remonter. Motif mesuré : l'annulation se
  pose sur la facture et ne redescend jamais au devis, qui reste « accepte » pour toujours
  (F-2026-000009 Tresor, F-2026-000012 Munao — le rattrapage du 19 août, antérieur à la
  clause, avait promu Tresor à tort). L'exception « facture vivante » est la porte du
  chantier « annuler et remplacer » : bloquer sur la seule présence d'une annulée gèlerait
  toute fiche passée par un remplacement. `annulationBloqueConfirmation()` dans
  `lib/fiche.ts`, partagée par le flux et le rattrapage ; recette sections 12-15, dont le
  jumeau positif qui prouve que le test négatif échoue pour la bonne raison.
- **Le chirurgien se traduit, ne se recopie jamais** : quand `patients.medecin` est vide,
  la remontée écrit la forme canonique (`medecins.nomAffiche`, 4 lignes depuis le 19 août,
  RLS en lecture pour tout rôle non anonyme) quand la comparaison normalisée aboutit, et
  **refuse en signalant** sinon — nom inconnu, patronyme manquant (« Dr Anvar »), ou
  vocabulaire vide/illisible (l'interdit v1.83 se réimpose alors de lui-même). Motif
  mesuré : la recopie brute a produit « ANVAR AHMEDOV » et « AZAR ZEYNALOV » sur Cindy,
  Diallo et El Acmaoui les 17-18 août, premières écritures définitives réparées à la main.
  Pas de filtre sur `medecins.actif` (convention texte posée « au jugé », v1.84).
  Recette section 18.
- **Le chirurgien est référencé, le texte reste** : depuis le 23 août, `nw_devis` et
  `nw_factures` portent `medecin_id` (référence vers `medecins.id`) À CÔTÉ du texte
  `chirurgien`, qui s'imprime et n'est jamais déduit de la référence — ni l'inverse. Les 25
  devis et 15 factures d'avant ont reçu la référence par correspondance normalisée du texte
  (18 Ahmedov · 5 Zeynalov · 1 Uyanik ; la ligne vide, F-16 et F-28 « AANVAR AHMEDOV »
  restent NULL) sans qu'une autre colonne bouge — diff mesuré colonne par colonne contre
  `sauvegarde_nw_devis_20260823` et `sauvegarde_nw_factures_20260823`. Dans l'éditeur, le
  champ devient une liste : ligne vide « À confirmer » en tête, puis Dr Ahmedov, puis
  l'ordre alphabétique, aucun pré-remplissage ; choisir est le SEUL geste qui change le
  texte. Table illisible → liste vide, saisie libre conservée. `lib/medecins.ts` ;
  `scripts/recette-chirurgien-reference.ts`.
- **La majoration par chirurgien se calcule au geste, ne se stocke pas au catalogue, ne
  s'imprime pas** : règle du 23 août, les actes esthétiques du Dr Azar Zeynalov sont majorés
  de 35 % — hors bariatrique, capillaire et dentaire. Périmètre : `categorie = 'esthetique'`
  plus `sup-zone-liposuccion`, seule ligne « supplement » ce jour-là. La paire du catalogue
  est majorée (promo ET standard quand il existe ; les dix lignes esthétiques sans standard
  gardent un standard absent), arrondie à l'euro ; le devis prend le promo majoré (lipo Vaser
  360 : 3 300 → 4 455 €), les options aussi (zone : 500 → 675 €). Lue sur `medecinId`, jamais
  sur le texte. **Devis neuf seulement** (`!id`, frontière voulue : un devis déjà en base —
  même brouillon — garde ses montants quel que soit le chirurgien choisi ensuite). **Un
  montant saisi à la main n'est jamais écrasé** : un montant ne dit pas d'où il vient (4 455
  tapé ≈ prix système Zeynalov ; 3 300 d'un premier modèle gardé sous le `modeleId` d'un
  second — 1 155 € d'écart mesurés par la vérification adverse du 23 août), l'éditeur retient
  donc ce que le système a posé et pour quel modèle (`_systeme`, mémoire de la saisie, jamais
  enregistrée) et, au changement de chirurgien, seul un montant encore égal à ce qui a été
  posé suit le nouveau chirurgien. Duplication et conversion en facture reprennent les
  montants tels quels (aucun geste, aucune mémoire). La patiente voit 4 455 €, pas
  3 300 € + 35 % : aucune ligne sur le document, `lib/calc.ts` ignore tout de la règle ;
  `contenu.majoration` garde la trace (« règle en vigueur au dernier geste »), gelée comme
  `promoJours` — et le gel tient dans le mapper, même face à `undefined` ou à un `contenu`
  NULL. Le sélecteur et la Bibliothèque (liste « Tarifs affichés pour… ») montrent la paire
  majorée ; l'éditeur dit « imprimé : Dr Azar » quand le texte stocké diverge du libellé de
  la liste. `catalogue_interventions` n'est jamais écrit. `lib/catalogue.ts` (`MAJORATIONS`,
  `tarifsPourMedecin`, `retenir*Systeme`, `reajusterPrixSysteme`) ;
  `scripts/recette-majoration-chirurgien.ts`.
- **Toute écriture de la remontée laisse une trace, dans le MÊME update** : une entrée par
  colonne dans `patients.historique` — le journal de fiche du CRM, format
  `{u, date, heure, champ, ancien, nouveau, motif}`, `motif` portant le document source —
  et `updated_at`, que `patients` ne pose pas tout seul (aucun déclencheur). Motif mesuré
  le 19 août : la remontée en service avait rempli Cindy, Diallo et El Acmaoui sans une
  ligne de journal ni d'horodatage — des écritures strictement invisibles dans un dossier
  patient, pendant que le CRM, lui, journalise les corrections humaines. Un journal
  existant illisible n'est **jamais** écrasé : la trace est perdue, les données partent,
  le journal reste. `journaliserRemontee()` dans `lib/fiche.ts` ; recette sections 16-17.
- **La formule à garder : le document n'engage pas, l'argent si.** Un brouillon n'est
  jamais une source pour le CRM (hors de `STATUTS_FACTURE_VIVANTE`), mais son paiement
  déclenche l'engagement via `aPaye()`. Les deux bouts sont **voulus** — F-2026-000011
  porte 8 570 € encaissés sur un statut `brouillon`, et c'est ce couple qui la traite
  correctement. Ne pas les « harmoniser ». À savoir en la lisant : `factureStatus()`
  (lib/calc.ts) recalcule le badge depuis les paiements, si bien qu'un brouillon payé
  s'**affiche** « Payée » alors que le statut stocké reste `brouillon` — l'écran répond
  « qu'a-t-elle payé ? », la base répond « le document a-t-il été émis ? ».
- **Le rattrapage des fiches a été passé le 19 août 2026** : **41 champs sur 13 fiches**,
  aucune ligne créée ni supprimée. Sauvegarde préalable dans
  `public.sauvegarde_patients_20260819` — `enable row level security` dans la même
  migration que le `create table`, un `create table as` ne portant aucune politique et la
  copie serait sinon lisible par `anon`. Le décompte ne vient pas du script mais d'une
  comparaison avec cette sauvegarde ; les **34 autres colonnes** en sont ressorties
  identiques ligne à ligne, `updated_at` compris (il n'y a pas de déclencheur sur
  `patients`). ⚠️ **Sur les quatre tables `sauvegarde_*` : RLS activé et ZÉRO politique,
  et ce vide EST la fermeture** — en Postgres, RLS sans politique refuse tout à `anon` et
  `authenticated`. Une liste de politiques vide n'est pas un oubli à « corriger » : y
  ajouter une politique permissive ouvrirait d'un coup une copie complète de 68 dossiers
  patients. Vérifié le 19 août 2026. Le rapport gagne un mode `--sql` qui **imprime** les `UPDATE` au lieu de les
  passer : le fichier n'ouvre toujours aucune connexion, et le SQL est relu avant d'être
  exécuté. **Chaque ordre porte sa propre garde** — `and coalesce("colonne", '') = <la
  valeur lue>` — si bien que la règle ne vit pas seulement dans le script : rejouer le lot
  n'écrit rien, et un instantané périmé ne peut ni écraser une saisie faite entre-temps ni
  faire reculer un `stade`.
- **Les factures ont un crayon, et chaque coup de crayon se trace** — décidé par Veys le
  19 août 2026 : « je fais une facture que je n'arrive pas à modifier… soit elle doit être
  modifiable, soit elle doit être supprimée ». La suppression était le contournement, pas
  le besoin (mesuré : 18 devis sur 22 modifiés après création, 2 factures sur 13 — les deux
  étant des annulations ; le 17 août, retirer une option de 2 000 € est passé par
  supprimer/refaire, en brûlant F-2026-000024). `FactureEditor` réutilise la page A4
  éditable des devis (`DevisDoc`), **sans réinjecter les défauts des Paramètres** — une
  facture émise garde ses textes photographiés. Chaque enregistrement écrit dans
  `nw_historique` — le canal qui porte déjà les événements de facture — ce qui change,
  l'ancienne valeur, la nouvelle, sans rien demander (`lib/trace.ts`, recette
  `scripts/recette-crayon-facture.ts`, scénario du 17 août compris). **La corbeille
  reste**, sur décision explicite de Veys — ne pas la retirer ni la conditionner. Une
  facture envoyée demande confirmation avant réécriture ; un total qui passe **sous
  l'encaissé** se signale sans se refuser — mesuré dans le code : le badge se recalcule
  depuis les paiements et affiche « Payée », le reste à payer est plancherisé à zéro, et le
  trop-perçu n'apparaissait nulle part ; l'éditeur et le détail de facture l'affichent
  désormais en clair.
- **Les devis ont deux états « classés » — `refuse` et `expire` — et une rubrique, pas une
  corbeille.** Décidé par Veys le 19 août 2026 : « on ne les fait pas disparaître, on fait
  une rubrique pour dire ces devis, ils sont en attente ». Un refusé ou un sans-réponse
  restait éternellement « envoyé ». Deux états et **pas plus** : « en attente » est ce que
  « envoyé » veut déjà dire — la rubrique est le filtre « Classés », qui les rassemble
  (le badge les distingue) ; « Tous » reste tous. Transitions **manuelles et tracées**
  (`a marqué le devis D-… comme refusé` dans `nw_historique`), réversibles par
  « Réactiver » — **jamais automatiques** : `validite` porte dix durées saisies à la main
  (8 à 146 jours) et D-2026-000037, devis du 28 mars accepté/facturé/opéré, aurait été tué
  par toute expiration calculée. L'écran **dit** « validité dépassée » sur un envoyé
  (`validiteDepassee`, calculée à l'affichage) mais ne reclasse rien. Un classé est
  **figé** (`estFige`), ne remonte rien, ne fait jamais foi et ne propose aucun stade —
  comportements **prouvés** par `scripts/recette-statuts-devis.ts` (jumeaux positifs sur le
  même montage : ces comparaisons strictes étaient justes par accident, la recette rougit
  si un refactor les assouplit). Un classé reste **facturable**, avec la mention
  « (refusé) / (expiré) » dans le sélecteur — une patiente qui change d'avis ne repart pas
  de zéro. La corbeille n'est ni retirée ni conditionnée.
- **Le catalogue est branché sur le sélecteur d'actes, et l'écran dit ce qu'un libellé
  vaut** — décision de Veys du 17 août, construite le 20. La recherche du sélecteur
  comprend désormais les libellés d'usage de `catalogue_correspondances` au statut
  **`valide` seulement** : les `a_verifier` ne la nourrissent jamais — un tarif engagé sans
  relecture — et la recette `scripts/recette-selecteur-catalogue.ts` rougit si ce filtre
  s'assouplit. Chaque ligne d'acte de l'éditeur porte une **pastille de reconnaissance**
  (« ✓ au catalogue », « ✓ reconnu : … », « ⚠ correspondance à vérifier : … »,
  « hors catalogue ») — une lecture superposée, **jamais une écriture** : à la réouverture
  d'un devis, rien ne se recompose, et le PDF ne la rend pas. ⚠ « hors catalogue » est un
  **fait, pas une alerte** (12 libellés sur 29, dont des combos légitimes) : ne pas le
  transformer en « à corriger », la neutralité est ce qui rend l'affichage permanent
  tenable. La comparaison efface casse et accents (`cleLibelle`) : la table de
  correspondances portait quatre paires de pure typographie — huit lignes sur 56,
  retirables côté CRM. Les lignes d'acte entièrement vides ne partent plus à
  l'enregistrement (`nettoyerActes` — deux devis émis en portaient une) ; rien de
  rétroactif. La Bibliothèque affiche le compte des correspondances en attente de
  relecture — une ligne, pas de bouton « tout valider », ni maintenant ni jamais.
- **Le refus persiste, et il arrive avant le dommage.** Décidé le 22 août 2026 sur un cas
  daté : D-2026-000045 (Sofia) — « AANVAR AHMEDOV » refusé par la traduction, fiche restée
  vide, journal de fiche portant cinq succès et **zéro mention de l'échec** ; onze minutes
  plus tard la même faute repartait sur D-2026-000046, avec une date d'opération au
  **5 janvier 2026**. Deux défauts, une cause : le refus vivait dans la boucle par colonne,
  sautée hors engagement — il ne pouvait se produire qu'à l'acceptation, à l'instant même
  où la fiche reçoit ses colonnes et l'agenda sa ligne. Désormais **évaluer et écrire sont
  séparés** (`evaluerDocument`, `lib/fiche.ts`) : chirurgien et date d'opération sont
  évalués **à chaque enregistrement**, brouillon compris, et le refus entre dans **les deux
  journaux dès « envoyé »** — `patients.historique` (`journaliserRefus` : une entrée par
  refus, `nouveau` vide puisque rien n'est écrit, valeur et raison dans `motif`, **une
  fois** par faute, jamais répétée à la réécriture du même document) et `nw_historique` —
  des semaines avant l'acceptation (D-2026-000023 est « envoyé » depuis le 3 juillet). Les
  colonnes de la fiche, elles, ne s'écrivent toujours que sous engagement : seule la
  condition d'évaluation descend d'un cran. **Garde de date** : une date d'opération passée
  ou illisible **ne s'écrit jamais**, même dans un champ vide — la première écriture y est
  définitive — et `planifierRendezVous` ne pose rien au calendrier pour une date passée ;
  exposition mesurée le 22 août sur les dix devis non engagés : **quatre** dates passées
  (D-29 au 2 juin, D-30, D-33, D-46) contre **un** chirurgien inconnu, la garde de date
  passe donc avant. Un brouillon est évalué et dit à l'écran, pas journalisé : il n'est pas
  parti. La fenêtre de rapport nomme chaque refus, le toast aussi — le toast de Sofia a été
  manqué. Recette `scripts/recette-refus-persistant.ts` (les valeurs réelles des dix
  devis, jumeaux date passée / future, dédoublonnage, journal illisible jamais écrasé,
  garde de source : l'évaluation précède le raccourci d'engagement) et `recette-agenda.ts`
  § 4 bis. Écritures : `patients` (`historique` + `updated_at`, `UPDATE` ciblé, colonnes
  nommées) dès l'envoi, et une ligne `nw_historique` — aucune colonne de donnée de plus,
  aucune table nouvelle. Recensement du 22 août au soir sur les quinze devis acceptés :
  onze chirurgiens traduisibles → onze fiches renseignées, quatre non traduisibles →
  **quatre fiches vides** depuis le 4 juillet (Tresor « Dr Azar », Munao « Dr Anvar », Alma
  « Dr Anvar », Benabedrabou « AANVAR AHMEDOV ») — la « réparation manuelle » d'Alma
  inscrite sur la liste de Veys était la réparation à la main de ce bogue. Rouvrir et
  corriger leurs devis répare les fiches **avec la raison écrite** — Tresor et Munao, dont
  les factures sont annulées. **Pas Alma, pas Sofia** : leurs factures F-2026-000016 et
  F-2026-000028 sont vivantes (`envoye`), et la hiérarchie des documents rend la main
  **avant** toute évaluation — le devis ne parle plus au CRM, rien n'est évalué ni
  journalisé, ni avant ni après ce lot. Pour Sofia, la fenêtre a duré **52 secondes** (devis
  06:32:16, facture 06:33:08) : la hiérarchie ne bloque pas la panne, elle bloque la
  réparation. Leurs fiches se réparent à la main côté CRM ; une remontée à l'enregistrement
  de la facture n'existe pas (la facture ne parle qu'à sa création), et ne réglerait pas
  tout : F-2026-000016 est **orpheline** — sans devis, sans chirurgien, sans date — et fait
  taire un devis qui porte les deux. L'autorité est donnée par le **rang** du document, pas
  par ce qu'il porte ; la calculer **champ par champ** est une conception à décider, pas un
  correctif — les deux factures sont au banc de la recette (§ 3 bis) avant qu'une ligne de
  ce lot existe. Un dossier **clôturé**
  n'est pas une exception : rouvrir son document, c'est le modifier, et le refus y explique
  un vide qu'aucun journal n'expliquait (choix du 22 août, fixé par la recette). ⚠ **Limite
  nommée** : ce lot protège l'instant de l'enregistrement, il **ne surveille pas ce qui
  dort** — D-2026-000029 (opération au 2 juin) et D-2026-000030 (16 août), brouillons de
  plus d'un mois, ne produiront rien tant que personne ne les rouvre. Ce qui les couvre est
  un **balayage** — un rapport, jamais un verrou, calculable à chaque chargement depuis ce
  que l'application a déjà en mémoire (devis et fiches), sur le modèle de `verifierSejours`.
  Trois familles à prévoir dès sa conception (relevé du 22 août) : les documents endormis à
  **date passée** (D-29, D-30), les documents à **chirurgien inconnu**, et les fiches
  **« Confirmé » dont la date d'opération est passée** — treize le 22 août, de 5 à 46 jours,
  parce que les deux stades postopératoires sont en pratique inutilisés (une seule fiche de
  toute la base à « Post-opératoire ») : « qui a été opérée cette semaine » n'a pas de
  réponse dans l'outil. Le balayage **signale, un humain tranche** : avancer un stade
  affirme qu'une opération a eu lieu, fait clinique que l'application ne connaît pas. Lot à
  part, non construit.
- **Le devis accepté pose l'opération au calendrier — en `INSERT` seul, par une seule
  porte.** `rdvs` appartient au CRM et **reste hors de `TABLES_ECRITURE`** : cette liste
  commande aussi `supprimer()`, qui n'a de garde particulière que pour `patients`, si bien
  qu'y inscrire `rdvs` aurait ouvert `INSERT`, `UPDATE` **et** `DELETE` par un chemin
  générique appelable de partout. L'écriture passe donc par
  `insererRendezVousOperation()`, un `.insert()` en dur qui repose `type` depuis la
  constante — la fonction est incapable d'écrire autre chose qu'une opération — appelé
  depuis `remonterVersFiche` et de nulle part ailleurs. `scripts/garde-agenda.ts` **échoue**
  si un second appelant, un `.update()`, un `.delete()` ou une entrée dans la liste blanche
  apparaît. La règle vit dans `lib/agenda.ts`, pure, en trois cas : même date → rien ;
  aucun rendez-vous → on crée ; **autre date → on ne crée rien et on signale**. Le
  troisième est le seul difficile, et il n'est pas théorique — mesuré, 3 fiches sur 10 le
  présentaient. Créer alors un second rendez-vous donnerait **deux opérations à une même
  patiente** ; l'agenda peut avoir raison. ⚠ Le pas agenda ne vit **pas** derrière le
  raccourci « rien à écrire » : une fiche déjà complète produit un `aEcrire` vide, et c'est
  exactement le cas qui a motivé le lot. `heure` (`'10:00'`) est une **convention** — aucune
  source n'en porte — d'où `creePar = 'nobelworld'`, qui permet de retrouver ces lignes.
- **La comparaison est normalisée, l'écriture ne l'est pas.** « Dr Anvar Ahmedov » et
  « Anvar Ahmedov » désignent le même praticien : les traiter comme un désaccord ferait
  crier l'alerte sur la moitié du fichier, et plus personne ne la lirait.
- **La numérotation ne se calcule jamais côté navigateur.** La fonction Postgres atomique
  `nw_prochain_numero(type)` incrémente et renvoie `D-2026-000040` / `F-2026-000024`.
- Les rôles `chirurgien` et `anonyme` sont refusés par la base : ils n'accèdent pas à
  Nobel World.

## PDF

`components/DevisDoc.tsx` est un portage strict du composant d'origine, et
`app/globals.css` reprend la feuille de style de `index.html` caractère pour caractère.
**Toute retouche de ces deux fichiers change le document reçu par les patientes.**

Recette effectuée sur le devis `D-2026-000011` (Widmie Blanc, 4 000 €) : rendu comparé au
pixel près avec `index.html`, puis PDF A4 générés par les deux versions — **880 flux PDF
sur 880 identiques**, pagination 2 pages des deux côtés.

## Contrôles

```bash
npm run typecheck
npm run build
npx tsx scripts/verifier-mappage.ts instantane.json   # aller-retour colonnes ⇄ objets
npx tsx scripts/totaux-devis.ts devis.json ref.json   # montants inchangés, devis par devis
npx tsx scripts/recette-fiche-champs.ts               # 49 contrôles sur les règles de la remontée
npx tsx scripts/recette-agenda.ts                     # 26 contrôles sur les trois cas de l'agenda
npx tsx scripts/garde-agenda.ts                       # échoue si la surface d'écriture de rdvs s'élargit
npx tsx scripts/recette-chirurgien-reference.ts       # 22 contrôles : référence à côté du texte, liste, geste
npx tsx scripts/recette-majoration-chirurgien.ts      # 66 contrôles : règle, trace gelée, mémoire des montants posés, gardes de source
npx tsx scripts/rattrapage-fiches.ts instantane.json         # les cinq listes du retard
npx tsx scripts/rattrapage-fiches.ts instantane.json --sql   # les UPDATE gardés, imprimés
```

`scripts/verifier-mappage.ts` rejoue chaque ligne réellement présente en base à travers
les convertisseurs (`row → objet → row`) et vérifie qu'aucune colonne n'est altérée. Il
attend un instantané JSON de la forme `{ "devis": [...], "factures": [...], "paiements":
[...], "options": [...], "patients": [...] }`.

## PWA & ancienne version

`index.html`, `Code.gs`, `manifest.json`, `sw.js` et les icônes restent à la racine :
l'ancienne version continue d'être servie par GitHub Pages pendant la durée des travaux.
Les mêmes fichiers PWA sont recopiés dans `public/` pour la version Next.js, avec des
chemins absolus. Le cache du service worker est passé en `v3`.

## Déploiement

⚠️ **Mesuré le 19 août 2026 — la note d'origine ne décrit plus la réalité.**

- **La « préproduction » est devenue la production de fait.** `nw_historique` porte le
  travail réel de Veys Turan du 17 au 19 août (D-2026-000040 à 43, F-2026-000024 à 26,
  paiements) : c'est la nouvelle application qui fait tourner l'activité, quelle que soit
  l'étiquette de son déploiement.
- **`main` ne porte que l'ancienne application** (`index.html` + Apps Script, servie par
  GitHub Pages, toujours en ligne) : aucun des commits d'août n'y est. Fusionner vers
  `main` ne déploie rien tant que le projet Vercel n'y est pas raccordé.
- **Le projet Vercel n'a pas été retrouvé** depuis la session du 19 août : l'équipe
  Vercel « Nobel Dent » ne contient que `clinicnobel-next`, et
  `nobelworld-devis.vercel.app` répond 404. L'URL réellement servie est celle du
  navigateur de Veys — à relever avant toute décision de fusion ou de bascule.

Note d'origine (10 août, conservée pour mémoire) : le projet Vercel `nobelworld-devis`
(équipe Nobel Dent) est relié à ce dépôt, branche `claude/adoring-keller-qi3eez` en
préproduction pour la recette du PDF ; `main` non fusionnée pour que GitHub Pages
continue de servir l'ancienne application.

## Session : ce qui la maintient ouverte

L'exigence métier est de rester connecté le plus longtemps possible. Trois pièces
y concourent, et aucune ne doit être retirée sans mesure préalable.

1. **`lib/supabase/client.ts`** — `persistSession` et `autoRefreshToken` explicites,
   et surtout des méthodes `getAll` / `setAll` maison. `@supabase/ssr` 0.5.2 écrase
   toute `maxAge` fournie ; fournir nos propres accès aux cookies est le seul moyen
   d'honorer la case « Rester connecté » et de marquer les cookies `Secure`.
2. **`lib/session.ts`** — au retour de l'utilisateur (`visibilitychange`, `focus`,
   `pageshow`, `online`) et toutes les 4 minutes, on relance `startAutoRefresh()` et
   on renouvelle le jeton s'il expire dans moins de 10 minutes. Le navigateur gèle
   les minuteurs des onglets en arrière-plan : sans ce rattrapage, on revient avec
   un jeton mort.
3. **`components/App.tsx`** — **une erreur passagère ne déconnecte jamais.** Seul un
   refus explicite (`AccesRefuseError` : profil absent, rôle interdit, compte
   désactivé) ferme la session. Tout le reste affiche un écran de reprise et
   réessaie par paliers. Un verrou de ré-entrance (`enCours`) empêche qu'un
   renouvellement de jeton relance un cycle de chargement, et inversement.

Banc d'essai : `faux-supabase.js` + `recette-session.js` (hors dépôt, décrits dans le
compte rendu de la consigne 02). Le jeton y expire en 20 s au lieu de 24 h, ce qui
permet de rejouer en quelques minutes ce qui prendrait une journée.
