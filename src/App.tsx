import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'motion/react';
import { authService } from './services/auth';
import TermsGate from './components/TermsGate';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const PropertyLanding = lazy(() => import('./pages/PropertyLanding'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const JoinTeam = lazy(() => import('./pages/JoinTeam'));
const PaymentPending = lazy(() => import('./pages/PaymentPending'));
const PaymentSuccess = lazy(() => import('./pages/PaymentSuccess'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Termos = lazy(() => import('./pages/Termos'));
const Privacidade = lazy(() => import('./pages/Privacidade'));
const Admin = lazy(() => import('./pages/Admin'));
const Experiencia = lazy(() => import('./pages/Experiencia'));
const Vitrine = lazy(() => import('./pages/Vitrine'));
const VitrineLancamentos = lazy(() => import('./pages/VitrineLancamentos'));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status !== 'ativo') return <Navigate to="/payment" replace />;

  return <><TermsGate />{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <AnimatePresence mode="wait">
          <Routes>
          {/* Rotas Públicas */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/experimentacao/:voucherCode" element={<Signup />} />
          <Route path="/equipe/entrar/:code" element={<JoinTeam />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/termos" element={<Termos />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/p/:slug" element={<PropertyLanding />} />
          <Route path="/vitrine/:brokerId" element={<Vitrine />} />
          <Route path="/lancamentos-vitrine/:brokerId" element={<VitrineLancamentos />} />

          {/* Experiência nova (interface generativa) — destino padrão pós-login.
              Mesma trava do dashboard: login + assinatura ativa + aceite de termos. */}
          <Route path="/app" element={
            <PrivateRoute>
              <Experiencia />
            </PrivateRoute>
          } />

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

          {/* Admin — apenas para is_admin=true */}
          <Route path="/admin" element={
            authService.isLoggedIn() ? <Admin /> : <Navigate to="/login" />
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
      </Suspense>
    </BrowserRouter>
  );
}
