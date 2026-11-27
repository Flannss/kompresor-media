import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/plus-jakarta-sans';
import './index.css';
import { initTheme } from './shared/hooks/useTheme';
import { isStaleChunkError, recoverFromStaleChunkError } from './shared/utils/chunkRecovery';
import { App } from './app/App';

initTheme();

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    const preloadPayload = (event as Event & { payload?: unknown }).payload ?? event;
    recoverFromStaleChunkError(preloadPayload, { force: true });
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (isStaleChunkError(event.reason)) {
      event.preventDefault();
      recoverFromStaleChunkError(event.reason);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
