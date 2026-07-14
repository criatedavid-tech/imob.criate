import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Building2, Loader2 } from 'lucide-react';
import Copyright from '../components/Copyright';

interface VitrineDevelopment {
  id: string;
  name: string;
  location?: string;
  tipo: 'vertical' | 'horizontal';
  subtipo?: 'loteamento' | 'condominio_casas' | null;
  amenities: string[];
  images: string[];
  total_units: number;
  disponivel: number;
  vendido: number;
}

interface VitrineData {
  broker: { name: string; address: string };
  developments: VitrineDevelopment[];
}

const TIPO_LABEL: Record<string, string> = {
  vertical: 'Prédio',
  loteamento: 'Loteamento',
  condominio_casas: 'Condomínio de casas',
};

// Página pública da vitrine de Lançamentos (/lancamentos-vitrine/:brokerId) —
// link único pra compartilhar os empreendimentos da incorporadora. Mostra só
// contadores agregados (nunca nome/telefone de comprador).
export default function VitrineLancamentos() {
  const { brokerId } = useParams();
  const [data, setData] = useState<VitrineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/vitrine-lancamentos/${brokerId}`)
      .then(async (r) => {
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          throw new Error(b?.error || 'Vitrine não encontrada.');
        }
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [brokerId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
        <Loader2 className="w-7 h-7 text-white/60 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 px-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-white/[0.06] border border-white/12">
            <Building2 className="w-6 h-6 text-white/40" />
          </div>
          <p className="text-white/70">{error || 'Vitrine não encontrada.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
      <div className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6 py-14">
        <header className="text-center mb-12">
          <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-violet-300/70 mb-3">Empreendimentos</p>
          <h1 className="text-4xl md:text-5xl font-black text-white">{data.broker.name}</h1>
          {data.broker.address && (
            <p className="text-[15px] text-white/50 flex items-center justify-center gap-1.5 mt-3">
              <MapPin className="w-4 h-4" /> {data.broker.address}
            </p>
          )}
        </header>

        {data.developments.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-white/50">Nenhum empreendimento publicado no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.developments.map((d) => {
              const pctVendido = d.total_units ? Math.round((d.vendido / d.total_units) * 100) : 0;
              const subtipoLabel = d.tipo === 'horizontal' ? (TIPO_LABEL[d.subtipo || 'loteamento']) : TIPO_LABEL.vertical;
              return (
                <div key={d.id}
                  className="rounded-[26px] overflow-hidden backdrop-blur-2xl bg-white/[0.06] border border-white/10
                    shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_20px_50px_-24px_rgba(0,0,0,0.6)]">
                  <div className="h-52 bg-white/5 relative overflow-hidden">
                    {d.images?.[0] ? (
                      <img src={d.images[0]} alt={d.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/20">
                        <Building2 className="w-10 h-10" />
                      </div>
                    )}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-black/50 text-white/80 backdrop-blur-sm">
                      {subtipoLabel}
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="text-[17px] font-bold text-white truncate">{d.name}</h3>
                    {d.location && (
                      <p className="text-[13px] text-white/45 flex items-center gap-1 mt-1 truncate">
                        <MapPin className="w-3.5 h-3.5 shrink-0" /> {d.location}
                      </p>
                    )}
                    {d.amenities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {d.amenities.slice(0, 4).map((a) => (
                          <span key={a} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/[0.06] border border-white/10 text-white/50">{a}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-[12px] text-white/50 mb-1.5">
                        <span>{d.disponivel} unidade{d.disponivel === 1 ? '' : 's'} disponível{d.disponivel === 1 ? '' : 'is'}</span>
                        <span>{pctVendido}% vendido</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-violet-400 to-indigo-400 rounded-full" style={{ width: `${pctVendido}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-16 text-center">
          <Copyright />
        </div>
      </div>
    </div>
  );
}
