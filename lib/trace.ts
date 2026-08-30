/* Trace des modifications d'une facture — le crayon écrit ce qu'il change.

   Motif, décidé par Veys le 19 août 2026 : le jour où une patiente dit « ma
   facture indiquait 10 500 € », la réponse doit être à l'écran. La trace part
   dans nw_historique — le canal qui porte déjà « a créé la facture… »,
   « a annulé… », « a supprimé… » — via le message de save(), sans rien
   demander à l'utilisateur : il clique, ça se fait.

   Mesuré avant d'écrire : 2 factures sur 13 « modifiées » après création, et
   les deux sont des annulations. Le crayon n'existait pas ; quand il a fallu
   retirer une option de 2 000 € d'une facture émise (17 août, F-2026-000024),
   la facture a été supprimée et refaite. Ce fichier est la moitié « mémoire »
   du crayon qui referme ce contournement.

   Tout est PUR et sans connexion : la recette scripts/recette-crayon-facture.ts
   rejoue chaque forme de changement, dont le scénario du 17 août. */

import { money } from './format';
import { totalOf } from './calc';
import type { DocOption, DocRecord } from './types';

/* Un extrait court : la trace nomme ce qui a changé sans recopier des
   paragraphes entiers dans l'historique. Les montants, eux, sont toujours
   entiers — c'est eux qu'on viendra chercher. */
const court = (v: unknown, n = 60): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return '(vide)';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
};

const texte = (v: unknown) => String(v ?? '').trim();
const nombre = (v: unknown) => Number(v || 0);

interface ChampScalaire { cle: keyof DocRecord & string; libelle: string; argent?: boolean; long?: boolean }

/* Les champs comparés un à un. `long` borne l'ancien et le nouveau à un
   extrait — assez pour prouver le changement, pas assez pour noyer la liste. */
const SCALAIRES: readonly ChampScalaire[] = [
  { cle: 'statut', libelle: 'statut' },
  { cle: 'typeFacture', libelle: 'type de facture' },
  { cle: 'forfait', libelle: 'forfait', argent: true },
  { cle: 'acompte', libelle: 'acompte', argent: true },
  { cle: 'date', libelle: 'date de facture' },
  { cle: 'dateIntervention', libelle: "date d'intervention" },
  { cle: 'validite', libelle: 'validité' },
  { cle: 'chirurgien', libelle: 'chirurgien' },
  { cle: 'hopital', libelle: 'clinique' },
  { cle: 'devise', libelle: 'devise' },
  { cle: 'remiseMotif', libelle: 'motif de la remise' },
  { cle: 'cgv', libelle: 'notes médicales et administratives', long: true },
  { cle: 'legal', libelle: 'mentions finales', long: true },
  { cle: 'paiementNote', libelle: 'modalités de paiement', long: true },
  { cle: 'factNotes', libelle: 'mentions administratives', long: true },
  { cle: 'noteInterne', libelle: 'note interne', long: true },
  { cle: 'bqNom', libelle: 'banque — nom' },
  { cle: 'bqAdresse', libelle: 'banque — adresse', long: true },
  { cle: 'bqIban', libelle: 'IBAN' },
  { cle: 'bqBic', libelle: 'BIC' },
] as const;

const montantOption = (o: DocOption) => Number(o.qty || 1) * Number(o.prix || 0);

/* Appariement par identifiant quand il existe, par position sinon : les
   options et actes d'avant ce lot n'ont pas toujours d'id, et une liste
   inchangée ne doit produire aucune ligne. */
const cleDe = (id: unknown, i: number) => (id ? String(id) : '#' + i);

const enMap = <T>(list: T[] | undefined, idOf: (t: T) => unknown): Map<string, T> => {
  const m = new Map<string, T>();
  (list || []).forEach((t, i) => m.set(cleDe(idOf(t), i), t));
  return m;
};

/* Listes de chaînes (prestations incluses / exclues / conditions) : on dit ce
   qui entre et ce qui sort. Une reformulation apparaît comme retrait + ajout —
   c'est moins fin qu'un vrai diff, et c'est suffisant pour prouver. */
function diffListe(libelle: string, avant: string[] | undefined, apres: string[] | undefined, d: string[]) {
  const a = (avant || []).map(texte).filter(Boolean);
  const b = (apres || []).map(texte).filter(Boolean);
  const setA = new Set(a);
  const setB = new Set(b);
  for (const v of b) if (!setA.has(v)) d.push(`${libelle} ajoutée : « ${court(v)} »`);
  for (const v of a) if (!setB.has(v)) d.push(`${libelle} retirée : « ${court(v)} »`);
}

/** Ce que le crayon a changé, phrase par phrase. Vide = rien n'a changé.
    `nomPatient` traduit un identifiant en nom pour la trace — sans lui, un
    changement de rattachement s'écrit avec les identifiants bruts : illisible
    mais jamais silencieux. */
