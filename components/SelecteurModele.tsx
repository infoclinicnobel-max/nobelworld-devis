'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ico } from './icons';
import { money } from '@/lib/format';
import { filtrerModeles, grouperModeles } from '@/lib/catalogue';
import type { Modele } from '@/lib/types';

/* =========================================================================
   SÉLECTEUR DE MODÈLE — composant UNIQUE, employé par la liste des actes
   comme par celle des options. Le groupement, le tri et la recherche vivent
   dans lib/catalogue.ts : il n'existe donc qu'une implémentation, et les deux
   listes ne peuvent pas diverger.

   Il ne décide de rien : il rend le modèle choisi à son appelant, qui seul
   sait où l'écrire (un acte, une option, le devis entier). C'est ce qui règle
   le routage — la destination suit la section d'où la liste a été ouverte.
   ------------------------------------------------------------------------- */
export function SelecteurModele({
  modeles, onChoisir, libelle = 'Appliquer un modèle', devise = '€', className = 'addrow',
}: {
  modeles: Modele[];
  onChoisir: (m: Modele) => void;
  libelle?: string;
  devise?: string;
  className?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState('');
  const boite = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  const groupes = useMemo(() => grouperModeles(filtrerModeles(modeles, q)), [modeles, q]);
  const nbTrouves = groupes.reduce((n, g) => n + g.items.length, 0);

  // Fermeture au clic extérieur et à Échap — l'éditeur reste utilisable au clavier.
  useEffect(() => {
    if (!ouvert) return;
    champ.current?.focus();
    const dehors = (e: MouseEvent) => {
      if (boite.current && !boite.current.contains(e.target as Node)) setOuvert(false);
    };
    const clavier = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOuvert(false); }
    };
    document.addEventListener('mousedown', dehors);
    document.addEventListener('keydown', clavier, true);
    return () => {
      document.removeEventListener('mousedown', dehors);
      document.removeEventListener('keydown', clavier, true);
    };
  }, [ouvert]);

  const choisir = (m: Modele) => {
    onChoisir(m);
    setOuvert(false);
    setQ('');
  };

  return (
    <div className="modsel" ref={boite}>
      <button type="button" className={className} onClick={() => setOuvert((v) => !v)}>
        <Ico.tpl size={14} />{libelle}
      </button>
      {ouvert && (
        <div className="modsel-pan">
          <div className="modsel-q">
            <Ico.search size={15} className="ic" />
            <input
              ref={champ}
              value={q}
              placeholder="Rechercher — libellé ou autre appellation…"
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="modsel-list">
            {groupes.map((g) => (
              <div key={g.titre}>
                <div className="modsel-grp">{g.titre} · {g.items.length}</div>
                {g.items.map((m) => (
                  <button key={m.id} type="button" className="modsel-it" onClick={() => choisir(m)}>
                    <span className="nm">{m.nom}</span>
                    <span className="px">{m.surDevis ? 'sur devis' : money(m.prixBase, devise)}</span>
                  </button>
                ))}
              </div>
            ))}
            {!nbTrouves && (
              <div className="modsel-vide">
                Aucune prestation ne correspond. Le catalogue appartient au CRM Clinic Nobel :
                une prestation absente doit y être ajoutée.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
