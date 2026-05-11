/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import PropertyLanding from './pages/PropertyLanding';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from './services/auth';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  return authService.isLoggedIn() ? <>{children}</> : <Navigate to="/login" />;
};

// Estrutura principal da aplicação com roteamento e animações
export default function App() {
  return (
    <BrowserRouter>
      {/* Container para animações de saída suave entre rotas */}
      <AnimatePresence mode="wait">
        <Routes>
          {/* Rotas Públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          
          {/* Rota Protegida (Dashboard Principal) */}
          <Route path="/" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />
          
          {/* Rota de Landing Page do Imóvel (Acessível via slug) */}
          <Route path="/p/:slug" element={<PropertyLanding />} />
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  );
}

