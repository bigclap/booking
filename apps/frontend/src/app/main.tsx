import React from 'react';
import ReactDOM from 'react-dom/client';
import Pages from './Router';
import { AuthProvider } from '../auth/hooks';
import { OfficeProvider } from '../office/hooks';
import ServerEvents from './hooks/ServerEvents';
import { GlobalStyles } from './GlobalStyles';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GlobalStyles />
    <AuthProvider>
      <OfficeProvider>
        <ServerEvents />
        <Pages />
      </OfficeProvider>
    </AuthProvider>
  </React.StrictMode>,
);
