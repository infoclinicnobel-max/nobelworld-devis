'use client';

/* Le champ de recherche — et pourquoi il ne peut pas être un champ contrôlé
   ordinaire.

   Signalé par Veys le 18/09/2026, Android, clavier SwiftKey, écran Factures :
   il tape « L a u », le champ affiche « uaL ». Les lettres arrivent dans
   l'ordre inverse de la frappe.

   Ce que le banc a mesuré, processeur bridé ×20 pour modéliser un Android
   d'entrée de gamme (scripts hors dépôt, chiffres au compte rendu) :

     · frappe « L » : le sous-arbre de `.content` est détruit et reconstruit
       (163 nœuds → 26), et la frappe provoque deux tâches bloquantes de
       60 ms puis 387 ms ;
     · frappes « a » puis « u » : encore 215 ms et 188 ms de tâche bloquante,
       parce que les résultats de recherche se recalculent et se réaffichent
       DANS LA MÊME TÂCHE que la frappe.

   Un fil principal bloqué des centaines de millisecondes pendant qu'une
   composition de clavier est en cours, c'est précisément ainsi que la zone
   de composition d'un IME Android se périme. Une fois périmée, elle pointe
   sur la position 0 : chaque lettre suivante s'insère AVANT les précédentes,
   ce qui donne L → aL → uaL. Le banc le reproduit exactement en forçant une
   zone de composition périmée — mais il le reproduit AUSSI sur un champ HTML
   nu, donc cette dernière étape est un modèle, pas une preuve.

   Trois précautions, toutes locales à la saisie :

   1. le DOM fait foi pendant la frappe (`defaultValue`, pas `value`) : React
      ne réécrit jamais le champ sous les doigts de l'utilisateur ;
   2. pendant une composition (`compositionstart` → `compositionend`), aucune
      synchronisation n'est tentée, même si la valeur extérieure change ;
   3. quand la valeur vient de l'EXTÉRIEUR (bouton « Effacer », navigation
      qui vide la recherche), le champ est mis à jour et le curseur reposé
      explicitement À LA FIN.

   La logique de recherche elle-même n'est pas touchée : ce fichier ne
   connaît que du texte. */

import React, { useEffect, useRef } from 'react';
import { Ico } from './icons';

export function ChampRecherche({
  valeur, onChange, placeholder,
}: {
  /** La valeur que l'application veut voir dans le champ. */
  valeur: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  /** Une composition de clavier est-elle en cours ? */
  const enComposition = useRef(false);
  /** La dernière valeur que le champ a émise — pour distinguer un écho d'un ordre extérieur. */
  const emise = useRef(valeur);

  /* Synchronisation DESCENDANTE seulement, et jamais pendant une composition.
     Si `valeur` est déjà ce que le champ contient, on ne touche à rien : une
     écriture inutile de `.value` est exactement ce qui déplaçait le curseur. */
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    if (enComposition.current) return;
    if (e.value === valeur) return;
    /* L'ordre vient de l'extérieur (Effacer, navigation) : on écrit, puis on
       repose le curseur à la fin — jamais en 0. */
    e.value = valeur;
    emise.current = valeur;
    if (document.activeElement === e) {
      const fin = valeur.length;
      try { e.setSelectionRange(fin, fin); } catch { /* champ non sélectionnable */ }
    }
  }, [valeur]);

  const remonter = (v: string) => {
    emise.current = v;
    onChange(v);
  };

  return (
    <div className="search">
      <Ico.search size={16} className="ic" />
      <input
        ref={ref}
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={placeholder}
        defaultValue={valeur}
        onCompositionStart={() => { enComposition.current = true; }}
        onCompositionEnd={(e) => {
          enComposition.current = false;
          remonter(e.currentTarget.value);
        }}
        onChange={(e) => remonter(e.currentTarget.value)}
      />
    </div>
  );
}