export function differencesFacture(
  avant: DocRecord, apres: DocRecord, devise: string,
  nomPatient?: (id: string) => string,
): string[] {
  const d: string[] = [];

  /* Le total d'abord : c'est LA question qu'on viendra poser à cette trace. */
  const tA = totalOf(avant);
  const tB = totalOf(apres);
  if (tA !== tB) d.push(`total : ${money(tA, devise)} → ${money(tB, devise)}`);

  /* Changer la patiente d'une facture émise est le geste le plus lourd que le
     crayon permette : il se trace en toutes lettres. */
  if (texte(avant.patientId) !== texte(apres.patientId)) {
    const nom = (id: unknown) => (nomPatient ? nomPatient(String(id ?? '')) : String(id ?? '')) || '(aucun)';
    d.push(`patient : ${nom(avant.patientId)} → ${nom(apres.patientId)}`);
  }

  for (const c of SCALAIRES) {
    const va = (avant as Record<string, unknown>)[c.cle];
    const vb = (apres as Record<string, unknown>)[c.cle];
    if (c.argent) {
      if (nombre(va) !== nombre(vb)) d.push(`${c.libelle} : ${money(nombre(va), devise)} → ${money(nombre(vb), devise)}`);
      continue;
    }
    if (texte(va) === texte(vb)) continue;
    d.push(c.long
      ? `${c.libelle} : « ${court(va)} » → « ${court(vb)} »`
      : `${c.libelle} : ${court(va, 90)} → ${court(vb, 90)}`);
  }

  /* La remise se juge sur son effet, pas sur ses deux champs séparés. */
  const rA = `${nombre(avant.remiseValeur)}${avant.remiseType === 'pourcent' ? ' %' : ' ' + devise}`;
  const rB = `${nombre(apres.remiseValeur)}${apres.remiseType === 'pourcent' ? ' %' : ' ' + devise}`;
  if (rA !== rB) d.push(`remise : ${rA} → ${rB}`);

  /* Actes. */
  {
    const mA = enMap(avant.actes, (a) => a.id);
    const mB = enMap(apres.actes, (a) => a.id);
    for (const [k, b] of mB) {
      const a = mA.get(k);
      if (!a) {
        if (texte(b.acte) || texte(b.inclus)) d.push(`acte ajouté : « ${court(b.acte)} »`);
        continue;
      }
      if (texte(a.acte) !== texte(b.acte)) d.push(`acte : « ${court(a.acte)} » → « ${court(b.acte)} »`);
      if (texte(a.inclus) !== texte(b.inclus)) d.push(`détail de l'acte « ${court(b.acte || a.acte)} » modifié`);
    }
    for (const [k, a] of mA) {
      if (!mB.has(k) && (texte(a.acte) || texte(a.inclus))) d.push(`acte retiré : « ${court(a.acte)} »`);
    }
  }

  /* Options — le cas du 17 août. Chaque mouvement porte son montant. */
  {
    const mA = enMap(avant.options, (o) => o.id);
    const mB = enMap(apres.options, (o) => o.id);
    for (const [k, b] of mB) {
      const a = mA.get(k);
      if (!a) {
        if (texte(b.nom) || montantOption(b)) {
          d.push(`option ajoutée : « ${court(b.nom)} » (${money(montantOption(b), devise)}${b.retenue === false ? ', non retenue' : ''})`);
        }
        continue;
      }
      if (texte(a.nom) !== texte(b.nom)) d.push(`option : « ${court(a.nom)} » → « ${court(b.nom)} »`);
      if (montantOption(a) !== montantOption(b)) {
        d.push(`option « ${court(b.nom || a.nom)} » : ${money(montantOption(a), devise)} → ${money(montantOption(b), devise)}`);
      }
      /* `retenue` ABSENTE vaut retenue (estRetenue) : on compare l'effet. */
      const retA = a.retenue !== false;
      const retB = b.retenue !== false;
      if (retA !== retB) d.push(`option « ${court(b.nom || a.nom)} » ${retB ? 'retenue' : 'plus retenue'}`);
      if (texte(a.detail) !== texte(b.detail)) d.push(`détail de l'option « ${court(b.nom || a.nom)} » modifié`);
    }
    for (const [k, a] of mA) {
      if (!mB.has(k) && (texte(a.nom) || montantOption(a))) {
        d.push(`option retirée : « ${court(a.nom)} » (${money(montantOption(a), devise)})`);
      }
    }
  }

  diffListe('prestation incluse', avant.inc, apres.inc, d);
  diffListe('prestation exclue', avant.exc, apres.exc, d);
  diffListe('condition importante', avant.importantList, apres.importantList, d);

  return d;
}

/** Le message d'historique, borné : au-delà de 14 changements, le compte des
    restants — la trace dit toujours COMBIEN, même quand elle ne détaille plus. */
export function messageModificationFacture(numero: string, diffs: string[]): string {
  const MAX = 14;
  const liste = diffs.length > MAX
    ? [...diffs.slice(0, MAX), `…et ${diffs.length - MAX} autre(s) changement(s)`]
    : diffs;
  return `a modifié la facture ${numero} — ${liste.join(' · ')}`;
}
