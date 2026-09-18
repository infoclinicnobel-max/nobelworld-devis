/* Le bloc bancaire des devis et des factures — PUR, sans connexion.

   Décidé avec Veys le 18/09/2026. Le compte est chez **Paysera LT, UAB**, au
   nom de la société **Clinic NobelWorld** — pas au nom d'une personne. Le
   bloc affichait deux lignes serrées (« BUNQ: VEYSEL TURAN — Lituanie » puis
   « IBAN … · BIC … ») dans un texte de 12,5 px, plus petit que le corps du
   document (13 px). Il affiche désormais CINQ lignes entières :

       Bénéficiaire  : Clinic NobelWorld
       IBAN          : LT69 3500 0100 1914 7464
       BIC / SWIFT   : EVIULT2VXXX
       Banque        : Paysera LT, UAB
       Pays          : Lituanie

   ⚠ L'IBAN affiché est le MÊME que celui stocké : `formaterIban` n'ajoute que
   des espaces tous les quatre caractères. Aucune valeur n'est réécrite en
   base, et `cleIban` prouve l'égalité dans les deux sens.

   ---- Pourquoi un document déjà émis ne change pas de compte ----

   Mesuré le 18/09 sur les 48 documents en base : ils portent CINQ comptes
   photographiés différents (2 comptes BUNQ français, un turc QNB, le compte
   Paysera lituanien, et 13 documents sans photographie du tout). Un document
   émis sur un compte retiré ne doit pas se voir réécrire son bénéficiaire :
   ce serait affirmer, sur un document déjà entre les mains d'une patiente,
   que l'argent allait ailleurs qu'où il allait.

   La règle est donc l'IDENTITÉ DU COMPTE, pas la date :
   · IBAN photographié absent, vide, ou ÉGAL à celui des Paramètres
     → le document est sur le compte courant : les cinq lignes corrigées.
       Les libellés autour de l'IBAN étaient faux (« BUNQ » pour un compte
       Paysera tenu par la société), la correction leur appartient.
   · IBAN photographié DIFFÉRENT
     → le document est sur un autre compte : son bloc d'origine, intact.

   Cette règle se protège toute seule : les libellés des Paramètres ne
   s'affichent que devant l'IBAN des Paramètres. Le jour où le compte change,
   les documents de l'ancien compte repassent d'eux-mêmes en forme historique.

   Recette : scripts/recette-bloc-bancaire.ts */

import type { Settings } from './defaults';
import type { DocRecord } from './types';

