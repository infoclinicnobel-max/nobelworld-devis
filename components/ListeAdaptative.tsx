'use client';

/* Une liste, deux rendus : le tableau au bureau, des CARTES sur téléphone.

   Décidé le 18/09/2026 après mesure, sur la liste des Factures signalée par
   Veys. Relevé au banc à 360 px, avant ce lot (plage de texte, un rectangle
   par ligne — une cellule de tableau, elle, renvoie toujours un rectangle
   même quand son texte passe trois fois à la ligne) :

     · « F-2026-000026 » rendu sur TROIS lignes (F- / 2026- / 000026) ;
     · « / 7 600 € » sur deux lignes, le « € » seul en bas ;
     · « Acompte reçu » sur trois lignes ;
     · document large de 644 px dans une fenêtre de 360 — la page défilait
       latéralement et passait sous le menu.

   Rétrécir la police ou les marges n'y change rien : un tableau de six
   colonnes reste un tableau de six colonnes. Sous le seuil, chaque ligne
   devient donc une carte, et TOUTE l'information du tableau y reste — on ne
   masque aucune colonne, on la réécrit en clair.

   Au-dessus du seuil, le tableau est rendu à l'identique : ce composant se
   contente de recopier les cellules qu'on lui donne, avec leurs classes et
   leurs styles. Le seuil vit dans la feuille de style (640 px), pas ici :
   aucun rendu ne dépend d'une mesure JavaScript, donc rien ne clignote au
   chargement ni à la rotation de l'écran.

   Un seul composant pour les quatre listes (Factures, Devis, Paiements,
   Patients) : il ne peut pas exister quatre mises en page divergentes. */

import React from 'react';

export interface ColonneListe {
  /** L'en-tête de colonne. Vide pour la colonne des actions. */
  titre?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export interface CelluleListe {
  contenu: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** Cellule des actions : le clic ne doit pas ouvrir la ligne. */
  stop?: boolean;
}

export interface CarteListe {
  /** Ligne 1 : le numéro du document, ou l'identité principale. */
  titre: React.ReactNode;
  /* Le titre est-il insécable ? OUI pour un numéro de document — « F-2026-
     000026 » fait treize caractères, tient partout, et se couper serait la
     faute même que ce lot répare. NON pour un nom de personne : « Jean-
     Christophe Delacroix-Vandenberghe » mesure 290 px en gras, et l'imposer
     sur une ligne le ferait déborder de la carte à 360 px — donc ramènerait
     le défilement horizontal qu'on vient de supprimer. Un nom se replie,
     un numéro jamais. Mesuré au banc. */
  titreInsecable?: boolean;
  /** Ligne 1, en dessous : le nom de la patiente, ou le libellé secondaire. */
  sousTitre?: React.ReactNode;
  /** Ligne 2, à gauche : la date. */
  date?: React.ReactNode;
  /** Ligne 2, à droite : la pastille de statut. Tient sur une ligne. */
  statut?: React.ReactNode;
  /** Ligne 3 : payé / total, ou le montant. Insécable, symbole monétaire compris. */
  montant?: React.ReactNode;
  /** Le reste de l'information du tableau, en clair. Rien ne se perd. */
  details?: { libelle: string; valeur: React.ReactNode }[];
}

export interface LigneListe {
  cle: string;
  onClick?: () => void;
  /** Les cellules du tableau, dans l'ordre des colonnes. */
  cellules: CelluleListe[];
  carte: CarteListe;
  /** Les actions, rendues dans le tableau ET dans la carte. */
  actions?: React.ReactNode;
}

export function ListeAdaptative({
  colonnes, lignes, vide, cadre = true,
}: {
  colonnes: ColonneListe[];
  lignes: LigneListe[];
  /** Ce qu'on affiche quand la liste est vide (composant Empty, en général). */
  vide?: React.ReactNode;
  /* La liste porte-t-elle son propre cadre blanc ? Non quand l'appelant en a
     déjà un — la section « Paiements non rattachés » ouvre sa carte avec un
     paragraphe d'explication, et deux cadres imbriqués donneraient un double
     liseré au bureau, là où rien ne doit changer. */
  cadre?: boolean;
}) {
  if (!lignes.length) return cadre ? <div className="card">{vide}</div> : <>{vide}</>;

  return (
    <div className="liste">
      {/* ---- Bureau : le tableau d'origine, cellule pour cellule ---- */}
      <div className={'liste-tableau' + (cadre ? ' card' : '')}>
        <table>
          <thead>
            <tr>
              {colonnes.map((c, i) => (
                <th key={i} className={c.className} style={c.style}>{c.titre}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr
                key={l.cle}
                className={l.onClick ? 'clickable' : undefined}
                onClick={l.onClick}
              >
                {l.cellules.map((c, i) => (
                  <td
                    key={i}
                    className={c.className}
                    style={c.style}
                    onClick={c.stop ? (e) => e.stopPropagation() : undefined}
                  >
                    {c.contenu}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Téléphone : une carte par ligne ---- */}
      <div className="liste-cartes">
        {lignes.map((l) => (
          <div key={l.cle} className="carte">
            <div
              className={'carte-corps' + (l.onClick ? ' clickable' : '')}
              onClick={l.onClick}
              role={l.onClick ? 'button' : undefined}
              tabIndex={l.onClick ? 0 : undefined}
              onKeyDown={l.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); l.onClick!(); } } : undefined}
            >
              <div className="carte-h">
                {/* Le numéro porte sa propre classe : c'est elle, et elle
                    seule, qui garantit qu'il ne se coupe pas. */}
                <span className={'carte-num' + (l.carte.titreInsecable === false ? ' carte-num-libre' : '')}>
                  {l.carte.titre}
                </span>
                {l.carte.sousTitre != null && l.carte.sousTitre !== '' && (
                  <span className="carte-nom">{l.carte.sousTitre}</span>
                )}
              </div>
              {(l.carte.date != null || l.carte.statut != null) && (
                <div className="carte-l">
                  <span className="carte-date">{l.carte.date}</span>
                  {l.carte.statut != null && <span className="carte-statut">{l.carte.statut}</span>}
                </div>
              )}
              {l.carte.montant != null && l.carte.montant !== '' && (
                <div className="carte-montant">{l.carte.montant}</div>
              )}
              {!!l.carte.details?.length && (
                <dl className="carte-details">
                  {l.carte.details.map((d) => (
                    <React.Fragment key={d.libelle}>
                      <dt>{d.libelle}</dt>
                      <dd>{d.valeur}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              )}
            </div>
            {l.actions && <div className="carte-actions">{l.actions}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Un montant, insécable — symbole monétaire et espace des milliers comprises. */
export const Montant = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={'montant' + (className ? ' ' + className : '')}>{children}</span>
);
