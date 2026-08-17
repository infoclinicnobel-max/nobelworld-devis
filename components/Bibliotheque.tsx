'use client';

import React, { useState } from 'react';
import { Empty, Field, Input, Modal } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { money, safeLower } from '@/lib/format';
import { can } from '@/lib/perms';
import { UNSAVED_MSG } from '@/lib/defaults';
import type { OptionCat } from '@/lib/types';

/* =========================================================================
   MODÈLES DE DEVIS — adossés à `catalogue_interventions`, propriété du CRM.
   Lecture seule : Nobel World n'y crée, ne modifie ni ne supprime aucune ligne.
   ------------------------------------------------------------------------- */
export function ModelesView() {
  const { data } = useApp();
  const cur = data.parametres.currency || '€';
  const [q, setQ] = useState('');
  const s = safeLower(q).trim();
  const list = s
    ? data.modeles.filter((m) => [m.nom, m.categorie, m.sousCategorie, m.description].some((v) => safeLower(v).includes(s)))
    : data.modeles;

  /* Anciens libellés Nobel World restés sans correspondance au catalogue :
     l'application le signale à l'écran, elle ne crée jamais de ligne. */
  const sansCorrespondance = data.correspondances.filter((c) => !c.catalogueId);

  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Modèles de devis</h2>
            <div className="desc">{list.length} prestation(s) au catalogue</div>
          </div>
        </div>
        <div className="sp" />
        <div className="search" style={{ maxWidth: 280 }}>
          <Ico.search size={16} className="ic" />
          <input placeholder="Rechercher une prestation…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <div
        className="card card-pad"
        style={{ marginBottom: 16, background: 'var(--surface)', fontSize: 12.5, lineHeight: 1.6 }}
      >
        <b>Catalogue en lecture seule.</b> Les tarifs et les libellés appartiennent au CRM Clinic Nobel : Nobel World
        les applique aux devis mais ne les modifie jamais. Une prestation manquante doit être ajoutée dans le CRM.
      </div>

      {!!sansCorrespondance.length && (
        <div
          className="card card-pad"
          style={{
            marginBottom: 16, background: '#fff7e8', border: '1px solid #f0dcae',
            color: '#7a5d1f', fontSize: 12.5, lineHeight: 1.6,
          }}
        >
          ⚠ {sansCorrespondance.length} ancien(s) libellé(s) Nobel World sans correspondance au catalogue :{' '}
          {sansCorrespondance.map((c) => c.libelle).join(' · ')}. Ces libellés restent utilisables en saisie libre sur
          un devis ; leur rattachement se fait côté CRM.
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))' }}>
        {list.map((m) => (
          <div key={m.id} className="card card-pad">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div className="t-strong" style={{ fontSize: 15 }}>{m.nom}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {m.categorie}
                  {m.sousCategorie ? ' · ' + m.sousCategorie : ''}
                </div>
              </div>
              <span className="badge b-part" style={{ whiteSpace: 'nowrap' }}>
                {m.surDevis ? 'Sur devis' : money(m.prixBase, cur)}
              </span>
            </div>
            {m.prixStandard != null && m.prixStandard !== m.prixBase && !m.surDevis && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                Tarif standard : {money(m.prixStandard, cur)}
              </div>
            )}
            {m.description ? (
              <p className="muted" style={{ fontSize: 12.5, margin: '10px 0', lineHeight: 1.55 }}>
                {m.description.slice(0, 120)}
                {m.description.length > 120 ? '…' : ''}
              </p>
            ) : (
              /* Signalé à l'écran plutôt que deviné : sans description, la case
                 « Inclus / détail » du devis sortira vide et devra être rédigée. */
              <p style={{ fontSize: 12, margin: '10px 0', lineHeight: 1.55, color: 'var(--warn)' }}>
                Aucune description — la case « Inclus / détail » du devis sera à rédiger.
              </p>
            )}
            <div className="muted" style={{ fontSize: 11.5 }}>
              {(m.inc || []).length} incluses · {(m.exc || []).length} exclues
              {m.dureeNuits != null ? ` · ${m.dureeNuits} nuit(s)` : ''}
            </div>
          </div>
        ))}
      </div>
      {!list.length && (
        <div className="card">
          <Empty icon={Ico.tpl} title="Aucune prestation" sub="Aucune ligne du catalogue ne correspond à cette recherche." />
        </div>
      )}
    </>
  );
}

