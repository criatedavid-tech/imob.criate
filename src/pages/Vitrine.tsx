import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MapPin, Home, Loader2, ArrowRight } from 'lucide-react';
import Copyright from '../components/Copyright';

interface VitrineProperty {
  title: string;
  price: string;
  location: string;
  imageUrl: string;
  slug: string;
}

interface VitrineData {
  broker: { name: string; address: string };
  properties: VitrineProperty[];
}

// Página pública da vitrine do corretor (/vitrine/:brokerId). Um link único
// pra compartilhar (WhatsApp, bio) com todos os imóveis disponíveis. Cada card
// leva pro landing individual (/p/:slug), onde já vive o contato/agendamento.
export default function Vitrine() {
  const { brokerId } = useParams();
  const [data, setData] = useState<VitrineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/vitrine/${brokerId}`)
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
      <div className="min-h-screen flex items-center justify-center app-bg">
        <Loader2 className="w-7 h-7 text-[var(--text-mid)] animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center app-bg px-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-[var(--control-fill)] border border-[var(--hairline-strong)]">
            <Home className="w-6 h-6 text-[var(--text-low)]" />
          </div>
          <p className="text-[var(--text-mid)]">{error || 'Vitrine não encontrada.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen app-bg">
      <div className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
      <div className="relative max-w-6xl mx-auto px-6 py-14">
        {/* Cabeçalho do corretor */}
        <header className="text-center mb-12">
          <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-violet-300/70 mb-3">Imóveis disponíveis</p>
          <h1 className="text-4xl md:text-5xl font-black text-[var(--text-hi)]">{data.broker.name}</h1>
          {data.broker.address && (
            <p className="text-[15px] text-[var(--text-low)] flex items-center justify-center gap-1.5 mt-3">
              <MapPin className="w-4 h-4" /> {data.broker.address}
            </p>
          )}
        </header>

        {data.properties.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[var(--text-low)]">Nenhum imóvel disponível no momento.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {data.properties.map((p) => (
              <a
                key={p.slug}
                href={`/p/${p.slug}`}
                className="group rounded-[26px] overflow-hidden backdrop-blur-2xl bg-[var(--control-fill)] border border-[var(--hairline)]
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_20px_50px_-24px_rgba(0,0,0,0.6)]
                  hover:bg-[var(--control-fill)] transition-colors"
              >
                <div className="h-52 bg-[var(--control-fill)] relative overflow-hidden">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[var(--text-low)]">
                      <Home className="w-10 h-10" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-[17px] font-bold text-[var(--text-hi)] truncate">{p.title}</h3>
                  {p.location && (
                    <p className="text-[13px] text-[var(--text-low)] flex items-center gap-1 mt-1 truncate">
                      <MapPin className="w-3.5 h-3.5 shrink-0" /> {p.location}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-[19px] font-black text-[var(--text-hi)]">{p.price}</p>
                    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-violet-300 group-hover:gap-2 transition-all">
                      Ver <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        <div className="mt-16 text-center">
          <Copyright />
        </div>
      </div>
    </div>
  );
}
