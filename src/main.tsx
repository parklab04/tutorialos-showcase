import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './app/styles.css';

if (['#coach', '#overlay'].includes(window.location.hash)) {
  document.documentElement.classList.add('floating-document');
  document.body.classList.add(window.location.hash === '#overlay' ? 'overlay-body' : 'coach-body');
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