/* =========================================================================
   OPTIONS (suppléments) — table nw_options, propriété de Nobel World.
   ------------------------------------------------------------------------- */
export function OptionsView() {
  const { data, user, save, remove, toast } = useApp();
  const cur = data.parametres.currency || '€';
  const [edit, setEdit] = useState<Partial<OptionCat> | null>(null);
  const [optDirty, setOptDirty] = useState(false);
  const admin = can(user, 'catalogManage') || can(user, 'all');
  const fermer = () => {
    if (optDirty && !window.confirm(UNSAVED_MSG)) return;
    setOptDirty(false);
    setEdit(null);
  };
  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Options</h2>
            <div className="desc">{data.options.length} option(s)</div>
          </div>
        </div>
        <div className="sp" />
        {admin && (
          <button className="btn btn-primary" onClick={() => setEdit({})}>
            <Ico.plus size={16} />Nouvelle option
          </button>
        )}
      </div>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th className="r" style={{ textAlign: 'right' }}>Prix</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.options.map((o) => (
              <tr key={o.id}>
                <td className="t-strong">{o.nom}</td>
                <td className="tnum" style={{ textAlign: 'right' }}>{money(o.prix, cur)}</td>
                <td style={{ textAlign: 'right' }}>
                  {admin && (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEdit(o)}>
                        <Ico.edit size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={async () => {
                          await remove('options', o.id, `a supprimé l'option ${o.nom}`);
                          toast('Option supprimée', 'err');
                        }}
                      >
                        <Ico.trash size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <Modal
          small
          title={edit.id ? "Modifier l'option" : 'Nouvelle option'}
          onClose={fermer}
          footer={
            <>
              <button className="btn" onClick={fermer}>Annuler</button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  await save('options', edit, `a enregistré l'option ${edit.nom || ''}`);
                  toast('Option enregistrée');
                  setOptDirty(false);
                  setEdit(null);
                }}
              >
                <Ico.check size={16} />Enregistrer
              </button>
            </>
          }
        >
          <Field label="Nom">
            <Input
              value={edit.nom || ''}
              onChange={(e) => { setOptDirty(true); setEdit({ ...edit, nom: e.target.value }); }}
            />
          </Field>
          <Field label="Prix">
            <Input
              type="number"
              value={edit.prix ?? 0}
              onChange={(e) => { setOptDirty(true); setEdit({ ...edit, prix: Number(e.target.value) }); }}
            />
          </Field>
        </Modal>
      )}
    </>
  );
}

/* =========================================================================
   HISTORIQUE
   ------------------------------------------------------------------------- */
export function HistoriqueView() {
  const { data } = useApp();
  const list = [...(data.historique || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const groups: Record<string, typeof list> = {};
  list.forEach((h) => {
    const d = new Date(h.date);
    const day = isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    (groups[day] = groups[day] || []).push(h);
  });
  return (
    <div className="card card-pad">
      <div className="sec-head">
        <div>
          <h2>Historique</h2>
          <div className="desc">Toutes les actions de l&apos;équipe</div>
        </div>
      </div>
      {list.length ? (
        Object.entries(groups).map(([day, items]) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>{day}</div>
            {items.map((h) => (
              <div
                key={h.id}
                style={{
                  display: 'flex', gap: 12, padding: '8px 0', borderLeft: '2px solid var(--line)',
                  paddingLeft: 14, marginLeft: 4,
                }}
              >
                <span className="tnum muted" style={{ fontSize: 12, minWidth: 46 }}>
                  {new Date(h.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ fontSize: 13.5 }}><b>{h.user}</b> {h.message}</span>
              </div>
            ))}
          </div>
        ))
      ) : (
        <Empty icon={Ico.hist} title="Aucune action" sub="L'historique se remplira au fil de l'activité." />
      )}
    </div>
  );
}
