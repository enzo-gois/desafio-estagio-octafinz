// First import: must run before any module that builds a Zod schema (see zod-config.ts).
import './zod-config';
import './styles/global.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApiClient } from './api/client';
import { App } from './App';
import { API_BASE_URL } from './config';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

createRoot(root).render(
  <StrictMode>
    <App api={createApiClient({ baseUrl: API_BASE_URL })} />
  </StrictMode>,
);
