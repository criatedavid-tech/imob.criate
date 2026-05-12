import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import PropertyLanding from './pages/PropertyLanding';
import Login from './pages/Login';
import Signup from './pages/Signup';
import PaymentPending from './pages/PaymentPending';
import PaymentSuccess from './pages/PaymentSuccess';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import { motion, AnimatePresence } from 'motion/react';
import { authService } from './services/auth';

// Rota que verifica login E status da assinatura
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!authService.isLoggedIn()) {
      navigate('/login');
      return;
    }

    fetch('/api/subscription', { headers: authService.getAuthHeaders() })
      .then(r => r.json())
      .then(data => {
        setStatus(data?.broker?.status || 'pendente');
      })
      .catch(() => setStatus('pendente'))
      .finally(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'pendente') return <Navigate to="/payment" replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <AnimatePresence mode="wait">
        <Routes>
          {/* Rotas Públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/p/:slug" element={<PropertyLanding />} />

          {/* Pagamento */}
          <Route path="/payment" element={
            authService.isLoggedIn() ? <PaymentPending /> : <Navigate to="/login" />
          } />
          <Route path="/payment/success" element={
            authService.isLoggedIn() ? <PaymentSuccess /> : <Navigate to="/login" />
          } />
          <Route path="/payment/cancelled" element={
            authService.isLoggedIn() ? <PaymentPending /> : <Navigate to="/login" />
          } />

          {/* Dashboard Protegido (exige login + assinatura ativa) */}
          <Route path="/" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />

          {/* Rota curinga */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
    </BrowserRouter>
  );
}
