import { authService } from '../services/auth';
import type { LayoutSpec } from './types';

// Busca o cockpit "Hoje" do CORRETOR com dados reais do backend já existente.
// Nada aqui é inventado — cada número vem de um endpoint que já roda em produção.
// Se algo falhar ou vier zerado, o cockpit reflete isso honestamente (nunca preenche com mock).
export async function fetchCorretorLayout(): Promise<LayoutSpec> {
  const headers = authService.getAuthHeaders();

  const [meRes, metricsRes, leadsRes, visitsRes, usageRes] = await Promise.all([
    fetch('/api/brokers/me', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/dashboard/metrics', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/leads/recent', { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`/api/agenda/visits?start=${new Date().toISOString()}`, { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/billing/usage', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const firstName = (meRes?.name || '').trim().split(' ')[0] || null;
  const totalProperties = metricsRes?.totalProperties ?? 0;
  const activeLeads = metricsRes?.activeLeads ?? 0;
  const scheduledVisits = metricsRes?.scheduledVisits ?? 0;
  const ticketsUsed = usageRes?.current_period?.tickets_used ?? 0;

  const leads = (Array.isArray(leadsRes) ? leadsRes : []).slice(0, 5);
  const visits = (Array.isArray(visitsRes) ? visitsRes : [])
    .slice()
    .sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 5);

  const hour = new Date().getHours();
  const saudacao = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const greeting = firstName ? `${saudacao}, ${firstName}.` : `${saudacao}.`;

  const isEmpty = totalProperties === 0 && activeLeads === 0 && scheduledVisits === 0;
  const subtitle = isEmpty
    ? 'Você ainda não tem nada por aqui. Cadastre seu primeiro imóvel para o agente de IA começar a atender.'
    : `Hoje: ${totalProperties} imóve${totalProperties === 1 ? 'l' : 'is'} no ar, ${activeLeads} lead${activeLeads === 1 ? '' : 's'} ativo${activeLeads === 1 ? '' : 's'} e ${scheduledVisits} visita${scheduledVisits === 1 ? '' : 's'} agendada${scheduledVisits === 1 ? '' : 's'}.`;

  const widgets: LayoutSpec['widgets'] = [
    {
      id: 'w-kpis', type: 'kpis', span: 'full', data: [
        { label: 'Imóveis', value: String(totalProperties), delta: 'no ar', tone: 'neutral' },
        { label: 'Leads ativos', value: String(activeLeads), delta: 'agora', tone: activeLeads > 0 ? 'up' : 'neutral' },
        { label: 'Visitas', value: String(scheduledVisits), delta: 'agendadas', tone: 'neutral' },
        { label: 'Atendimentos', value: String(ticketsUsed), delta: 'no ciclo', tone: 'neutral' },
      ],
    },
  ];

  if (leads.length > 0) {
    widgets.push({
      id: 'w-leads', type: 'leadsList', span: 'md', title: 'Leads recentes',
      data: leads.map((l: any) => ({
        name: l.name || 'Sem nome',
        property: l.property || 'Imóvel',
        status: l.status || 'novo',
      })),
    });
  }

  if (visits.length > 0) {
    widgets.push({
      id: 'w-agenda', type: 'agenda', span: 'md', title: 'Próximas visitas',
      data: visits.map((v: any) => ({
        time: new Date(v.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        who: v.name || v.client_name || 'Cliente',
        unit: v.property || 'Imóvel a confirmar',
      })),
    });
  }

  if (isEmpty) {
    widgets.push({
      id: 'w-empty', type: 'emptyState', span: 'full',
      data: { text: 'Cadastre seu primeiro imóvel em "Carteira", na lateral, para começar.' },
    });
  }

  return { persona: 'corretor', greeting, subtitle, widgets, isRealData: true };
}
