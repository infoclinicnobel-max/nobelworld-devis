'use client';

import React from 'react';
import { Empty, Kpi, StatusBadge } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { initials, money, normalizeDate } from '@/lib/format';
import { can, estDeMoi } from '@/lib/perms';
import { patientName, totalOf } from '@/lib/calc';

/* =========================================================================
   TABLEAU DE BORD
   ------------------------------------------------------------------------- */
export function Dashboard() {
  const { data, user, go } = useApp();
  const cur = data.parametres.currency || '€';
  const myDevis =
    can(user, 'all') || can(user, 'devisViewAll')
      ? data.devis
      : data.devis.filter((d) => estDeMoi(user, d.createdBy));
  const totalDevis = myDevis.reduce((s, d) => s + totalOf(d), 0);
  const encaisse = data.paiements.reduce((s, p) => s + Number(p.montant || 0), 0);
  const factTotal = data.factures.reduce((s, f) => s + totalOf(f), 0);
  const restant = Math.max(0, factTotal - encaisse);
  const enAttente = data.devis.filter((d) => ['brouillon', 'envoye'].includes(d.statut || '')).length;
  const payees = data.factures.filter((f) => f.statut === 'payee').length;

  // graphique mensuel (montant devis sur 6 mois)
  const months = [...Array(6)].map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('fr-FR', { month: 'short' }) };
  });
  const series = months.map((m) => ({
    ...m,
    val: myDevis
      .filter((d) => (normalizeDate(d.date) || '').slice(0, 7) === m.key)
      .reduce((s, d) => s + totalOf(d), 0),
  }));
  const maxV = Math.max(1, ...series.map((s) => s.val));
  const recents = [...myDevis]
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 6);

  return (
    <>
      <div className="grid kpis" style={{ marginBottom: 18 }}>
        <Kpi label="Devis" value={myDevis.length} sub={money(totalDevis, cur) + ' au total'} icon={Ico.doc} />
        <Kpi label="Factures" value={data.factures.length} sub={payees + ' payée(s)'} icon={Ico.invoice} tone="gold" />
        <Kpi
          label="Encaissé"
          value={money(encaisse, cur)}
          sub={data.paiements.length + ' paiement(s)'}
          icon={Ico.wallet}
          tone="ok"
        />
        <Kpi label="Restant dû" value={money(restant, cur)} sub="sur factures émises" icon={Ico.euro} tone="warn" />
        <Kpi label="Patients" value={data.patients.length} icon={Ico.patient} />
        <Kpi label="Devis en attente" value={enAttente} sub="brouillon / envoyé" icon={Ico.bell} />
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', alignItems: 'start' }}>
        <div className="card card-pad">
          <div className="sec-head">
            <div>
              <h2>Volume des devis</h2>
              <div className="desc">6 derniers mois</div>
            </div>
          </div>
          <div className="bars">
            {series.map((s) => (
              <div key={s.key} className="bcol">
                <div
                  style={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
                >
                  <div
                    className="b"
                    style={{ height: Math.round((s.val / maxV) * 100) + '%' }}
                    title={money(s.val, cur)}
                  />
                </div>
                <div className="bl">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="card card-pad">
          <div className="sec-head">
            <div><h2>Derniers devis</h2></div>
            <button className="btn btn-sm" onClick={() => go('devis')}>Tout voir</button>
          </div>
          {recents.length ? (
            recents.map((d) => {
              const p = data.patients.find((x) => x.id === d.patientId);
              return (
                <div
                  key={d.id}
                  className="clickable"
                  onClick={() => go('devis')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px',
                    borderBottom: '1px solid var(--surface-2)', cursor: 'pointer',
                  }}
                >
                  <div
                    className="av"
                    style={{
                      width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)',
                      color: 'var(--blue)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
                    }}
                  >
                    {initials(patientName(p))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="t-strong" style={{ fontSize: 13 }}>{d.numero}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{patientName(p)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="t-strong tnum">{money(totalOf(d), cur)}</div>
                    <div style={{ fontSize: 11 }}><StatusBadge s={d.statut} doc="devis" /></div>
                  </div>
                </div>
              );
            })
          ) : (
            <Empty title="Aucun devis" sub="Créez votre premier devis." />
          )}
        </div>
      </div>
    </>
  );
}
