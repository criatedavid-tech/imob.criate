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

function hoursLeftLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'a qualquer momento';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

// Cockpit real da INCORPORADORA (Etapa 1, dado real de Lançamentos/Etapa 7 +
// Agenda/Etapa 5). `refresh` recarrega o cockpit depois de uma ação real
// (estender/liberar reserva) — mesmo padrão de refreshKey do CommandBar.
export async function fetchIncorporadoraLayout(refresh: () => void): Promise<LayoutSpec> {
  const headers = authService.getAuthHeaders();

  const [meRes, devsRes] = await Promise.all([
    fetch('/api/brokers/me', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/lancamentos/developments', { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
  ]);

  const firstName = (meRes?.name || '').trim().split(' ')[0] || null;
  const hour = new Date().getHours();
  const saudacao = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const greeting = firstName ? `${saudacao}, ${firstName}.` : `${saudacao}.`;

  const developments = Array.isArray(devsRes) ? devsRes : [];
  if (developments.length === 0) {
    return {
      persona: 'incorporadora', greeting,
      subtitle: 'Você ainda não tem nenhum empreendimento cadastrado.',
      widgets: [{
        id: 'w-empty', type: 'emptyState', span: 'full',
        data: { text: 'Cadastre seu primeiro empreendimento em "Lançamentos", na lateral, pra ver o espelho de vendas aqui.' },
      }],
      isRealData: true,
    };
  }

  // Empreendimento com mais unidades = o mais representativo pro espelho.
  const featured = developments.reduce((max: any, d: any) => (d.total_units > (max?.total_units || 0) ? d : max), developments[0]);
  const totalUnitsAll = developments.reduce((s: number, d: any) => s + d.total_units, 0);
  const soldUnitsAll = developments.reduce((s: number, d: any) => s + d.vendido, 0);
  const reservedUnitsAll = developments.reduce((s: number, d: any) => s + d.reservado, 0);

  const [unitsRes, leadsRes, finRes, visitsRes] = await Promise.all([
    fetch(`/api/lancamentos/developments/${featured.id}/units`, { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/leads', { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/financeiro/summary', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`/api/agenda/visits?start=${new Date().toISOString()}`, { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
  ]);

  const units = Array.isArray(unitsRes) ? unitsRes : [];
  const todayIso = new Date().toISOString().split('T')[0];
  const leadsToday = (Array.isArray(leadsRes) ? leadsRes : []).filter((l: any) => (l.created_at || '').startsWith(todayIso)).length;
  const vgvCents = finRes?.sales_total_cents ?? 0;
  const vgvLabel = (vgvCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 1, notation: vgvCents >= 100_000_00 ? 'compact' : 'standard' });

  const visits = (Array.isArray(visitsRes) ? visitsRes : [])
    .slice().sort((a: any, b: any) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()).slice(0, 5);

  // Reserva expirando nas próximas 3h — vira o card de decisão real (Estender/Liberar de verdade).
  const now = Date.now();
  const expiring = units.find((u: any) => {
    if (u.status !== 'reservado' || !u.reserved_until) return false;
    const ms = new Date(u.reserved_until).getTime() - now;
    return ms > 0 && ms < 3 * 3600_000;
  });

  const subtitle = `${featured.name} está ${featured.total_units ? Math.round((featured.vendido / featured.total_units) * 100) : 0}% vendido. `
    + (expiring ? `A reserva da unidade ${expiring.code} expira em breve.` : `${reservedUnitsAll} reserva(s) ativa(s) no total.`);

  const widgets: LayoutSpec['widgets'] = [
    {
      id: 'w-kpis', type: 'kpis', span: 'full', data: [
        { label: 'VGV vendido', value: vgvLabel, delta: `${totalUnitsAll ? Math.round((soldUnitsAll / totalUnitsAll) * 100) : 0}%`, tone: 'up' },
        { label: 'Unidades vendidas', value: `${soldUnitsAll}/${totalUnitsAll}`, delta: featured.name, tone: 'up' },
        { label: 'Reservas ativas', value: String(reservedUnitsAll), delta: expiring ? '1 expira em breve' : 'nenhuma expirando', tone: expiring ? 'hot' : 'neutral' },
        { label: 'Leads hoje', value: String(leadsToday), delta: 'novos', tone: leadsToday > 0 ? 'up' : 'neutral' },
      ],
    },
    {
      id: 'w-mirror', type: 'salesmirror', span: 'lg', title: `Espelho de vendas — ${featured.name}`,
      data: { units: units.map((u: any) => ({ n: u.code, status: u.status })) },
    },
  ];

  if (expiring) {
    widgets.push({
      id: 'w-dec', type: 'decisions', span: 'sm', title: 'Precisa de você', data: [
        {
          icon: 'clock',
          text: `Reserva da unidade ${expiring.code} expira em ${hoursLeftLabel(expiring.reserved_until)}. Estendo mais 30min?`,
          primary: 'Estender', ghost: 'Liberar',
          onPrimary: async () => {
            await fetch(`/api/lancamentos/units/${expiring.id}`, {
              method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'estender', extend_minutes: 30 }),
            });
            refresh();
          },
          onGhost: async () => {
            await fetch(`/api/lancamentos/units/${expiring.id}`, {
              method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'liberar' }),
            });
            refresh();
          },
        },
      ],
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

  return { persona: 'incorporadora', greeting, subtitle, widgets, isRealData: true };
}

// Cockpit real da IMOBILIÁRIA (Etapa 1, dado real de Locação/Etapa 6 +
// Relatórios/Etapa 11). Roster/ranking/distribuição de equipe NÃO aparecem —
// dependem de multi-usuário por conta, que o produto não suporta ainda
// (mesma trava documentada em EquipeArea.tsx); mostrar isso aqui seria
// inventar dado que não existe.
export async function fetchImobiliariaLayout(refresh: () => void, navigate: (area: string) => void): Promise<LayoutSpec> {
  const headers = authService.getAuthHeaders();

  const [meRes, contractsRes, leadsRes, relatRes] = await Promise.all([
    fetch('/api/brokers/me', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/api/locacao/contracts', { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/leads', { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch('/api/relatorios/summary?months=6', { headers }).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);

  const firstName = (meRes?.name || '').trim().split(' ')[0] || null;
  const hour = new Date().getHours();
  const saudacao = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const greeting = firstName ? `${saudacao}, ${firstName}.` : `${saudacao}.`;

  const contracts = Array.isArray(contractsRes) ? contractsRes : [];
  const activeContracts = contracts.filter((c: any) => c.status === 'ativo');
  const overdueContracts = activeContracts.filter((c: any) => c.current_month_payment_status === 'overdue');

  const todayIso = new Date().toISOString().split('T')[0];
  const leadsToday = (Array.isArray(leadsRes) ? leadsRes : []).filter((l: any) => (l.created_at || '').startsWith(todayIso)).length;
  const conversionRate = relatRes?.conversionRate ?? 0;

  const isEmpty = activeContracts.length === 0 && leadsToday === 0;
  const subtitle = isEmpty
    ? 'Ainda não há contratos de locação nem leads hoje — comece cadastrando um contrato ou aguarde os primeiros leads.'
    : overdueContracts.length > 0
      ? `${overdueContracts[0].tenant_name} está com o aluguel em atraso. ${leadsToday} lead${leadsToday === 1 ? '' : 's'} hoje.`
      : `${activeContracts.length} contrato(s) de locação em dia. ${leadsToday} lead${leadsToday === 1 ? '' : 's'} hoje.`;

  const widgets: LayoutSpec['widgets'] = [
    {
      id: 'w-kpis', type: 'kpis', span: 'full', data: [
        { label: 'Leads', value: String(leadsToday), delta: 'hoje', tone: leadsToday > 0 ? 'up' : 'neutral' },
        { label: 'Conversão', value: `${conversionRate}%`, delta: `${relatRes?.months ?? 6} meses`, tone: 'neutral' },
        { label: 'Contratos ativos', value: String(activeContracts.length), delta: 'locação', tone: 'neutral' },
        { label: 'Inadimplência', value: String(overdueContracts.length), delta: 'em atraso', tone: overdueContracts.length > 0 ? 'down' : 'neutral' },
      ],
    },
  ];

  if (overdueContracts.length > 0) {
    widgets.push({
      id: 'w-dec', type: 'decisions', span: 'md', title: 'Precisa de você',
      data: overdueContracts.slice(0, 2).map((c: any) => ({
        icon: 'key',
        text: `${c.tenant_name}${c.property ? ` (${c.property})` : ''} está com o aluguel em atraso.`,
        primary: 'Ver contrato', ghost: 'Depois',
        onPrimary: () => navigate('locacao'),
      })),
    });
  }

  if (isEmpty) {
    widgets.push({
      id: 'w-empty', type: 'emptyState', span: 'full',
      data: { text: 'Cadastre um contrato de locação em "Locação", na lateral, pra começar.' },
    });
  }

  return { persona: 'imobiliaria', greeting, subtitle, widgets, isRealData: true };
}
