import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, Mail, Lock, User, Phone, Loader2, ArrowRight, CheckCircle2 } from 'lucide-react';
import { authService } from '../services/auth';
import { motion } from 'motion/react';

export default function Signup() {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    name: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    if (formData.password !== formData.confirmPassword) {
      setError('As senhas não coincidem');
      setLoading(false);
      return;
    }
    
    try {
      await authService.signup(formData.email, formData.password, formData.name, formData.phone);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8F9FA] flex items-center justify-center p-6 text-center font-sans">
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white p-12 rounded-[40px] shadow-2xl border border-[#E5E7EB] max-w-lg w-full"
        >
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="text-green-600 w-10 h-10" />
          </div>
          <h2 className="text-3xl font-bold text-[#1A1A1A] mb-4">Conta criada!</h2>
          <p className="text-[#6B7280] mb-8 leading-relaxed">
            Seu cadastro foi realizado com sucesso. Você será redirecionado para a tela de login em alguns segundos...
          </p>
          <Loader2 className="animate-spin h-6 w-6 mx-auto text-black" />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sm:mx-auto sm:w-full sm:max-w-md"
      >
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center shadow-lg">
            <Home className="text-white w-7 h-7" />
          </div>
        </div>
        <h2 className="text-center text-3xl font-extrabold text-[#1A1A1A] tracking-tight">
          Crie sua conta
        </h2>
        <p className="mt-2 text-center text-sm text-[#6B7280]">
          Já possui cadastro?{' '}
          <Link to="/login" className="font-semibold text-black hover:underline underline-offset-4">
            Entre agora
          </Link>
        </p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="mt-8 sm:mx-auto sm:w-full sm:max-w-md"
      >
        <div className="bg-white py-10 px-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:rounded-[32px] border border-[#E5E7EB] sm:px-12">
          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-2xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                Nome Completo
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User className="h-4 w-4 text-[#9CA3AF]" />
                </div>
                <input
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                  placeholder="Seu nome"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div>
                <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                  Telefone
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Phone className="h-4 w-4 text-[#9CA3AF]" />
                  </div>
                  <input
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                    className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                    placeholder="(00) 00000-0000"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                  E-mail
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-[#9CA3AF]" />
                  </div>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                    className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                    placeholder="email@dominio.com"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                  Senha
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-[#9CA3AF]" />
                  </div>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                    className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#9CA3AF] mb-1.5 uppercase tracking-widest pl-1">
                  Confirmar
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-[#9CA3AF]" />
                  </div>
                  <input
                    type="password"
                    required
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                    className="block w-full pl-11 pr-4 py-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl text-sm focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-medium"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 flex justify-center items-center py-3 px-4 bg-black text-white rounded-2xl text-base font-bold hover:bg-[#333] transition-all disabled:opacity-50 group shadow-lg shadow-black/10"
              >
                {loading ? (
                  <Loader2 className="animate-spin h-5 w-5" />
                ) : (
                  <>
                    Criar Conta
                    <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
