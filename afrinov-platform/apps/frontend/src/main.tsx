import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { installGlobalErrorHandlers } from './lib/diagnostics';
import './index.css';

// Catch failures React Error Boundaries cannot: unhandled promise rejections
// and errors thrown outside rendering. They are recorded by the diagnostics
// sink rather than becoming silent console noise.
installGlobalErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);