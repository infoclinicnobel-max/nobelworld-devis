'use client';

import React, { useState } from 'react';
import { Confirm, Drawer, Empty, Field, Input, Textarea, useDirtyGuard } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { can, estDeMoi } from '@/lib/perms';
import { patientName } from '@/lib/calc';
import type { Patient } from '@/lib/types';

/* =========================================================================
   PATIENTS — liste partagée avec le CRM Clinic Nobel : un patient créé ici
   apparaît dans le CRM, et inversement. Aucune fiche n'est jamais supprimée.
   ------------------------------------------------------------------------- */

export function PatientsView() {
  const { data, save, user, toast } = useApp();
  const [edit, setEdit] = useState<Partial<Patient> | null>(null);
  const [del, setDel] = useState<Patient | null>(null);
  const seeAllPat = can(user, 'all') || can(user, 'patientViewAll');
  const list = seeAllPat ? data.patients : data.patients.filter((p) => estDeMoi(user, p.createdBy));

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
      <div className="card">
        {list.length ? (
          <table>
            <thead>
              <tr>
                <th>Patient</th><th>Téléphone</th><th>Pays</th><th>Email</th><th>Devis</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const nd = data.devis.filter((d) => d.patientId === p.id).length;
                return (
                  <tr key={p.id} className="clickable" onClick={() => setEdit(p)}>
                    <td className="t-strong">{patientName(p)}</td>
                    <td className="muted">{p.telephone || '—'}</td>
                    <td className="muted">{p.pays || '—'}</td>
                    <td className="muted">{p.email || '—'}</td>
                    <td><span className="chip">{nd}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {can(user, 'all') && (
                        <button
                          className="btn btn-ghost btn-sm btn-danger"
                          title="Signaler un doublon"
                          onClick={(e) => { e.stopPropagation(); setDel(p); }}
                        >
                          <Ico.trash size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
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
      </div>
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
