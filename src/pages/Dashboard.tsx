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
  CheckCircle2
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import PropertyForm from '../components/PropertyForm';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

import AISettings from '../components/AISettings';
import { authService } from '../services/auth';
import MagicWandTextarea from '../components/MagicWandTextarea';


/**
 * Componente Principal do Dashboard.
 * Gerencia a listagem de imóveis, métricas de desempenho e leads recentes.
 */
export default function Dashboard() {
  const [isFormOpen, setIsFormOpen] = useState(false); // Modal de criação/edição de imóvel
  const [editingProperty, setEditingProperty] = useState<any>(null); // Dados do imóvel sendo editado
  const [activeTab, setActiveTab] = useState('overview'); // Aba ativa (Métricas, Imóveis, Leads, Perfil)
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
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [chartData, setChartData] = useState<{name: string, value: number}[]>([]);

  // PERFIL DO CORRETOR
  const [brokerProfile, setBrokerProfile] = useState<any>({
    name: '',
    title: 'Principal Broker',
    photoUrl: '',
    bio1: '...',
    bio2: '...',
    quote: '...',
    propertiesSold: '150+',
    volumeSold: '$2B+'
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
      // Usamos broker_address para armazenar os campos extras em JSON
      const { name, ...extraData } = brokerProfile;
      const settingsToSave = {
        name: name,
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
    fetchRecentLeads();
    fetchBrokerProfile();
    fetchChartData();
    const intervalId = setInterval(checkBackend, 5000);
    return () => clearInterval(intervalId);
  }, []);

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

  return (
    <div className="flex h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans">
      {/* Sidebar omitted for brevity, logic follows */}
      <aside className="w-64 bg-white border-r border-[#E5E7EB] flex flex-col p-6">
        <div className="flex items-center gap-2 mb-10">
          <div 
            onClick={handleSafeReload} // FIX AUTH STATE 30/04/2026
            className="w-10 h-10 bg-black rounded-lg flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
          >
            <Home className="text-white w-6 h-6" />
          </div>
          <span 
            onClick={handleSafeReload} // FIX AUTH STATE 30/04/2026
            className="font-bold text-xl tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
          >
            ImobiFlow
          </span>
        </div>

        <nav className="flex-1 space-y-2">
          <NavItem 
            icon={<BarChart3 size={20} />} 
            label="Dashboard" 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')} 
          />
          <NavItem 
            icon={<Home size={20} />} 
            label="Imóveis" 
            active={activeTab === 'properties'} 
            onClick={() => setActiveTab('properties')} 
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="Leads" 
            active={activeTab === 'leads'} 
            onClick={() => setActiveTab('leads')} 
          />
          <NavItem 
            icon={<Calendar size={20} />} 
            label="Agenda" 
            active={activeTab === 'calendar'} 
            onClick={() => setActiveTab('calendar')} 
          />
        </nav>

        <div className="mt-auto pt-6 border-t border-[#E5E7EB] space-y-2">
          <NavItem 
            icon={<Settings size={20} />} 
            label="Meu Perfil" 
            active={activeTab === 'profile'}
            onClick={() => setActiveTab('profile')}
          />
          <NavItem 
            icon={<LogOut size={20} />} 
            label="Sair" 
            className="text-red-500 hover:bg-red-50" 
            onClick={() => authService.logout()}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <header className="h-20 bg-white border-b border-[#E5E7EB] flex items-center justify-between px-10">
          <div className="flex items-center gap-6">
            <div className="relative w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" size={18} />
              <input 
                type="text" 
                placeholder="Pesquisar..." 
                className="w-full pl-10 pr-4 py-2 bg-[#F3F4F6] border-none rounded-full focus:ring-2 focus:ring-black outline-none transition-all"
              />
            </div>
            <div className={`flex flex-col gap-1 px-3 py-1 rounded-2xl text-[10px] font-bold uppercase tracking-wider ${backendStatus === 'online' ? 'bg-green-100 text-green-600' : backendStatus === 'error' ? 'bg-yellow-100 text-yellow-600' : 'bg-red-100 text-red-600'}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${backendStatus === 'online' ? 'bg-green-500 animate-pulse' : backendStatus === 'error' ? 'bg-yellow-500' : 'bg-red-500'}`} />
                Backend {backendStatus === 'online' ? 'On-line' : backendStatus === 'error' ? 'Com Erro' : 'Off-line'}
              </div>
              <div className="text-[9px] opacity-70 lowercase font-mono">
                {dbStatus}
              </div>
            </div>
          </div>

          <button 
            onClick={() => setIsFormOpen(true)}
            className="bg-black text-white px-6 py-2.5 rounded-full flex items-center gap-2 font-medium hover:bg-[#333] transition-colors"
          >
            <Plus size={20} />
            Cadastrar Imóvel
          </button>
        </header>

        <div className="p-10 max-w-7xl mx-auto">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                  label="Total de Imóveis" 
                  value={dashboardMetrics.totalProperties.toString()} 
                  icon={<Home className="text-blue-500" />} 
                  onClick={() => setActiveTab('properties')} // AJUSTE REDIRECIONAMENTO 30/04/2026
                />
                <StatCard 
                  label="Leads Ativos" 
                  value={dashboardMetrics.activeLeads.toString()} 
                  icon={<Users className="text-green-500" />} 
                  onClick={() => setActiveTab('leads')} // AJUSTE REDIRECIONAMENTO 30/04/2026
                />
                <StatCard 
                  label="Visitas Agendadas" 
                  value={dashboardMetrics.scheduledVisits.toString()} 
                  icon={<Calendar className="text-purple-500" />} 
                  onClick={() => setActiveTab('calendar')} // AJUSTE REDIRECIONAMENTO 30/04/2026
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-white p-8 rounded-3xl border border-[#E5E7EB]">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold">Interesse nos Imóveis</h2>
                    <TrendingUp className="text-[#10B981]" />
                  </div>
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#9CA3AF'}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fill: '#9CA3AF'}} />
                        <Tooltip 
                          cursor={{fill: '#F3F4F6'}} 
                          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}} 
                        />
                        <Bar dataKey="value" fill="#000" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-3xl border border-[#E5E7EB] flex flex-col">
                  <h2 className="text-xl font-bold mb-6">Últimos Leads</h2>
                  <div className="space-y-4 flex-1">
                    {loadingMetrics ? (
                      <div className="flex flex-col items-center justify-center py-10 opacity-50">
                        <Loader2 className="animate-spin mb-2" size={24} />
                        <span className="text-sm">Carregando leads...</span>
                      </div>
                    ) : recentLeads.length > 0 ? (
                      recentLeads.map(lead => (
                        <LeadItem 
                          key={lead.id} 
                          name={lead.name} 
                          property={lead.property} 
                          time={formatTimeAgo(lead.time)} 
                        />
                      ))
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 opacity-50">
                        <Users size={32} className="mb-2" />
                        <span className="text-sm">Nenhum lead recente</span>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setActiveTab('leads')}
                    className="w-full py-3 text-sm font-semibold border-t border-[#E5E7EB] mt-4 flex items-center justify-center gap-1 hover:text-blue-600 transition-colors"
                  >
                    Ver todos os leads <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'properties' && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Seus Imóveis</h2>
              {loading && <p>Carregando imóveis...</p>}
              {!loading && properties.length === 0 && <p className="text-[#6B7280]">Nenhum imóvel cadastrado ainda.</p>}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {properties.map((prop) => (
                  <PropertyCard 
                    key={prop.id}
                    title={prop.title} 
                    location={prop.location} 
                    price={prop.price} 
                    image={prop.imageUrl || "https://picsum.photos/seed/placeholder/800/600"}
                    slug={prop.slug}
                    description={prop.description}
                    onEdit={() => handleOpenEdit(prop)}
                    onDelete={() => setDeleteConfirmId(prop.id)}
                    isDeleting={deletingId === prop.id}
                  />
                ))}
              </div>
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="max-w-3xl mx-auto space-y-8">
              <h2 className="text-2xl font-bold mb-6">Meu Perfil Profissional</h2>
              <div className="bg-white p-8 rounded-3xl border border-[#E5E7EB]">
                <form onSubmit={saveBrokerProfile} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold text-[#6B7280]">Nome Completo</label>
                      <input 
                        type="text" 
                        value={brokerProfile.name || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, name: e.target.value})}
                        className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black"
                        required
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold text-[#6B7280]">Título Profissional</label>
                      <input 
                        type="text" 
                        value={brokerProfile.title || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, title: e.target.value})}
                        className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black"
                        placeholder="Ex: Principal Broker"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="block text-sm font-semibold text-[#6B7280]">Foto de Perfil</label>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoUpload}
                    />
                    <div className="flex items-center gap-5">
                      <div className="relative shrink-0">
                        <div className="w-20 h-20 rounded-full overflow-hidden bg-[#F3F4F6] border-2 border-[#E5E7EB] flex items-center justify-center">
                          {brokerProfile.photoUrl ? (
                            <img src={brokerProfile.photoUrl} alt="Foto de perfil" className="w-full h-full object-cover" />
                          ) : (
                            <svg className="w-8 h-8 text-[#9CA3AF]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                          className="px-5 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-[#333] transition-colors disabled:opacity-60 flex items-center gap-2"
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
                        <p className="text-xs text-[#9CA3AF]">JPG, PNG ou WEBP · Máx. 5MB</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="block text-sm font-semibold text-[#6B7280]">Citação (Filosofia de Trabalho)</label>
                    <MagicWandTextarea 
                      value={brokerProfile.quote}
                      onChange={e => setBrokerProfile({...brokerProfile, quote: e.target.value})}
                      onApply={(text) => setBrokerProfile({...brokerProfile, quote: text})}
                      rows={2}
                      className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black resize-none"
                    />
                  </div>

                  <div className="space-y-4">
                    <label className="block text-sm font-semibold text-[#6B7280]">Trajetória (Parágrafo 1)</label>
                    <MagicWandTextarea 
                      value={brokerProfile.bio1}
                      onChange={e => setBrokerProfile({...brokerProfile, bio1: e.target.value})}
                      onApply={(text) => setBrokerProfile({...brokerProfile, bio1: text})}
                      rows={3}
                      className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black resize-none"
                    />
                  </div>

                  <div className="space-y-4">
                    <label className="block text-sm font-semibold text-[#6B7280]">Trajetória (Parágrafo 2)</label>
                    <MagicWandTextarea 
                      value={brokerProfile.bio2}
                      onChange={e => setBrokerProfile({...brokerProfile, bio2: e.target.value})}
                      onApply={(text) => setBrokerProfile({...brokerProfile, bio2: text})}
                      rows={3}
                      className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black resize-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold text-[#6B7280]">Imóveis Vendidos (Ex: 150+)</label>
                      <input 
                        type="text" 
                        value={brokerProfile.propertiesSold || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, propertiesSold: e.target.value})}
                        className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>
                    <div className="space-y-4">
                      <label className="block text-sm font-semibold text-[#6B7280]">Volume Vendido (Ex: $2B+)</label>
                      <input 
                        type="text" 
                        value={brokerProfile.volumeSold || ''}
                        onChange={e => setBrokerProfile({...brokerProfile, volumeSold: e.target.value})}
                        className="w-full px-4 py-3 bg-[#F8F9FA] rounded-xl border-none outline-none focus:ring-2 focus:ring-black"
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    disabled={isSavingProfile}
                    className="w-full bg-black text-white py-4 rounded-xl font-bold flex justify-center items-center gap-2 hover:opacity-80 transition-opacity disabled:opacity-50 mt-4"
                  >
                    {isSavingProfile ? <Loader2 className="animate-spin" size={20} /> : 'Salvar Alterações'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'leads' && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Leads</h2>
              {loadingMetrics && (
                <div className="flex items-center gap-3 text-[#6B7280] py-10">
                  <Loader2 className="animate-spin" size={20} />
                  <span>Carregando leads...</span>
                </div>
              )}
              {!loadingMetrics && recentLeads.length === 0 && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="w-16 h-16 bg-[#F3F4F6] rounded-2xl flex items-center justify-center mb-4">
                    <Users size={28} className="text-[#9CA3AF]" />
                  </div>
                  <h3 className="font-bold text-lg mb-1">Nenhum lead ainda</h3>
                  <p className="text-[#6B7280] text-sm max-w-xs">Os leads aparecem aqui quando alguém demonstra interesse em um imóvel via landing page.</p>
                </div>
              )}
              {!loadingMetrics && recentLeads.length > 0 && (
                <div className="bg-white rounded-3xl border border-[#E5E7EB] overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#F3F4F6]">
                        <th className="text-left px-6 py-4 text-xs font-bold text-[#9CA3AF] uppercase tracking-wider">Nome</th>
                        <th className="text-left px-6 py-4 text-xs font-bold text-[#9CA3AF] uppercase tracking-wider">Imóvel</th>
                        <th className="text-left px-6 py-4 text-xs font-bold text-[#9CA3AF] uppercase tracking-wider">Recebido</th>
                        <th className="text-left px-6 py-4 text-xs font-bold text-[#9CA3AF] uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentLeads.map((lead) => (
                        <tr key={lead.id} className="border-b border-[#F9FAFB] last:border-b-0 hover:bg-[#FAFAFA] transition-colors">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-[#F3F4F6] rounded-full flex items-center justify-center text-xs font-bold text-[#6B7280]">
                                {lead.name?.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-semibold text-sm">{lead.name}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-[#6B7280]">{lead.property || '—'}</td>
                          <td className="px-6 py-4 text-sm text-[#9CA3AF]">{formatTimeAgo(lead.time)}</td>
                          <td className="px-6 py-4">
                            <span className="px-3 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-full uppercase tracking-wide">
                              {lead.status || 'Novo'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'calendar' && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Agenda</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl border border-[#E5E7EB] p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-[#F3F4F6] rounded-xl flex items-center justify-center">
                      <Calendar size={20} className="text-purple-500" />
                    </div>
                    <h3 className="font-bold text-lg">Visitas Agendadas</h3>
                  </div>
                  {dashboardMetrics.scheduledVisits > 0 ? (
                    <p className="text-3xl font-bold mb-2">{dashboardMetrics.scheduledVisits}</p>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <Calendar size={32} className="text-[#E5E7EB] mb-3" />
                      <p className="text-sm text-[#6B7280]">Nenhuma visita agendada no momento.</p>
                      <p className="text-xs text-[#9CA3AF] mt-1">As visitas aparecem aqui quando leads agendam via landing page.</p>
                    </div>
                  )}
                </div>
                <div className="bg-white rounded-3xl border border-[#E5E7EB] p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-[#F3F4F6] rounded-xl flex items-center justify-center">
                      <Users size={20} className="text-green-500" />
                    </div>
                    <h3 className="font-bold text-lg">Leads Ativos</h3>
                  </div>
                  <p className="text-3xl font-bold mb-1">{dashboardMetrics.activeLeads}</p>
                  <p className="text-sm text-[#6B7280]">leads aguardando retorno</p>
                  <button
                    onClick={() => setActiveTab('leads')}
                    className="mt-6 w-full py-3 border border-[#E5E7EB] rounded-2xl text-sm font-semibold hover:bg-[#F3F4F6] transition-colors flex items-center justify-center gap-2"
                  >
                    Ver todos os leads <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && <AISettings />}
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

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-bold mb-2">Excluir item?</h3>
              <p className="text-[#6B7280]">
                Tem certeza que deseja excluir? Essa ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex border-t border-[#F3F4F6]">
              <button 
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-6 py-4 font-bold text-[#6B7280] hover:bg-[#F8F9FA] transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleDelete}
                className="flex-1 px-6 py-4 font-bold text-red-500 hover:bg-red-50 transition-colors border-l border-[#F3F4F6]"
              >
                Excluir
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[110] pointer-events-none">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              "px-6 py-3 rounded-2xl shadow-xl flex items-center gap-3 font-medium",
              toast.type === 'success' ? "bg-black text-white" : "bg-red-500 text-white"
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

function NavItem({ icon, label, active, onClick, className }: any) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200",
        active ? "bg-black text-white" : "text-[#6B7280] hover:bg-[#F3F4F6]",
        className
      )}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  );
}

function StatCard({ label, value, icon, onClick }: any) {
  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white p-6 rounded-3xl border border-[#E5E7EB] transition-all",
        onClick && "cursor-pointer hover:shadow-md hover:border-black/10 active:scale-[0.98]"
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="bg-[#F8F9FA] p-2.5 rounded-xl">{icon}</div>
        <span className="text-sm text-[#6B7280] font-medium">{label}</span>
      </div>
      <div className="text-3xl font-bold">{value}</div>
    </div>
  );
}

function LeadItem({ name, property, time }: any) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[#F3F4F6] last:border-b-0">
      <div>
        <div className="font-bold text-sm">{name}</div>
        <div className="text-xs text-[#6B7280]">{property}</div>
      </div>
      <div className="text-[10px] text-[#9CA3AF] uppercase font-bold">{time}</div>
    </div>
  );
}

function PropertyCard({ title, location, price, image, slug, onEdit, onDelete, isDeleting }: any) {
  return (
    <motion.div 
      whileHover={{ y: -5 }}
      onClick={onEdit}
      className="bg-white rounded-3xl overflow-hidden border border-[#E5E7EB] group cursor-pointer"
    >
      <div className="h-48 relative overflow-hidden">
        <img 
          src={image} 
          alt={title} 
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-xs font-bold shadow-sm">
          {price}
        </div>
      </div>
      <div className="p-6">
        <h3 className="font-bold text-lg mb-1 leading-tight">{title}</h3>
        <p className="text-sm text-[#6B7280] flex items-center gap-1 mb-4">
          <TrendingUp size={14} /> {location}
        </p>
        <div className="flex items-center justify-between">
          <a 
            href={`/p/${slug}`} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()} // Prevent card click
            className="text-sm font-bold text-blue-600 hover:underline flex items-center gap-1"
          >
            Ver Landing Page <ChevronRight size={14} />
          </a>
          <div className="flex items-center gap-2">
            <button 
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center transition-all",
                isDeleting ? "bg-gray-100 text-[#9CA3AF]" : "text-[#9CA3AF] hover:bg-red-50 hover:text-red-500"
              )}
            >
              {isDeleting ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-black transition-all"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