/** Caractères significatifs d'un IBAN : ni espaces, ni casse. */
export const cleIban = (v: unknown) => String(v ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();

/** Deux IBAN désignent-ils le même compte ? « LT69… » et « LT69 3500… » : oui. */
export function memeCompte(a: unknown, b: unknown): boolean {
  const x = cleIban(a);
  const y = cleIban(b);
  return !!x && x === y;
}

/* Groupes de quatre, le dernier pouvant être plus court. L'affichage rend
   chaque groupe insécable : une ligne peut aller à la ligne ENTRE deux
   groupes, jamais au milieu de l'un d'eux. */
export function groupesIban(iban: unknown): string[] {
  const net = cleIban(iban);
  if (!net) return [];
  return net.match(/.{1,4}/g) || [];
}

/** « LT693500010019147464 » → « LT69 3500 0100 1914 7464 ». Mêmes caractères, espaces en plus. */
export const formaterIban = (iban: unknown) => groupesIban(iban).join(' ');

/* Longueur normalisée d'un IBAN, par pays — pour SIGNALER une amputation là
   où elle se corrige (l'écran Paramètres), jamais sur un document patient.

   Motif mesuré le 18/09 : onze documents déjà émis (D-2026-000041 à 000047,
   F-2026-000026, 000029, 000030, 000033) portent « FR76 2763 3121 2904 8317
   894 » — 23 caractères au lieu de 27, un groupe de quatre (« 0491 ») perdu,
   et un BIC vide. Un virement sur cet IBAN est impossible. Ces documents ne
   sont PAS réécrits par ce lot ; le contrôle existe pour que la faute ne se
   reproduise pas à la saisie suivante.

   Un pays absent de la table est réputé plausible : mieux vaut se taire que
   crier au loup sur un IBAN parfaitement valide. */
const LONGUEURS_IBAN: Record<string, number> = {
  BE: 16, NL: 18, LT: 20, LU: 20, CH: 21, DE: 22, GB: 22, ES: 24, PT: 25, TR: 26, FR: 27, IT: 27, PL: 28,
};

export function ibanPlausible(iban: unknown): boolean {
  const net = cleIban(iban);
  if (!net) return true; // pas d'IBAN : rien à dire
  const attendue = LONGUEURS_IBAN[net.slice(0, 2)];
  return attendue == null ? true : net.length === attendue;
}

/** Combien de caractères manquent (ou sont en trop) — 0 si la longueur est juste ou inconnue. */
export function ecartLongueurIban(iban: unknown): number {
  const net = cleIban(iban);
  const attendue = LONGUEURS_IBAN[net.slice(0, 2)];
  return !net || attendue == null ? 0 : net.length - attendue;
}

export interface LigneBanque {
  libelle: string;
  valeur: string;
  /** Rendu par groupes insécables de quatre. */
  iban?: boolean;
}

export interface BlocBancaire {
  /** 'cinq' : le bloc corrigé. 'historique' : document sur un autre compte, bloc d'origine conservé. */
  forme: 'cinq' | 'historique';
  /** Les cinq lignes, dans l'ordre. Une ligne sans valeur n'est jamais fabriquée. */
  lignes: LigneBanque[];
  /** Les valeurs retenues POUR CETTE FORME : le document seul en historique, le document ou les Paramètres en forme « cinq ». */
  photo: { nom: string; adresse: string; iban: string; bic: string };
}

/* Précédence d'origine, pour un document sur le compte COURANT : une valeur
   photographiée l'emporte ; un document sans photographie affiche les
   Paramètres (comportement historique, conservé). */
function avecReplis(record: DocRecord, s: Partial<Settings>) {
  return {
    nom: record.bqNom != null ? String(record.bqNom) : String(s.bankName || ''),
    adresse: record.bqAdresse != null ? String(record.bqAdresse) : String(s.bankAddress || ''),
    iban: record.bqIban != null && record.bqIban !== '' ? String(record.bqIban) : String(s.iban || ''),
    bic: record.bqBic != null && record.bqBic !== '' ? String(record.bqBic) : String(s.bic || ''),
  };
}

/* Un document sur un AUTRE compte n'emprunte RIEN aux Paramètres.

   Motif mesuré le 18/09 : les onze documents au compte BUNQ français portent
   un BIC photographié VIDE. Avec le repli d'origine, ce vide allait chercher
   le BIC des Paramètres — aujourd'hui « EVIULT2VXXX », celui de Paysera en
   Lituanie. Le document affichait donc un IBAN français sous un BIC
   lituanien : un couple qui n'a jamais existé dans aucune banque. Le repli
   n'a de sens que pour un document sur le compte courant ; ici, le document
   ne dit que ce qu'il porte, et se taira sur ce qu'il ne porte pas. */
function sansReplis(record: DocRecord) {
  return {
    nom: String(record.bqNom ?? ''),
    adresse: String(record.bqAdresse ?? ''),
    iban: String(record.bqIban ?? ''),
    bic: String(record.bqBic ?? ''),
  };
}

export function blocBancaire(record: DocRecord, settings: Partial<Settings>): BlocBancaire {
  const s = settings || {};

  /* Le document est-il sur le compte courant ? Un IBAN photographié absent ou
     vide retombe sur celui des Paramètres : c'est le compte courant. */
  const ibanDoc = String(record.bqIban ?? '');
  const surCompteCourant = !cleIban(ibanDoc) || memeCompte(ibanDoc, s.iban);
  if (!surCompteCourant) return { forme: 'historique', lignes: [], photo: sansReplis(record) };

  const photo = avecReplis(record, s);

  /* Bénéficiaire et pays ont leurs propres réglages ; à défaut, la raison
     sociale et l'adresse bancaire, qui portaient déjà les bonnes valeurs.
     Le bénéficiaire N'EST PAS la raison sociale par nature — c'est le
     titulaire du compte, et c'est précisément ce qui était faux ici. */
  const beneficiaire = String(s.bankBeneficiary || s.company || '').trim();
  const pays = String(s.bankCountry || s.bankAddress || '').trim();
  const brut: LigneBanque[] = [
    { libelle: 'Bénéficiaire', valeur: beneficiaire },
    { libelle: 'IBAN', valeur: formaterIban(photo.iban), iban: true },
    { libelle: 'BIC / SWIFT', valeur: photo.bic.trim() },
    { libelle: 'Banque', valeur: String(s.bankName || '').trim() },
    { libelle: 'Pays', valeur: pays },
  ];
  return { forme: 'cinq', lignes: brut.filter((l) => !!l.valeur), photo };
}
