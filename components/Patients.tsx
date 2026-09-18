'use client';

import React, { useEffect, useState } from 'react';
import { Confirm, Drawer, Empty, Field, Input, Textarea, useDirtyGuard } from './ui';
import { Ico } from './icons';
import { ListeAdaptative } from './ListeAdaptative';
import { useApp } from './AppContext';
import { can, estDeMoi } from '@/lib/perms';
import { patientName } from '@/lib/calc';
import type { Patient } from '@/lib/types';

/* =========================================================================
   PATIENTS — liste partagée avec le CRM Clinic Nobel : un patient créé ici
   apparaît dans le CRM, et inversement. Aucune fiche n'est jamais supprimée.
   ------------------------------------------------------------------------- */

export function PatientsView() {
  const { data, save, user, toast, cible, cibleAtteinte } = useApp();
  const [edit, setEdit] = useState<Partial<Patient> | null>(null);
  const [del, setDel] = useState<Patient | null>(null);
  const seeAllPat = can(user, 'all') || can(user, 'patientViewAll');
  const list = seeAllPat ? data.patients : data.patients.filter((p) => estDeMoi(user, p.createdBy));

  /* Arrivée depuis la recherche : la cible porte l'identifiant de la fiche,
     retrouvée dans les données — jamais un rang dans une liste. Consommée
     une fois, puis effacée. Une fiche introuvable se dit, ne se devine pas. */
  useEffect(() => {
    if (!cible || cible.type !== 'patient') return;
    const p = data.patients.find((x) => x.id === cible.id);
    if (p) setEdit(p);
    else toast('Fiche patient introuvable dans les données chargées.', 'err');
    cibleAtteinte();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cible]);

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Patients</h2>
            <div className="desc">{list.length} fiche(s)</div>
          </div>
        </div>
        <div className="sp" />
        {(can(user, 'patientCreate') || can(user, 'all')) && (
          <button className="btn btn-primary" onClick={() => setEdit({})}>
            <Ico.plus size={16} />Nouveau patient
          </button>
        )}
      </div>
      {/* Tableau au bureau, CARTES sous 640 px — même composant que les
          listes Factures, Devis et Paiements. */}
      <ListeAdaptative
        colonnes={[
          { titre: 'Patient' }, { titre: 'Téléphone' }, { titre: 'Pays' }, { titre: 'Email' }, { titre: 'Devis' }, {},
        ]}
        lignes={list.map((p) => {
          const nd = data.devis.filter((d) => d.patientId === p.id).length;
          const compte = <span className="chip">{nd}</span>;
          const actions = can(user, 'all') ? (
            <button
              className="btn btn-ghost btn-sm btn-danger"
              title="Signaler un doublon"
              onClick={(e) => { e.stopPropagation(); setDel(p); }}
            >
              <Ico.trash size={15} />
            </button>
          ) : undefined;
          return {
            cle: p.id,
            onClick: () => setEdit(p),
            cellules: [
              { contenu: patientName(p), className: 't-strong' },
              { contenu: p.telephone || '—', className: 'muted' },
              { contenu: p.pays || '—', className: 'muted' },
              { contenu: p.email || '—', className: 'muted' },
              { contenu: compte },
              { contenu: actions, style: { textAlign: 'right' as const } },
            ],
            carte: {
              /* Une fiche patiente n'a pas de numéro : le nom tient ce rôle.
                 Il se REPLIE, lui — un nom long imposé sur une ligne
                 déborderait de la carte et ramènerait le défilement
                 horizontal. Voir ListeAdaptative. */
              titre: patientName(p),
              titreInsecable: false,
              sousTitre: p.telephone || '—',
              /* Pays, email et nombre de devis passent en DÉTAILS, avec leur
                 libellé : sur une carte, un « 1 » ou un « France » seuls
                 perdent le sens que l'en-tête de colonne leur donnait. */
              details: [
                { libelle: 'Pays', valeur: p.pays || '—' },
                { libelle: 'Email', valeur: p.email || '—' },
                { libelle: 'Devis', valeur: compte },
              ],
            },
            actions,
          };
        })}
        vide={(
          <Empty
            icon={Ico.patient}
            title="Aucun patient"
            sub="Ajoutez votre première fiche patient."
            action={
              <button className="btn btn-primary" onClick={() => setEdit({})}>
                <Ico.plus size={16} />Nouveau patient
              </button>
            }
          />
        )}
      />
      {edit && (
        <PatientForm
          patient={edit}
          onClose={() => setEdit(null)}
          onSave={async (v) => {
            const isNew = !v.id;
            await save('patients', v, `${isNew ? 'a créé' : 'a modifié'} le patient ${patientName(v)}`);
            toast('Patient enregistré');
            setEdit(null);
          }}
        />
      )}
      {del && (
        <Confirm
          title="Fiche patient partagée"
          message={
            <>
              La fiche <b>{patientName(del)}</b> appartient à la liste unique partagée avec le CRM Clinic Nobel :
              elle ne peut pas être supprimée depuis Nobel World.
              <br />
              <br />
              S&apos;il s&apos;agit d&apos;un doublon, signalez-le à l&apos;administrateur du CRM.
            </>
          }
          yes="J'ai compris"
          onClose={() => setDel(null)}
          onYes={() => setDel(null)}
        />
      )}
    </>
  );
}

export function PatientForm({
  patient, onClose, onSave,
}: {
  patient: Partial<Patient>;
  onClose: () => void;
  onSave: (v: Partial<Patient>) => void | Promise<void>;
}) {
  const [f, setF] = useState<Partial<Patient>>({
    nom: '', prenom: '', telephone: '', email: '', pays: '', ville: '', commentaires: '', ...patient,
  });
  const g = useDirtyGuard(onClose);
  const set = (k: keyof Patient, v: string) => { g.touch(); setF((s) => ({ ...s, [k]: v })); };
  return (
    <Drawer
      title={patient.id ? 'Modifier le patient' : 'Nouveau patient'}
      onClose={g.close}
      footer={
        <>
          <button className="btn" onClick={g.close}>Annuler</button>
          <button className="btn btn-primary" disabled={!f.nom} onClick={() => onSave(f)}>
            <Ico.check size={16} />Enregistrer
          </button>
        </>
      }
    >
      <div className="row2">
        <Field label="Prénom"><Input value={f.prenom || ''} onChange={(e) => set('prenom', e.target.value)} /></Field>
        <Field label="Nom"><Input value={f.nom || ''} onChange={(e) => set('nom', e.target.value)} /></Field>
      </div>
      <Field label="Téléphone">
        <Input value={f.telephone || ''} onChange={(e) => set('telephone', e.target.value)} />
      </Field>
      <Field label="Email">
        <Input type="email" value={f.email || ''} onChange={(e) => set('email', e.target.value)} />
      </Field>
      <div className="row2">
        <Field label="Pays"><Input value={f.pays || ''} onChange={(e) => set('pays', e.target.value)} /></Field>
        <Field label="Ville"><Input value={f.ville || ''} onChange={(e) => set('ville', e.target.value)} /></Field>
      </div>
      <Field label="Commentaires">
        <Textarea value={f.commentaires || ''} onChange={(e) => set('commentaires', e.target.value)} />
      </Field>
      <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, margin: '4px 0 0' }}>
        Fiche partagée avec le CRM Clinic Nobel. Les champs <b>WhatsApp</b> et <b>Date de naissance</b> de
        l&apos;ancienne version n&apos;ont pas de colonne dans la table <code>patients</code> : ils sont signalés
        dans le compte rendu et n&apos;ont pas été ajoutés.
      </p>
    </Drawer>
  );
}
