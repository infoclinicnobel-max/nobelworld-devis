'use client';

import React, { useState } from 'react';
import { Field, Input } from './ui';
import { Ico } from './icons';
import { SIDEBAR_LOGO } from '@/lib/logos';

/* =========================================================================
   CONNEXION — Supabase Auth (email + mot de passe).
   L'ancien système maison de Code.gs (jeton signé, hachage local) a disparu.
   ------------------------------------------------------------------------- */
export function Login({
  onLogin, resterConnecteParDefaut = true,
}: {
  onLogin: (email: string, password: string, remember: boolean) => Promise<void>;
  /** Reprise du dernier choix de l'utilisateur ; coché par défaut. */
  resterConnecteParDefaut?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [remember, setRemember] = useState(resterConnecteParDefaut);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr('');
    setBusy(true);
    try {
      await onLogin(email, pwd, remember);
    } catch (e) {
      setErr((e as Error).message || 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <div className="left">
        <div className="lmark">
          <div className="mk">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SIDEBAR_LOGO} alt="Clinic Nobel" />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 600 }}>Clinic NobelWorld</div>
            <div style={{ fontSize: 12, color: '#9fb3cb', letterSpacing: '.05em' }}>DEVIS &amp; FACTURES</div>
          </div>
        </div>
        <div className="hero">
          <h2>Des devis dignes des plus grandes cliniques privées.</h2>
          <p>
            Créez, suivez et transformez vos devis en factures — en temps réel, avec toute votre équipe. Une
            expérience pensée pour le tourisme médical.
          </p>
        </div>
        <div className="feat">
          <span>Devis premium</span><span>·</span><span>PDF haut de gamme</span><span>·</span><span>Synchro équipe</span>
        </div>
      </div>
      <div className="right">
        <div className="form">
          <h3>Connexion</h3>
          <p className="lead">Accédez à votre espace de gestion.</p>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              autoFocus
              placeholder="vous@clinicnobel.com"
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>
          <Field label="Mot de passe">
            <Input
              type="password"
              value={pwd}
              placeholder="••••••••"
              onChange={(e) => setPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </Field>
          <label
            style={{
              display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '2px 0 14px',
              cursor: 'pointer', color: 'var(--muted)',
            }}
          >
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Rester
            connecté
          </label>
          <p style={{ fontSize: 11.5, color: 'var(--muted-2)', margin: '-8px 0 14px', lineHeight: 1.5 }}>
            {remember
              ? 'Vous resterez connecté sur cet appareil, même après fermeture du navigateur.'
              : 'Votre session sera fermée à la fermeture du navigateur — à réserver aux postes partagés.'}
          </p>
          {err && (
            <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 12, fontWeight: 500, lineHeight: 1.5 }}>
              {err}
            </div>
          )}
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
            disabled={busy}
            onClick={submit}
          >
            {busy ? <span className="spin" /> : <>Se connecter <Ico.arrow size={16} /></>}
          </button>
          <p style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 18, lineHeight: 1.6 }}>
            Comptes gérés par le CRM Clinic Nobel (Supabase Auth). Mot de passe oublié : contactez
            l&apos;administrateur.
          </p>
        </div>
      </div>
    </div>
  );
}
