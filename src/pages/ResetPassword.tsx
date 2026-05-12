import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Lock, Loader2, CheckCircle2, Eye, EyeOff, XCircle } from 'lucide-react';
import { motion } from 'motion/react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [accessToken, setAccessToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Supabase envia o token no hash da URL: #access_token=XXX&type=recovery
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token = params.get('access_token');
    const type = params.get('type');

    if (!token || type !== 'recovery') {
      setError('Link inválido ou expirado. Solicite uma nova recuperação de senha.');
      return;
    }
    setAccessToken(token);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    if (password.length < 6) { setError('A senha deve ter pelo menos 6 caracteres.'); return; }

    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, newPassword: password })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-center py-12 px-4 font-sans">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center shadow-lg">
            <Home className="text-white w-6 h-6" />
          </div>
        </div>
        <h2 className="text-center text-2xl font-extrabold text-[#1A1A1A] tracking-tight">Nova senha</h2>
        <p className="mt-2 text-center text-sm text-[#6B7280]">Crie uma senha forte para sua conta</p>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-10 px-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:rounded-3xl border border-[#E5E7EB]">
          {done ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">Senha atualizada!</h3>
              <p className="text-sm text-[#6B7280]">Redirecionando para o login em instantes...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="flex items-center gap-2 bg-red-50 text-red-600 p-3 rounded-2xl text-sm border border-red-100">
                  <XCircle className="w-4 h-4 shrink-0" /> {error}
                </div>
              )}

              {!accessToken && !error ? (
                <p className="text-sm text-[#6B7280] text-center">Verificando link...</p>
              ) : accessToken ? (
                <>
                  <div>
                    <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Nova Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                      <input
                        autoFocus type={showPwd ? 'text' : 'password'} required minLength={6}
                        value={password} onChange={e => setPassword(e.target.value)}
                        className="block w-full pl-11 pr-11 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                        placeholder="Mínimo 6 caracteres"
                      />
                      <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute inset-y-0 right-0 pr-4 flex items-center text-[#9CA3AF] hover:text-[#374151]">
                        {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">Confirmar Senha</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                      <input
                        type={showPwd ? 'text' : 'password'} required
                        value={confirm} onChange={e => setConfirm(e.target.value)}
                        className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                        placeholder="Repita a senha"
                      />
                    </div>
                  </div>

                  <button type="submit" disabled={loading}
                    className="w-full h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all disabled:opacity-50 shadow-lg shadow-black/10">
                    {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Salvar nova senha'}
                  </button>
                </>
              ) : (
                <div className="text-center">
                  <Link to="/forgot-password" className="text-sm font-semibold text-black hover:underline">
                    Solicitar novo link de recuperação
                  </Link>
                </div>
              )}
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
