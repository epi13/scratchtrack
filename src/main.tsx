import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initMncsWasm } from './mncsWasm';
import './styles.css';
import './v02.css';
import './v03.css';
import './v04.css';
import './v05.css';

// Boot the compiled MNCS modules (meter, text, crc) concurrently with
// render. Never blocks or breaks boot: production call sites use WASM
// calls when ready and the conformance-pinned projections otherwise
// (all paths agree by corpus).
void initMncsWasm();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
