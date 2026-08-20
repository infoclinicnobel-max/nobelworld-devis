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
  `patients`). Le rapport gagne un mode `--sql` qui **imprime** les `UPDATE` au lieu de les
  passer : le fichier n'ouvre toujours aucune connexion, et le SQL est relu avant d'être
  exécuté. **Chaque ordre porte sa propre garde** — `and coalesce("colonne", '') = <la
  valeur lue>` — si bien que la règle ne vit pas seulement dans le script : rejouer le lot
  n'écrit rien, et un instantané périmé ne peut ni écraser une saisie faite entre-temps ni
  faire reculer un `stade`.
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
