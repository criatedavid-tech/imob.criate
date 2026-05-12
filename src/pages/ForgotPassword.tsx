import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Home, Mail, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setSent(true);
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
        <h2 className="text-center text-2xl font-extrabold text-[#1A1A1A] tracking-tight">Recuperar senha</h2>
        <p className="mt-2 text-center text-sm text-[#6B7280]">
          Lembrou a senha?{' '}
          <Link to="/login" className="font-semibold text-black hover:underline underline-offset-4">Entrar</Link>
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-10 px-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:rounded-3xl border border-[#E5E7EB]">
          {sent ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-[#1A1A1A] mb-2">Verifique seu e-mail</h3>
              <p className="text-sm text-[#6B7280] mb-6 leading-relaxed">
                Se <strong>{email}</strong> estiver cadastrado, você receberá um link para redefinir sua senha em instantes.
              </p>
              <p className="text-xs text-[#9CA3AF] mb-6">Não recebeu? Verifique a caixa de spam ou tente novamente.</p>
              <Link to="/login" className="flex items-center justify-center gap-2 text-sm font-semibold text-black hover:underline">
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <p className="text-sm text-[#6B7280]">
                Informe o e-mail cadastrado e enviaremos um link para você criar uma nova senha.
              </p>

              {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-2xl text-sm border border-red-100">{error}</div>
              )}

              <div>
                <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
                  <input
                    autoFocus type="email" required
                    value={email} onChange={e => setEmail(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                    placeholder="seu@email.com"
                  />
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full h-14 flex items-center justify-center gap-2 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#222] transition-all disabled:opacity-50 shadow-lg shadow-black/10">
                {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Enviar link de recuperação'}
              </button>

              <Link to="/login" className="flex items-center justify-center gap-1.5 text-sm text-[#6B7280] hover:text-black transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar para o login
              </Link>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
