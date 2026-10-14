import './styles/app.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
const root = document.getElementById('root');
if (!root) throw new Error('Application root missing');
createRoot(root).render(
  createElement(App, {
    loadRuntime: async () => {
      const runtime = await import('./modules/renderer/app');
      await runtime.ready;
      return runtime;
    },
  }),
);
