'use client';

import dynamic from 'next/dynamic';

const App = dynamic(() => import('@/components/App').then((m) => m.App), {
  ssr: false,
  loading: () => (
    <div className="center-load">
      <span className="spin" />
      <span className="muted">Chargement…</span>
    </div>
  ),
});

export function AppClient() {
  return <App />;
}
