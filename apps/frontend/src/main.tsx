import React from 'react';
import ReactDOM from 'react-dom/client';
import Pages from './Pages';
import { AuthProvider } from './auth/AuthProvider';
import { OfficeProvider } from './offices/OfficeProvider';
import ServerEvents from './api/ServerEvents';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <OfficeProvider>
        <ServerEvents />
        <Pages />
      </OfficeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
