import React, { useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  Home,
  Users,
  Calendar,
  Plus,
  TrendingUp,
  Search,
  Settings,
  LogOut,
  ChevronRight,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Smartphone,
  CreditCard,
  Wifi,
  WifiOff,
  RefreshCw,
  Crown,
  Menu,
  X as XIcon,
  Shield,
  Building2,
  Bot,
  Activity
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import CorretoraSettings from '../components/CorretoraSettings';
import PropertyForm from '../components/PropertyForm';

import AISettings from '../components/AISettings';
import FollowUpSettings from '../components/FollowUpSettings';
import AgendaCalendar from '../components/AgendaCalendar';
import { authService } from '../services/auth';
import MagicWandTextarea from '../components/MagicWandTextarea';
import Copyright from '../components/Copyright';


/**
 * Componente Principal do Dashboard.
 * Gerencia a listagem de imóveis, métricas de desempenho e leads recentes.
 */
export default function Dashboard() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false); // drawer mobile
  const [properties, setProperties] = useState<any[]>([]); // Lista de imóveis do corretor
  const [loading, setLoading] = useState(false); // Estado de carregamento dos imóveis
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'error'>('offline'); // Status do servidor
  const [dbStatus, setDbStatus] = useState<string>(''); // Detalhe textual do status do banco
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null); // Sistema de notificações
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null); // ID do imóvel para exclusão
  const [deletingId, setDeletingId] = useState<string | null>(null); // Estado de progresso da exclusão

  // MÉTRICAS E LEADS (Implementado em 30/04/2026)
  const [dashboardMetrics, setDashboardMetrics] = useState({
    totalProperties: 0,
    activeLeads: 0,
    scheduledVisits: 0
  });
  const [recentLeads, setRecentLeads] = useState<any[]>([]);
  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [scheduledVisits, setScheduledVisits] = useState<any[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [loadingAllLeads, setLoadingAllLeads] = useState(false);
  const [loadingVisits, setLoadingVisits] = useState(false);
  const [chartData, setChartData] = useState<{name: string, value: number}[]>([]);

  // ATENDIMENTOS
  const [atendimentosRecentes, setAtendimentosRecentes] = useState<any[]>([]);
  const [atendimentosMes, setAtendimentosMes] = useState<number | null>(null);
  const [loadingAtendimentos, setLoadingAtendimentos] = useState(false);

  // PERFIL DO CORRETOR
  const [brokerProfile, setBrokerProfile] = useState<any>({
    name: '',
    title: 'Principal Broker',
    photoUrl: '',
    quote: '...',
    is_admin: false
  });
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  /**
   * Exibe uma notificação temporária na tela.
   */
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  /**
   * Verifica a saúde do backend e da conexão com o banco de dados.
   */
  const checkBackend = async () => {
    try {
      const res = await fetch('/api/properties/health');
      if (res.ok) {
        const health = await res.json();
        if (health.database === 'CONNECTED') {
          setBackendStatus('online');
          setDbStatus('Banco Conectado');
        } else {
          setBackendStatus('error');
          setDbStatus(`Erro Banco: ${health.db_error || 'Desconectado'}`);
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        setBackendStatus('offline');
        setDbStatus(errorData.message || `Backend Offline (${res.status})`);
      }
    } catch (err: any) {
      setBackendStatus('offline');
      setDbStatus(`Erro Sist.: ${err.message || 'Sem Resposta'}`);
      console.error("Health check falhou:", err);
    }
  };

  const fetchProperties = async () => {
    setLoading(true);
    await checkBackend();
    try {
      const response = await fetch('/api/properties', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setProperties(data);
    } catch (error: any) {
      console.error("Erro ao buscar imóveis:", error);
      setProperties([{ 
        id: "error", title: "Erro de Conexão", description: `Detalhe: ${error.message}` 
      }]);
    } finally {
      setLoading(false);
    }
  };

  // NOVO: implementado em 30/04/2026 - não altera legado
  const fetchDashboardMetrics = async () => {
    try {
      const response = await fetch('/api/dashboard/metrics', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha ao carregar métricas');
      const data = await response.json();
      setDashboardMetrics(data);
    } catch (error) {
      console.error("Erro ao carregar métricas:", error);
      // Fallback already handled by state initialization
    }
  };

  // NOVO: implementado em 30/04/2026 - não altera legado
  const fetchRecentLeads = async () => {
    setLoadingMetrics(true);
    try {
      const response = await fetch('/api/leads/recent', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha ao carregar leads recentes');
      const data = await response.json();
      setRecentLeads(data);
    } catch (error) {
      console.error("Erro ao carregar leads:", error);
    } finally {
      setLoadingMetrics(false);
    }
  };

  const fetchScheduledVisits = async () => {
    setLoadingVisits(true);
    try {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const end = new Date();
      end.setDate(end.getDate() + 30);
      const response = await fetch(`/api/agenda/visits?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha');
      setScheduledVisits(await response.json());
    } catch {
      setScheduledVisits([]);
    } finally {
      setLoadingVisits(false);
    }
  };

  const fetchAtendimentosRecentes = async () => {
    setLoadingAtendimentos(true);
    try {
      const [recentRes, usageRes] = await Promise.all([
        fetch('/api/tickets/recent', { headers: authService.getAuthHeaders() }),
        fetch('/api/billing/usage', { headers: authService.getAuthHeaders() })
      ]);
      if (recentRes.ok) setAtendimentosRecentes(await recentRes.json());
      if (usageRes.ok) {
        const usage = await usageRes.json();
        setAtendimentosMes(usage?.current_period?.tickets_used ?? 0);
      }
    } catch {
      setAtendimentosRecentes([]);
    } finally {
      setLoadingAtendimentos(false);
    }
  };

  const fetchAllLeads = async () => {
    setLoadingAllLeads(true);
    try {
      const response = await fetch('/api/leads', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha ao carregar leads');
      setAllLeads(await response.json());
    } catch (error) {
      console.error("Erro ao carregar todos os leads:", error);
    } finally {
      setLoadingAllLeads(false);
    }
  };

  const updateLeadStatus = async (leadId: string, status: string): Promise<void> => {
    try {
      await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status })
      });
      setAllLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
    }
  };

  const fetchBrokerProfile = async () => {
    try {
      const response = await fetch('/api/brokers/me', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha ao carregar perfil do corretor');
      const data = await response.json();
      
      let parsedData = {};
      try {
        if (data.broker_address) {
          parsedData = JSON.parse(data.broker_address);
        }
      } catch (e) {}
      
      setBrokerProfile(prev => ({
        ...prev,
        name: data.name,
        phone: data.phone || '',
        is_admin: data.is_admin || false,
        ...parsedData
      }));
    } catch (error) {
      console.error("Erro ao carregar perfil:", error);
    }
  };

  const saveBrokerProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      const { name, phone, ...extraData } = brokerProfile;
      const settingsToSave = {
        name,
        phone: phone || '',
        broker_address: JSON.stringify(extraData)
      };

      const response = await fetch('/api/brokers/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify(settingsToSave)
      });
      
      if (!response.ok) throw new Error('Falha ao salvar perfil');
      showToast('Perfil atualizado com sucesso!');
    } catch (error: any) {
      console.error("Erro ao salvar perfil:", error);
      showToast('Erro ao salvar as informações.', 'error');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // NOVO: implementado em 30/04/2026 - não altera legado
  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const past = new Date(dateString);
    const diffInMs = now.getTime() - past.getTime();
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Agora mesmo';
    if (diffInHours < 24) return `${diffInHours}h atrás`;
    const diffInDays = Math.floor(diffInHours / 24);
    return `${diffInDays}d atrás`;
  };

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        const SIZE = 600;
        const ratio = Math.min(SIZE / img.width, SIZE / img.height);
        canvas.width = img.width * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL('image/jpeg', 0.82);

        // Tenta enviar ao servidor para armazenar no Supabase Storage
        setUploadingPhoto(true);
        try {
          const res = await fetch('/api/brokers/upload-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
            body: JSON.stringify({ imageData: base64 })
          });
          if (res.ok) {
            const { url } = await res.json();
            setBrokerProfile((prev: any) => ({ ...prev, photoUrl: url }));
          } else {
            // Fallback: usa base64 localmente se o storage falhar
            setBrokerProfile((prev: any) => ({ ...prev, photoUrl: base64 }));
          }
        } catch {
          setBrokerProfile((prev: any) => ({ ...prev, photoUrl: base64 }));
        } finally {
          setUploadingPhoto(false);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSafeReload = async () => {
    // FIX AUTH STATE 30/04/2026
    if (loading || loadingMetrics) return; // Evita recarregar com fetch pendente
    window.location.replace('/'); // FIX AUTH STATE 30/04/2026
  };

  const fetchChartData = async () => {
    try {
      const response = await fetch('/api/dashboard/charts', {
        headers: authService.getAuthHeaders()
      });
      if (!response.ok) throw new Error('Falha');
      const data = await response.json();
      setChartData(data);
    } catch {
      // fallback: últimos 5 meses com dados de métricas
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai'];
      const now = new Date();
      setChartData(months.map((_, i) => ({
        name: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(
          new Date(now.getFullYear(), now.getMonth() - (4 - i), 1)
        ),
        value: 0
      })));
    }
  };

  useEffect(() => {
    fetchProperties();
    fetchDashboardMetrics();
    fetchScheduledVisits();
    fetchAtendimentosRecentes();
    fetchBrokerProfile();
    const intervalId = setInterval(checkBackend, 5000);
    return () => clearInterval(intervalId);
  }, []);

  const updatePropertyStatus = async (propertyId: string, status: string) => {
    try {
      await fetch(`/api/properties/${propertyId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authService.getAuthHeaders() },
        body: JSON.stringify({ status })
      });
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, status } : p));
    } catch (error) {
      showToast('Erro ao atualizar status.', 'error');
    }
  };

  const copyLink = (slug: string) => {
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard.writeText(url).then(() => showToast('Link copiado!'));
  };

  const handleOpenEdit = (property: any) => {
    setEditingProperty(property);
    setIsFormOpen(true);
  };

  const handleFormSuccess = () => {
    fetchProperties();
    setActiveTab('properties');
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingProperty(null);
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    
    const id = deleteConfirmId;
    setDeleteConfirmId(null);
    setDeletingId(id);
    
    try {
      const response = await fetch(`/api/properties/${id}`, {
        method: 'DELETE',
        headers: authService.getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error('Não foi possível excluir o imóvel.');
      }
      
      showToast('Imóvel excluído com sucesso!');
      fetchProperties();
    } catch (error: any) {
      console.error("Erro ao excluir:", error);
      showToast(error.message || 'Erro ao excluir imóvel', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Fecha sidebar ao trocar de aba no mobile
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen font-sans relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      {/* ── SIDEBAR DESKTOP (md+) ── */}
      <aside className="hidden md:flex relative z-10 w-64 flex-col p-6
        backdrop-blur-2xl bg-white/8 border-r border-white/12
        shadow-[inset_1px_0_0_rgba(255,255,255,0.08),4px_0_24px_rgba(0,0,0,0.3)]"
      >
        <div className="flex items-center gap-2 mb-10">
          <div onClick={handleSafeReload}
            className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity
              backdrop-blur-md bg-white/15 border border-white/25
              shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_2px_8px_rgba(0,0,0,0.25)]">
            <Home className="text-white w-5 h-5" />
          </div>
          <span onClick={handleSafeReload} className="font-bold text-xl tracking-tight text-white cursor-pointer hover:opacity-80 transition-opacity">
            Criate
          </span>
        </div>

        <nav className="flex-1 space-y-1">
          <NavItem icon={<BarChart3 size={20} />}  label="Dashboard" active={activeTab === 'overview'}      onClick={() => handleTabChange('overview')} />
          <NavItem icon={<Home size={20} />}        label="Imóveis"   active={activeTab === 'properties'}    onClick={() => handleTabChange('properties')} />
          <NavItem icon={<Calendar size={20} />}    label="Agenda"    active={activeTab === 'calendar'}      onClick={() => handleTabChange('calendar')} />
          <NavItem icon={<Building2 size={20} />}   label="Corretora" active={activeTab === 'corretora'}     onClick={() => handleTabChange('corretora')} />
          <NavItem icon={<Bot size={20} />}         label="Assistente IA" active={activeTab === 'settings'}   onClick={() => handleTabChange('settings')} />
          <NavItem icon={<Smartphone size={20} />}  label="WhatsApp"  active={activeTab === 'whatsapp'}       onClick={() => handleTabChange('whatsapp')} />
          <NavItem icon={<Activity size={20} />}    label="Status"    active={false} onClick={() => handleTabChange('subscription')} />
        </nav>

        <div className="mt-auto pt-6 border-t border-white/10 space-y-1">
          <NavItem icon={<Crown size={20} />}    label="Assinatura" active={activeTab === 'subscription'} onClick={() => handleTabChange('subscription')} />
          <NavItem icon={<Settings size={20} />} label="Meu Perfil" active={activeTab === 'profile'}     onClick={() => handleTabChange('profile')} />
          {brokerProfile.is_admin && (
            <NavItem icon={<Shield size={20} />} label="Admin" className="text-amber-300 hover:bg-amber-500/15" onClick={() => window.location.href = '/admin'} />
          )}
          <NavItem icon={<LogOut size={20} />}   label="Sair"       className="text-red-300 hover:bg-red-500/15" onClick={() => authService.logout()} />
        </div>
        <Copyright short className="mt-4" />
      </aside>

      {/* ── SIDEBAR MOBILE — drawer overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          {/* Drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="absolute left-0 top-0 h-full w-72 flex flex-col p-6
              backdrop-blur-2xl bg-slate-900/95 border-r border-white/12
              shadow-[4px_0_32px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-center justify-between mb-10">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center backdrop-blur-md bg-white/15 border border-white/25">
                  <Home className="text-white w-5 h-5" />
                </div>
                <span className="font-bold text-xl tracking-tight text-white">Criate</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-all">
                <XIcon size={20} />
              </button>
            </div>

            <nav className="flex-1 space-y-1">
              <NavItem icon={<BarChart3 size={20} />}  label="Dashboard" active={activeTab === 'overview'}      onClick={() => handleTabChange('overview')} />
              <NavItem icon={<Home size={20} />}        label="Imóveis"   active={activeTab === 'properties'}    onClick={() => handleTabChange('properties')} />
              <NavItem icon={<Calendar size={20} />}    label="Agenda"    active={activeTab === 'calendar'}      onClick={() => handleTabChange('calendar')} />
              <NavItem icon={<Building2 size={20} />}   label="Corretora" active={activeTab === 'corretora'}     onClick={() => handleTabChange('corretora')} />
              <NavItem icon={<Bot size={20} />}         label="Assistente IA" active={activeTab === 'settings'}   onClick={() => handleTabChange('settings')} />
              <NavItem icon={<Smartphone size={20} />}  label="WhatsApp"  active={activeTab === 'whatsapp'}       onClick={() => { handleTabChange('whatsapp'); setSidebarOpen(false); }} />
              <NavItem icon={<Activity size={20} />}    label="Status"    active={false} onClick={() => { handleTabChange('subscription'); setSidebarOpen(false); }} />
            </nav>

            <div className="mt-auto pt-6 border-t border-white/10 space-y-1">
              <NavItem icon={<Crown size={20} />}    label="Assinatura" active={activeTab === 'subscription'} onClick={() => handleTabChange('subscription')} />
              <NavItem icon={<Settings size={20} />} label="Meu Perfil" active={activeTab === 'profile'}     onClick={() => handleTabChange('profile')} />
              {brokerProfile.is_admin && (
                <NavItem icon={<Shield size={20} />} label="Admin" className="text-amber-300 hover:bg-amber-500/15" onClick={() => window.location.href = '/admin'} />
              )}
              <NavItem icon={<LogOut size={20} />}   label="Sair"       className="text-red-300 hover:bg-red-500/15" onClick={() => authService.logout()} />
            </div>
            <Copyright short className="mt-4" />
          </motion.aside>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="relative z-10 flex-1 overflow-y-auto min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-20 flex items-center justify-between px-4 md:px-10 h-16 md:h-20
          backdrop-blur-2xl bg-white/8 border-b border-white/10
          shadow-[0_1px_0_rgba(255,255,255,0.1),0_4px_24px_rgba(0,0,0,0.2)]"
        >
          <div className="flex items-center gap-3">
            {/* Hamburger — só mobile */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden w-9 h-9 rounded-xl flex items-center justify-center text-white/60 hover:bg-white/10 hover:text-white transition-all"
            >
              <Menu size={22} />
            </button>
          </div>

          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 font-semibold text-white text-sm transition-all
              px-4 py-2 md:px-6 md:py-2.5 rounded-full
              backdrop-blur-md bg-white/15 border border-white/25
              shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.2)]
              hover:bg-white/25 active:scale-95"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">Cadastrar Imóvel</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </header>

        <div className="p-4 md:p-8 lg:p-10 max-w-7xl mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6 md:space-y-8">
              <h1 className="text-xl md:text-2xl font-bold text-white">Visão Geral</h1>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
                <StatCard
                  label="Total de Imóveis"
                  value={dashboardMetrics.totalProperties.toString()}
                  icon={<Home className="text-blue-500" />}
                  onClick={() => setActiveTab('properties')}
                />
                <StatCard
                  label="Atendimentos este mês"
                  value={atendimentosMes !== null ? atendimentosMes.toString() : '—'}
                  icon={<Bot className="text-indigo-400" />}
                  onClick={() => setActiveTab('subscription')}
                />
              </div>

              {/* Últimos Atendimentos via IA */}
              <div className="p-5 md:p-8 rounded-3xl flex flex-col
                backdrop-blur-xl bg-white/10 border border-white/15
                shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold text-white">Últimos Atendimentos</h2>
                  <button
                    onClick={() => setActiveTab('subscription')}
                    className="text-sm font-semibold flex items-center gap-1 text-white/60 hover:text-white transition-colors"
                  >
                    Ver consumo <ChevronRight size={16} />
                  </button>
                </div>
                {loadingAtendimentos ? (
                  <div className="flex flex-col items-center justify-center py-16 text-white/40">
                    <Loader2 className="animate-spin mb-2" size={24} />
                    <span className="text-sm">Carregando atendimentos...</span>
                  </div>
                ) : atendimentosRecentes.length > 0 ? (
                  <div className="space-y-3">
                    {atendimentosRecentes.map((item) => (
                      <div key={item.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 backdrop-blur-sm bg-indigo-500/20 border border-indigo-400/30">
                            <Bot size={16} className="text-indigo-300" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm text-white truncate">Atendimento via IA</p>
                            <p className="text-xs text-white/40 truncate">Ticket #{item.zpro_ticket_id}</p>
                          </div>
                        </div>
                        <span className="text-xs text-white/40 whitespace-nowrap ml-3">{formatTimeAgo(item.created_at)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-white/40">
                    <Bot size={32} className="mb-2 text-white/20" />
                    <span className="text-sm">Nenhum atendimento ainda</span>
                    <span className="text-xs text-white/30 mt-1 max-w-xs">Os atendimentos aparecem aqui conforme a IA conversa com seus clientes pelo WhatsApp.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'properties' && (
            <div>
              <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6 text-white">Seus Imóveis</h2>
              {loading && <p className="text-white/50">Carregando imóveis...</p>}
              {!loading && properties.length === 0 && <p className="text-white/50">Nenhum imóvel cadastrado ainda.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {properties.map((prop) => (
                  <PropertyCard
                    key={prop.id}
                    title={prop.title}
                    location={prop.location}
                    price={prop.price}
                    image={prop.imageUrl || "https://picsum.photos/seed/placeholder/800/600"}
                    slug={prop.slug}
                    status={prop.status || 'disponivel'}
                    onEdit={() => handleOpenEdit(prop)}
                    onDelete={() => setDeleteConfirmId(prop.id)}
                    onCopyLink={() => copyLink(prop.slug)}
                    onStatusChange={(s: string) => updatePropertyStatus(prop.id, s)}
                    isDeleting={deletingId === prop.id}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="max-w-3xl mx-auto space-y-6 md:space-y-8">
              <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6 text-white">Meu Perfil Profissional</h2>
              <div className="p-5 md:p-8 rounded-3xl backdrop-blur-xl bg-white/10 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">
                <form onSubmit={saveBrokerProfile} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-white/70">Nome Completo</label>
                      <input
                        type="text"
                        value={brokerProfile.name || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, name: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-white/70">Telefone / WhatsApp</label>
                      <input
                        type="tel"
                        value={brokerProfile.phone || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, phone: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-semibold text-white/70">Título Profissional</label>
                      <input
                        type="text"
                        value={brokerProfile.title || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, title: e.target.value})}
                        className="w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25"
                        placeholder="Ex: Principal Broker"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-white/70">Foto de Perfil</label>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                    <div className="flex items-center gap-5">
                      <div className="relative shrink-0">
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-white/10 border-2 border-white/20 flex items-center justify-center">
                          {brokerProfile.photoUrl ? (
                            <img src={brokerProfile.photoUrl} alt="Foto de perfil" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => photoInputRef.current?.click()}
                          disabled={uploadingPhoto}
                          className="px-5 py-2.5 text-sm font-semibold rounded-xl transition-all disabled:opacity-60 flex items-center gap-2 backdrop-blur-md bg-white/15 border border-white/25 text-white hover:bg-white/25"
                        >
                          {uploadingPhoto && <Loader2 size={14} className="animate-spin" />}
                          {uploadingPhoto ? 'Enviando...' : brokerProfile.photoUrl ? 'Trocar Foto' : 'Carregar Foto'}
                        </button>
                        {brokerProfile.photoUrl && (
                          <button
                            type="button"
                            onClick={() => setBrokerProfile((prev: any) => ({ ...prev, photoUrl: '' }))}
                            className="px-5 py-2 text-sm font-medium text-red-500 hover:text-red-600 transition-colors text-left"
                          >
                            Remover
                          </button>
                        )}
                        <p className="text-xs text-white/40">JPG, PNG ou WEBP · Máx. 5MB</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-white/70">Trajetória</label>
                    <MagicWandTextarea
                      value={brokerProfile.quote}
                      onChange={e => setBrokerProfile({...brokerProfile, quote: e.target.value})}
                      onApply={(text) => setBrokerProfile({...brokerProfile, quote: text})}
                      rows={2}
                      className="w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:ring-2 focus:ring-white/25 resize-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="w-full py-4 rounded-xl font-bold flex justify-center items-center gap-2 transition-all mt-4
                      backdrop-blur-md bg-white/15 border border-white/25 text-white
                      shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.2)]
                      hover:bg-white/25 active:scale-[0.99] disabled:opacity-50"
                  >
                    {isSavingProfile ? <Loader2 className="animate-spin" size={20} /> : 'Salvar Alterações'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'calendar' && (
            <AgendaCalendar />
          )}

          {activeTab === 'settings' && (
            <>
              <AISettings />
              <FollowUpSettings />
            </>
          )}

          {/* ─── ABA WHATSAPP ─── */}
          {activeTab === 'whatsapp' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl md:text-2xl font-bold mb-2 text-white">WhatsApp</h2>
              <p className="text-white/55 mb-8">Conecte o número que vai atender seus clientes pelo WhatsApp.</p>
              <WhatsAppConnectCard />
            </div>
          )}

          {/* ─── ABA CORRETORA ─── */}
          {activeTab === 'corretora' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-xl md:text-2xl font-bold mb-2 text-white">Corretora</h2>
              <p className="text-white/55 mb-8">Cadastre a imobiliária que você representa e gerencie os corretores vinculados.</p>
              <CorretoraSettings />
            </div>
          )}

          {/* ─── ABA ASSINATURA ─── */}
          {activeTab === 'subscription' && (
            <SubscriptionTab />
          )}
        </div>
      </main>

      {/* Property Form Modal */}
      {isFormOpen && (
        <PropertyForm 
          onClose={handleCloseForm} 
          onSuccess={handleFormSuccess}
          initialData={editingProperty} 
        />
      )}

      {/* Delete Confirmation Modal — Liquid Glass ultra */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative z-10 w-full max-w-sm rounded-3xl overflow-hidden
              backdrop-blur-2xl bg-white/15 border border-white/30
              shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_24px_64px_rgba(0,0,0,0.45)]"
          >
            <div className="p-8 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6
                backdrop-blur-md bg-red-500/20 border border-red-400/30 text-red-300">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2 text-white">Excluir item?</h3>
              <p className="text-white/60">Tem certeza que deseja excluir? Essa ação não pode ser desfeita.</p>
            </div>
            <div className="flex border-t border-white/15">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-6 py-4 font-bold text-white/60 hover:bg-white/10 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-6 py-4 font-bold text-red-300 hover:bg-red-500/15 transition-colors border-l border-white/15"
              >
                Excluir
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Toast Notification — glass pill */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] pointer-events-none">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              "px-6 py-3 rounded-2xl flex items-center gap-3 font-medium text-white backdrop-blur-xl border",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_32px_rgba(0,0,0,0.3)]",
              toast.type === 'success'
                ? "bg-emerald-500/30 border-emerald-400/30"
                : "bg-red-500/30 border-red-400/30"
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            {toast.message}
          </motion.div>
        </div>
      )}
    </div>
  );
}

function SubscriptionTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<any>(null);

  useEffect(() => {
    fetch('/api/subscription', { headers: (authService as any).getAuthHeaders() })
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/billing/usage', { headers: (authService as any).getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(setUsage)
      .catch(() => {});
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="animate-spin w-6 h-6 text-white/40" /></div>;

  const broker = data?.broker;
  const sub = data?.lastSubscription;
  const isActive = broker?.status === 'ativo';
  const validUntil = broker?.valid_until ? new Date(broker.valid_until).toLocaleDateString('pt-BR') : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-white">Assinatura</h2>

      {/* Status card */}
      <div className={`rounded-3xl p-8 backdrop-blur-xl border
        ${isActive
          ? 'bg-violet-500/20 border-violet-400/30 shadow-[inset_0_1px_0_rgba(167,139,250,0.3),0_8px_32px_rgba(109,40,217,0.25)]'
          : 'bg-amber-500/15 border-amber-400/25 shadow-[inset_0_1px_0_rgba(251,191,36,0.2),0_8px_32px_rgba(0,0,0,0.2)]'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Crown className={`w-6 h-6 ${isActive ? 'text-violet-300' : 'text-amber-300'}`} />
            <span className="text-lg font-bold text-white">{isActive ? 'Plano Ativo' : 'Aguardando Pagamento'}</span>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-white/15 text-white border border-white/20">
            {broker?.plan || 'mensal'}
          </span>
        </div>
        {isActive && validUntil && <p className="text-sm text-white/60">Válido até {validUntil}</p>}
        {!isActive && (
          <a href="/payment" className="mt-4 inline-flex items-center gap-2 backdrop-blur-md bg-white/15 border border-white/25 text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-white/25 transition-all">
            <CreditCard className="w-4 h-4" /> Ativar assinatura
          </a>
        )}
      </div>

      {/* Status — consumo de atendimentos IA do ciclo atual */}
      {usage && (() => {
        const { tickets_used, tickets_included, tickets_remaining, overage_tickets, overage_amount, overage_price_per_ticket } = usage.current_period;
        const pct = Math.min(100, Math.round((tickets_used / tickets_included) * 100));
        const isOver = tickets_used > tickets_included;
        const isWarning = !isOver && pct >= 80;
        const barColor = isOver ? 'bg-red-400' : isWarning ? 'bg-amber-400' : 'bg-violet-400';
        return (
          <div className="rounded-3xl p-6 backdrop-blur-xl bg-white/10 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.2)]">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Activity className="w-4 h-4" /> Status</h3>

            <div className="flex items-end justify-between mb-3">
              <span className={`text-3xl font-extrabold ${isOver ? 'text-red-300' : isWarning ? 'text-amber-300' : 'text-white'}`}>
                {tickets_used}
              </span>
              <span className="text-sm text-white/50">/ {tickets_included} atendimentos inclusos</span>
            </div>

            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
            </div>

            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{isOver ? `${overage_tickets} excedente${overage_tickets > 1 ? 's' : ''}` : `${tickets_remaining} restante${tickets_remaining !== 1 ? 's' : ''}`}</span>
              <span>{pct}% usado</span>
            </div>

            {isOver && (
              <div className="mt-3 p-3 rounded-2xl bg-red-500/15 border border-red-400/20 text-xs text-red-300">
                Excedente projetado: {overage_tickets} × R$ {overage_price_per_ticket.toFixed(2)} = <strong>R$ {overage_amount.toFixed(2)}</strong> — será cobrado junto com a próxima mensalidade.
              </div>
            )}
          </div>
        );
      })()}

      {/* Último pagamento */}
      {sub && (
        <div className="rounded-3xl p-6 backdrop-blur-xl bg-white/10 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.2)]">
          <h3 className="font-bold text-white mb-4">Último pagamento</h3>
          <div className="space-y-1 text-sm">
            {[
              ['Status', <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 rounded-full text-xs font-bold">{sub.status}</span>],
              ['Plano', sub.plan],
              ['Valor', sub.amount ? `R$ ${(sub.amount / 100).toFixed(2).replace('.', ',')}` : '—'],
              ['Pago em', sub.paid_at ? new Date(sub.paid_at).toLocaleDateString('pt-BR') : '—'],
              ['Válido até', sub.valid_until ? new Date(sub.valid_until).toLocaleDateString('pt-BR') : '—'],
            ].map(([label, value]: any) => (
              <div key={label} className="flex justify-between items-center py-2.5 border-b border-white/8 last:border-0">
                <span className="text-white/50">{label}</span>
                <span className="font-medium text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

function WhatsAppConnectCard() {
  const [status, setStatus] = useState<{ provisioned: boolean; connected: boolean; loggedIn: boolean; profileName?: string | null; owner?: string | null; provisioningStatus?: string | null; provisioningError?: string | null } | null>(null);
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const provisioningPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (qrRefreshRef.current) { clearInterval(qrRefreshRef.current); qrRefreshRef.current = null; }
    if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
  };

  const loadStatus = async () => {
    try {
      const r = await fetch('/api/brokers/whatsapp/status', { headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao checar status');
      setStatus(data);
      if (data.connected) {
        setQrcode(null);
        setConnecting(false);
        stopPolling();
      }
      if (!data.provisioned && data.provisioningStatus === 'processing' && !provisioningPollRef.current) {
        provisioningPollRef.current = setInterval(async () => {
          const fresh = await loadStatus();
          if (fresh?.provisioned || fresh?.provisioningStatus === 'failed') {
            if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
          }
        }, 3000);
      }
      if (data.provisioned || data.provisioningStatus === 'failed') {
        if (provisioningPollRef.current) { clearInterval(provisioningPollRef.current); provisioningPollRef.current = null; }
      }
      return data;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  };

  const disconnectInstance = async () => {
    setError(null);
    setDisconnecting(true);
    try {
      const r = await fetch('/api/brokers/whatsapp/disconnect', { method: 'POST', headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao desconectar');
      await loadStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const requestQrcode = async () => {
    try {
      const r = await fetch('/api/brokers/whatsapp/connect', { method: 'POST', headers: authService.getAuthHeaders() });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Falha ao gerar QR code');
      if (data.qrcode) setQrcode(data.qrcode);
      if (data.connected) { setConnecting(false); stopPolling(); loadStatus(); }
    } catch (e: any) {
      setError(e.message);
      setConnecting(false);
      stopPolling();
    }
  };

  const startConnecting = async () => {
    setError(null);
    setConnecting(true);
    await requestQrcode();
    stopPolling();
    pollRef.current = setInterval(loadStatus, 3000);
    qrRefreshRef.current = setInterval(requestQrcode, 20000);
  };

  useEffect(() => {
    loadStatus();
    return stopPolling;
  }, []);

  return (
    <div className="rounded-3xl p-6 backdrop-blur-xl bg-white/10 border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.2)]">
      <h3 className="font-bold text-white mb-4 flex items-center gap-2"><Smartphone className="w-4 h-4" /> WhatsApp</h3>

      {!status && <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-white/40" /></div>}

      {status && !status.provisioned && status.provisioningStatus === 'failed' && (
        <div className="space-y-3">
          <p className="text-sm text-red-300">
            Não foi possível preparar sua instância de WhatsApp{status.provisioningError ? `: ${status.provisioningError}` : '.'}
          </p>
          <button
            onClick={() => { setError(null); loadStatus(); }}
            className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
        </div>
      )}

      {status && !status.provisioned && status.provisioningStatus !== 'failed' && (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="animate-spin w-4 h-4" /> Preparando sua instância de WhatsApp...
        </div>
      )}

      {status?.provisioned && status.connected && !connecting && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 text-sm font-medium">
            <Wifi className="w-4 h-4" /> Conectado
          </div>
          <div className="text-xs text-white/50 space-y-1">
            {status.profileName && <div>Perfil: <span className="text-white/80">{status.profileName}</span></div>}
            {status.owner && <div>Número: <span className="text-white/80 font-mono">{status.owner}</span></div>}
          </div>
          <button
            onClick={disconnectInstance}
            disabled={disconnecting}
            className="inline-flex items-center gap-2 text-xs text-white/60 hover:text-red-300 transition-colors disabled:opacity-50"
          >
            {disconnecting ? <Loader2 className="animate-spin w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {disconnecting ? 'Desconectando...' : 'Desconectar / trocar número'}
          </button>
        </div>
      )}

      {status?.provisioned && !status.connected && !connecting && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-amber-300 text-sm font-medium">
            <WifiOff className="w-4 h-4" /> Desconectado
          </div>
          <button
            onClick={startConnecting}
            className="inline-flex items-center gap-2 backdrop-blur-md bg-white/15 border border-white/25 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-white/25 transition-all"
          >
            Conectar WhatsApp
          </button>
        </div>
      )}

      {connecting && (
        <div className="space-y-3">
          {qrcode ? (
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="bg-white p-3 rounded-2xl">
                <img src={qrcode} alt="QR code do WhatsApp" className="w-48 h-48" />
              </div>
              <p className="text-xs text-white/50 text-center">Abra o WhatsApp no celular, vá em Aparelhos conectados e escaneie o código.</p>
            </div>
          ) : (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin w-5 h-5 text-white/40" /></div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-300 mt-3">{error}</p>}
    </div>
  );
}

function NavItem({ icon, label, active, onClick, className }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 font-medium",
        active
          ? "backdrop-blur-md bg-white/20 text-white border border-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_2px_8px_rgba(0,0,0,0.2)]"
          : "text-white/55 hover:bg-white/10 hover:text-white/80",
        className
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon, onClick }: any) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "p-6 rounded-3xl transition-all",
        "backdrop-blur-xl bg-white/10 border border-white/15",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_8px_32px_rgba(0,0,0,0.2)]",
        onClick && "cursor-pointer hover:bg-white/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_12px_40px_rgba(0,0,0,0.28)] active:scale-[0.98]"
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="backdrop-blur-sm bg-white/10 border border-white/15 p-2.5 rounded-xl">{icon}</div>
        <span className="text-sm text-white/60 font-medium">{label}</span>
      </div>
      <div className="text-3xl font-bold text-white">{value}</div>
    </div>
  );
}

function LeadItem({ name, property, time }: any) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-white/10 last:border-b-0">
      <div>
        <div className="font-bold text-sm text-white">{name}</div>
        <div className="text-xs text-white/50">{property}</div>
      </div>
      <div className="text-[10px] text-white/35 uppercase font-bold">{time}</div>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  disponivel: { label: 'Disponível', className: 'bg-green-100 text-green-700' },
  vendido:    { label: 'Vendido',    className: 'bg-gray-200 text-gray-600' },
  alugado:    { label: 'Alugado',    className: 'bg-blue-100 text-blue-700' },
};

function PropertyCard({ title, location, price, image, slug, status, onEdit, onDelete, onCopyLink, onStatusChange, isDeleting }: any) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.disponivel;

  return (
    <motion.div
      whileHover={{ y: -6 }}
      className="rounded-3xl overflow-hidden group flex flex-col
        backdrop-blur-xl bg-white/10 border border-white/15
        shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]
        hover:bg-white/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_16px_48px_rgba(0,0,0,0.35)] transition-all"
    >
      <div className="h-48 relative overflow-hidden cursor-pointer" onClick={onEdit}>
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-4 left-4 backdrop-blur-md bg-black/40 border border-white/20 px-3 py-1 rounded-full text-xs font-bold text-white shadow-lg">
          {price}
        </div>
        <div className={cn("absolute top-4 right-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shadow-sm", s.className)}>
          {s.label}
        </div>
      </div>

      <div className="p-5 flex flex-col flex-1">
        <h3 className="font-bold text-base mb-1 leading-tight cursor-pointer text-white" onClick={onEdit}>{title}</h3>
        <p className="text-sm text-white/55 flex items-center gap-1 mb-4 truncate">
          <TrendingUp size={13} className="shrink-0" /> {location}
        </p>

        {/* Status selector */}
        <select
          value={status || 'disponivel'}
          onChange={e => { e.stopPropagation(); onStatusChange(e.target.value); }}
          className={cn("w-full px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide border-none outline-none cursor-pointer mb-4", s.className)}
        >
          <option value="disponivel">Disponível</option>
          <option value="vendido">Vendido</option>
          <option value="alugado">Alugado</option>
        </select>

        <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/10">
          <div className="flex items-center gap-1">
            <a
              href={`/p/${slug}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/15 hover:text-white transition-all"
              title="Abrir landing page"
            >
              <ExternalLink size={16} />
            </a>
            <button
              onClick={e => { e.stopPropagation(); onCopyLink(); }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/15 hover:text-white transition-all"
              title="Copiar link"
            >
              <Copy size={16} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              disabled={isDeleting}
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
                isDeleting ? "bg-white/5 text-white/25" : "text-white/40 hover:bg-red-500/15 hover:text-red-300"
              )}
              title="Excluir"
            >
              {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            </button>
            <button
              onClick={e => { e.stopPropagation(); onEdit(); }}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/15 hover:text-white transition-all"
              title="Editar"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
