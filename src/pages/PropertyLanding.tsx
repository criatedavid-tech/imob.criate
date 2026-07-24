import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  MapPin, Calendar, X, Mail, User, Phone, Loader2,
  BedDouble, Bath, Maximize2, Car, CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Copyright from '../components/Copyright';

// ── Reveal ────────────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 34 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } },
};

// ── Template helpers (puros) ────────────────────────────────────────────────
// A landing é um TEMPLATE: cada imóvel entra como variáveis. Estes helpers
// adaptam a MESMA página a qualquer conteúdo, sem inventar dado e sem repetir
// as specs ao longo das seções de foto.

const titleCase = (s: string) =>
  s.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

// Distribui a descrição (curta ou longa) em blocos, um por foto — é o que dá
// o ar "orgânico", como se alguém tivesse escrito a página em capítulos. Curta
// vira 1 bloco; longa, vários (teto de 4 pra não picotar demais).
function splitIntoChunks(text: string): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  const kept = sentences.map((s) => s.trim()).filter((s) => s.length > 12);
  if (kept.length === 0) return [clean];
  const maxChunks = Math.min(4, kept.length);
  const perChunk = Math.ceil(kept.length / maxChunks);
  const chunks: string[] = [];
  for (let i = 0; i < kept.length; i += perChunk) {
    chunks.push(kept.slice(i, i + perChunk).join(' '));
  }
  return chunks;
}

// Rótulo curto de cada bloco, derivado das PRÓPRIAS palavras do texto (nunca
// inventado). Sem match, cai num rótulo neutro pela posição.
function deriveKicker(text: string, index: number): string {
  const t = text.toLowerCase();
  const map: [string, string][] = [
    ['piscina', 'Área de lazer'], ['lazer', 'Lazer & bem-estar'], ['gourmet', 'Espaço gourmet'],
    ['churrasq', 'Espaço gourmet'], ['segur', 'Segurança'], ['vista', 'Vista'],
    ['suíte', 'Suítes'], ['suite', 'Suítes'], ['cozinha', 'Cozinha'], ['varanda', 'Varanda'],
    ['jardim', 'Área externa'], ['quintal', 'Área externa'], ['condom', 'Condomínio'],
    ['acabamento', 'Acabamento'], ['planejado', 'Ambientes planejados'], ['iluminaç', 'Iluminação'],
    ['espaço', 'Espaço & conforto'], ['conforto', 'Espaço & conforto'], ['localiz', 'Localização'],
    ['reform', 'Reformado'], ['moderna', 'Design'], ['moderno', 'Design'],
  ];
  for (const [k, label] of map) if (t.includes(k)) return label;
  return ['O imóvel', 'Ambientes', 'Diferenciais', 'Detalhes'][index % 4];
}

export default function PropertyLanding() {
  const { slug } = useParams();
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleStep, setScheduleStep] = useState<'form' | 'success'>('form');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleData, setScheduleData] = useState({ name: '', phone: '', email: '', preferredTime: '' });

  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactStep, setContactStep] = useState<'form' | 'success'>('form');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', phone: '', email: '', message: '' });

  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        const response = await fetch(`/api/properties/${slug}`);
        if (response.ok) setProperty(await response.json());
      } catch (error) {
        console.error('Erro ao buscar imóvel:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchProperty();
  }, [slug]);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleOpenSchedule = () => { setIsScheduleModalOpen(true); setScheduleStep('form'); };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleLoading(true);
    try {
      const formattedPreferred = scheduleData.preferredTime
        ? new Date(scheduleData.preferredTime).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })
        : '';
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          name: scheduleData.name, phone: scheduleData.phone, email: scheduleData.email,
          status: 'visita',
          notes: formattedPreferred
            ? `Visita solicitada — preferência: ${formattedPreferred}`
            : 'Visita solicitada via landing page',
        }),
      });
      if (response.ok) setScheduleStep('success');
    } catch (e) { console.error(e); }
    finally { setScheduleLoading(false); }
  };

  const minDateTime = (() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  })();

  const handleWhatsApp = () => {
    const phone = property.brokers?.phone || '5500000000000';
    const text = `Olá, tenho interesse no imóvel: ${property.title} — ${property.location}`;
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactLoading(true);
    try {
      await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          name: contactForm.name, phone: contactForm.phone, email: contactForm.email,
          status: 'contato', notes: contactForm.message,
        }),
      });
    } catch (err) {
      console.error('Erro ao salvar contato:', err);
    } finally {
      setContactLoading(false);
      setContactStep('success');
      setContactForm({ name: '', phone: '', email: '', message: '' });
    }
  };

  // ── Loading / not found ────────────────────────────────────────────────────
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-[#ecebe6]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-[#83847e]" size={30} />
        <p className="text-[11px] text-[#83847e] tracking-[0.3em] uppercase">Carregando</p>
      </div>
    </div>
  );
  if (!property) return (
    <div className="h-screen flex items-center justify-center bg-[#ecebe6]">
      <p className="text-[#3b3e41] font-medium">Imóvel não encontrado.</p>
    </div>
  );

  // ── Dados ──────────────────────────────────────────────────────────────────
  let extraData: any =
    property.details && Object.keys(property.details).length > 0 ? property.details : {};
  let cleanDescription = property.description;
  if (property.description?.includes('---DETALHES-GERADOS---')) {
    const parts = property.description.split('---DETALHES-GERADOS---');
    cleanDescription = parts[0].trim();
    if (Object.keys(extraData).length === 0) {
      try { extraData = JSON.parse(parts[1].trim()); } catch { /* bloco antigo malformado */ }
    }
  }

  const allImages: string[] = property.images?.length > 0
    ? property.images
    : (property.imageUrl ? [property.imageUrl] : []);
  const heroImg = allImages[0] || '';

  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const d = {
    title: property.title || 'Imóvel',
    location: property.location || '',
    price: property.price || '',
    description: cleanDescription || '',
    bedrooms: num(extraData.quartos ?? property.bedrooms),
    bathrooms: num(extraData.banheiros ?? property.bathrooms),
    area: num(extraData.area ?? property.area),
    garages: num(extraData.vagas_garagem),
    livingRooms: num(extraData.sala),
    kitchens: num(extraData.cozinha),
    pool: String(extraData.piscina || '').toLowerCase() === 'sim',
    gourmet: String(extraData.varanda_gourmet || '').toLowerCase() === 'sim',
  };

  const rawType = String(extraData.tipo_imovel || '').toLowerCase();
  const typeLabel = rawType === 'residencial' ? 'Residencial'
    : rawType === 'comercial' ? 'Comercial'
    : extraData.tipo_imovel ? titleCase(String(extraData.tipo_imovel)) : '';
  const rawFin = String(extraData.finalidade || '').toLowerCase();
  const finalidadeLabel = rawFin === 'venda' ? 'À venda'
    : ['aluguel', 'locacao', 'locação'].includes(rawFin) ? 'Para alugar'
    : extraData.finalidade ? titleCase(String(extraData.finalidade)) : '';

  // Identidade no hero (só glance). As contagens vão pra faixa; os secundários
  // pra ficha. Cada dado aparece uma vez por seção — sem specs picotadas nas fotos.
  const heroBadges = [typeLabel, finalidadeLabel].filter(Boolean) as string[];

  const highlightSpecs = [
    d.bedrooms > 0 && { Icon: BedDouble, value: String(d.bedrooms), label: d.bedrooms === 1 ? 'Quarto' : 'Quartos' },
    d.bathrooms > 0 && { Icon: Bath, value: String(d.bathrooms), label: d.bathrooms === 1 ? 'Banheiro' : 'Banheiros' },
    d.area > 0 && { Icon: Maximize2, value: String(d.area), unit: 'm²', label: 'Área' },
    d.garages > 0 && { Icon: Car, value: String(d.garages), label: d.garages === 1 ? 'Vaga' : 'Vagas' },
  ].filter(Boolean) as { Icon: any; value: string; unit?: string; label: string }[];

  const fichaItems = [
    typeLabel && { label: 'Tipo', value: typeLabel },
    finalidadeLabel && { label: 'Finalidade', value: finalidadeLabel },
    d.livingRooms > 0 && { label: d.livingRooms === 1 ? 'Sala' : 'Salas', value: String(d.livingRooms) },
    d.kitchens > 0 && { label: 'Cozinha', value: String(d.kitchens) },
    d.pool && { label: 'Piscina', value: 'Sim' },
    d.gourmet && { label: 'Varanda gourmet', value: 'Sim' },
    d.price && { label: 'Valor', value: d.price },
  ].filter(Boolean) as { label: string; value: string }[];

  // Blocos editoriais: um por trecho da descrição real, com foto ao lado.
  const chunks = splitIntoChunks(d.description);
  const spreads = chunks.map((text, i) => ({
    text,
    kicker: deriveKicker(text, i),
    img: allImages.length ? allImages[(i + 1) % allImages.length] : '',
  }));
  const usedImgs = new Set([heroImg, ...spreads.map((s) => s.img)]);
  const galleryImgs = allImages.filter((img, i) => i !== 0 && !usedImgs.has(img));

  const brokerName = property.brokers?.name || 'Corretor';
  let brokerTitle = 'Corretor responsável';
  let brokerPhoto = '';
  let brokerBio1 = 'Atendimento próximo e transparente em cada etapa da negociação.';
  let brokerBio2 = 'Conte comigo para tirar dúvidas, agendar uma visita e conduzir a compra com segurança.';
  let brokerQuote = '';
  if (property.brokers?.broker_address) {
    try {
      const ep = JSON.parse(property.brokers.broker_address);
      if (ep.title) brokerTitle = ep.title;
      if (ep.photoUrl?.trim()) brokerPhoto = ep.photoUrl;
      if (ep.bio1) brokerBio1 = ep.bio1;
      if (ep.bio2) brokerBio2 = ep.bio2;
      if (ep.quote) brokerQuote = ep.quote.startsWith('"') ? ep.quote : `"${ep.quote}"`;
    } catch { /* perfil antigo malformado */ }
  }

  const mapsQuery = encodeURIComponent(d.location || d.title);
  const SERIF = "'Hoefler Text','Iowan Old Style',Palatino,'Palatino Linotype',Georgia,ui-serif,serif";

  // ── Botão-classe util ──
  const btnGhostLight = 'inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase border border-white/45 text-white hover:bg-white hover:text-[#16181a] transition-colors';
  const btnSolidLight = 'inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase bg-white/15 border border-white/35 text-white backdrop-blur-sm hover:bg-white hover:text-[#16181a] transition-colors';
  const btnPetrol = 'inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase bg-[#2b534e] text-white hover:bg-[#213f3b] transition-colors';
  const btnOnDark = 'inline-flex items-center gap-2 px-6 py-3 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase border border-white/25 text-[#eceae4] hover:bg-white hover:text-[#16181a] transition-colors';
  const btnOutline = 'inline-flex items-center gap-2 px-8 py-4 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase border border-[#16181a] text-[#16181a] hover:bg-[#16181a] hover:text-white transition-colors';

  return (
    <div className="bg-[#ecebe6] text-[#16181a] antialiased overflow-x-hidden" style={{ fontFamily: 'ui-sans-serif,-apple-system,"Helvetica Neue","Segoe UI",system-ui,sans-serif' }}>
      <style>{`.pl-serif{font-family:${SERIF};font-weight:300;letter-spacing:-.015em}.pl-tnum{font-variant-numeric:tabular-nums}.pl-eyebrow{font-size:.66rem;font-weight:600;letter-spacing:.3em;text-transform:uppercase}`}</style>

      {/* ── Nav ── */}
      <nav className={`fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 md:px-16 transition-all duration-500 ${navScrolled ? 'py-4 bg-[#ecebe6]/85 backdrop-blur-xl shadow-[0_1px_0_#d7d6cf]' : 'py-5'}`}>
        <span className="pl-serif text-lg tracking-[0.28em] uppercase truncate max-w-[55vw]" style={{ color: navScrolled ? '#16181a' : '#fff' }}>{brokerName}</span>
        <div className="flex items-center gap-2.5">
          <button onClick={handleOpenSchedule} className={`hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase transition-colors border ${navScrolled ? 'border-[#16181a] text-[#16181a] hover:bg-[#16181a] hover:text-white' : 'border-white/45 text-white hover:bg-white hover:text-[#16181a]'}`}>Agendar visita</button>
          <button onClick={handleWhatsApp} className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase transition-colors ${navScrolled ? 'bg-[#2b534e] text-white hover:bg-[#213f3b]' : 'bg-white/15 border border-white/35 text-white backdrop-blur-sm hover:bg-white hover:text-[#16181a]'}`}>WhatsApp</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header className="relative h-[100svh] min-h-[600px] overflow-hidden text-white">
        {heroImg
          ? <motion.img src={heroImg} alt={d.title} initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 6, ease: [0.22, 1, 0.36, 1] }} className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0 bg-gradient-to-br from-[#2b534e] to-[#131518]" />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(15,17,19,.42),rgba(15,17,19,.05) 34%,rgba(15,17,19,.8)),linear-gradient(90deg,rgba(15,17,19,.36),transparent 55%)' }} />
        <div className="absolute inset-x-0 bottom-0 px-5 md:px-16 pb-[clamp(40px,7vh,90px)]">
          <motion.div initial="hidden" animate="show" variants={fadeUp} className="max-w-[1240px] mx-auto">
            {d.location && (
              <div className="inline-flex items-center gap-2 text-[0.72rem] tracking-[0.26em] uppercase text-white/90">
                <MapPin size={13} className="opacity-85" /> {d.location}
              </div>
            )}
            <h1 className="pl-serif text-white my-4 md:my-5 max-w-[16ch]" style={{ fontSize: 'clamp(2.6rem,7vw,5.8rem)', lineHeight: 1.02, textWrap: 'balance' } as any}>{d.title}</h1>
            {heroBadges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {heroBadges.map((b) => (
                  <span key={b} className="text-[0.64rem] font-bold tracking-[0.16em] uppercase text-white border border-white/34 rounded-full px-3.5 py-1.5 backdrop-blur-sm">{b}</span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-5">
              {d.price && <span className="pl-serif pl-tnum text-white" style={{ fontSize: 'clamp(1.4rem,3vw,2rem)' }}>{d.price}</span>}
              <span className="hidden sm:block w-px h-7 bg-white/28" />
              <button onClick={handleOpenSchedule} className={btnSolidLight}>Agendar visita</button>
              <button onClick={handleWhatsApp} className={btnGhostLight}>WhatsApp</button>
            </div>
          </motion.div>
        </div>
      </header>

      {/* ── Faixa de specs (headline, uma vez) ── */}
      {highlightSpecs.length > 0 && (
        <section className="bg-[#f6f5f1] border-y border-[#d7d6cf]">
          <div className="max-w-[1240px] mx-auto flex flex-wrap justify-center gap-x-[clamp(28px,6vw,86px)] gap-y-8 px-6 py-9">
            {highlightSpecs.map((s) => (
              <div key={s.label} className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-xl bg-[#ecebe6] flex items-center justify-center text-[#2b534e] shrink-0">
                  <s.Icon size={19} strokeWidth={1.6} />
                </div>
                <div>
                  <div className="pl-serif pl-tnum leading-none" style={{ fontSize: '1.5rem' }}>{s.value}{s.unit && <span className="text-[0.9rem]"> {s.unit}</span>}</div>
                  <div className="pl-eyebrow text-[#83847e] mt-1" style={{ fontSize: '.6rem' }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Blocos editoriais (um por trecho da descrição) ── */}
      {spreads.map((s, i) => (
        <section key={i} className={`grid grid-cols-1 md:grid-cols-2 ${i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}`}>
          <div className="relative min-h-[62vw] md:min-h-[clamp(360px,72vh,720px)] overflow-hidden bg-[#d7d6cf] group">
            {s.img && <img src={s.img} alt={`${d.title} — ${s.kicker}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1400ms] ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.04]" />}
          </div>
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-10%' }}
            className={`flex flex-col justify-center gap-5 px-[clamp(26px,5vw,86px)] py-[clamp(44px,7vw,100px)] ${i % 2 === 0 ? 'bg-[#f6f5f1]' : 'bg-[#ecebe6]'}`}>
            <div className="pl-eyebrow text-[#2b534e] flex items-center gap-3"><span className="w-6 h-px bg-current" />{s.kicker}</div>
            <p className="pl-serif text-[#16181a]" style={{ fontSize: 'clamp(1.5rem,2.6vw,2.15rem)', lineHeight: 1.4, fontWeight: 400, maxWidth: '30ch' }}>{s.text}</p>
          </motion.div>
        </section>
      ))}

      {/* ── Ficha técnica ── */}
      {fichaItems.length > 0 && (
        <section className="bg-[#131518] text-[#eceae4] py-[clamp(64px,9vw,118px)]">
          <div className="max-w-[1240px] mx-auto px-5 md:px-16">
            <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="max-w-[640px] mb-[clamp(34px,5vw,52px)]">
              <div className="pl-eyebrow text-[#9a9b95] flex items-center gap-3"><span className="w-6 h-px bg-current" />Ficha técnica</div>
              <h2 className="pl-serif text-white mt-4" style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Cada detalhe, em um só lugar</h2>
            </motion.div>
            <motion.dl variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
              className="grid gap-px rounded-2xl overflow-hidden border border-white/10 bg-white/10"
              style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>
              {fichaItems.map((f) => (
                <div key={f.label} className="bg-[#1b1e21] px-6 py-6">
                  <dt className="pl-eyebrow text-[#9a9b95]" style={{ fontSize: '.6rem' }}>{f.label}</dt>
                  <dd className="pl-serif pl-tnum text-white mt-2" style={{ fontSize: f.label === 'Valor' ? '1.25rem' : '1.5rem' }}>{f.value}</dd>
                </div>
              ))}
            </motion.dl>
          </div>
        </section>
      )}

      {/* ── Galeria ── */}
      {galleryImgs.length > 0 && (
        <section className="bg-[#f6f5f1] border-t border-[#d7d6cf] py-[clamp(64px,9vw,110px)]">
          <div className="max-w-[1240px] mx-auto px-5 md:px-16">
            <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="text-center mb-[clamp(30px,5vw,50px)]">
              <div className="pl-eyebrow text-[#83847e] flex items-center justify-center gap-3"><span className="w-6 h-px bg-current" />Galeria<span className="w-6 h-px bg-current" /></div>
              <h2 className="pl-serif mt-3" style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>Conheça cada ambiente</h2>
            </motion.div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3.5">
              {galleryImgs.map((img, i) => {
                // Ritmo de mosaico no desktop; no mobile todas caem em 4/3 (base).
                // Todas as variantes levam prefixo md: pra não brigar com a base.
                const span = [
                  'md:col-span-4 md:aspect-[16/10]',
                  'md:col-span-2 md:aspect-[3/4]',
                  'md:col-span-2 md:aspect-square',
                  'md:col-span-2 md:aspect-square',
                  'md:col-span-2 md:aspect-[3/4]',
                  'md:col-span-4 md:aspect-[16/10]',
                ][i % 6];
                return (
                  <motion.figure key={img + i} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-6%' }}
                    className={`overflow-hidden rounded-2xl bg-[#d7d6cf] group col-span-2 aspect-[4/3] ${span}`}>
                    <img src={img} alt={`${d.title} — ambiente ${i + 1}`} loading="lazy" className="w-full h-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-105" />
                  </motion.figure>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Corretor ── */}
      <section className="bg-[#131518] text-[#eceae4] py-[clamp(70px,10vw,126px)]">
        <div className="max-w-[1240px] mx-auto px-5 md:px-16 flex flex-wrap items-center gap-[clamp(34px,6vw,80px)]">
          <div className="w-[clamp(150px,20vw,230px)] aspect-[3/4] rounded-[28px] shrink-0 overflow-hidden border border-white/10 bg-gradient-to-br from-[#23272b] to-[#15181b] flex items-center justify-center">
            {brokerPhoto
              ? <img src={brokerPhoto} alt={brokerName} className="w-full h-full object-cover" />
              : <span className="pl-serif text-white/20 select-none" style={{ fontSize: 'clamp(4rem,9vw,7rem)' }}>{brokerName.charAt(0).toUpperCase()}</span>}
          </div>
          <motion.div variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="flex-1 min-w-[260px] flex flex-col gap-4">
            <div className="pl-eyebrow text-[#6f716b] flex items-center gap-3"><span className="w-6 h-px bg-current" />Seu corretor</div>
            <div>
              <h2 className="pl-serif text-white" style={{ fontSize: 'clamp(2.1rem,4vw,3.1rem)' }}>{brokerName}</h2>
              <div className="pl-eyebrow text-[#9a9b95] mt-2" style={{ fontSize: '.68rem' }}>{brokerTitle}</div>
            </div>
            <p className="text-[#9a9b95] leading-relaxed max-w-[52ch]">{brokerBio1} {brokerBio2}</p>
            {brokerQuote && <blockquote className="pl-serif text-white/90 border-l-2 border-white/20 pl-5 italic" style={{ fontSize: '1.15rem' }}>{brokerQuote}</blockquote>}
            <div className="flex flex-wrap gap-3 mt-2">
              <button onClick={handleWhatsApp} className={btnPetrol}>WhatsApp</button>
              <button onClick={handleOpenSchedule} className={btnOnDark}>Agendar visita</button>
              <button onClick={() => { setIsContactModalOpen(true); setContactStep('form'); }} className={btnOnDark}>Enviar mensagem</button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Localização (mapa com o endereço do imóvel) ── */}
      {d.location && (
        <section className="bg-[#ecebe6] py-[clamp(58px,8vw,104px)] px-5 md:px-16">
          <div className="max-w-[1240px] mx-auto">
            <motion.header variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }} className="mb-9 md:text-center">
              <div className="pl-eyebrow text-[#83847e] flex items-center md:justify-center gap-3"><span className="w-6 h-px bg-current" />Localização<span className="w-6 h-px bg-current" /></div>
              <h2 className="pl-serif mt-3" style={{ fontSize: 'clamp(2rem,4vw,3rem)' }}>{d.location}</h2>
            </motion.header>
            <motion.div initial={{ opacity: 0, y: 26 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 1 }}
              className="w-full h-[380px] md:h-[500px] rounded-[28px] overflow-hidden border border-[#d7d6cf] bg-[#d7d6cf] group">
              <iframe title="Localização do imóvel" src={`https://maps.google.com/maps?q=${mapsQuery}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                width="100%" height="100%" style={{ border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full grayscale-[18%] group-hover:grayscale-0 transition-all duration-700" />
            </motion.div>
            <div className="mt-8 flex justify-center">
              <a href={`https://www.google.com/maps/search/?api=1&query=${mapsQuery}`} target="_blank" rel="noopener noreferrer" className={btnOutline}>
                <MapPin size={13} /> Abrir no Google Maps
              </a>
            </div>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <footer className="bg-[#ecebe6] py-8 px-6 border-t border-[#d7d6cf]">
        <Copyright variant="light" />
      </footer>

      {/* ── WhatsApp flutuante ── */}
      <motion.button initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.2 }}
        onClick={handleWhatsApp} aria-label="Falar no WhatsApp"
        className="fixed bottom-6 right-6 z-[90] w-14 h-14 bg-[#25D366] rounded-full flex items-center justify-center text-white shadow-[0_10px_30px_rgba(37,211,102,0.4)] hover:-translate-y-1 hover:scale-105 transition-transform">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.878-.788-1.472-1.761-1.645-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" /></svg>
      </motion.button>

      {/* ── Modal: Agendar Visita ── */}
      <AnimatePresence>
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsScheduleModalOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 10 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-[#f6f5f1] w-full max-w-lg rounded-[28px] overflow-hidden shadow-2xl">
              <div className="p-8 md:p-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="pl-serif text-3xl mb-1">Agendar visita</h2>
                    <p className="text-[#6B6B6B] text-sm">Escolha o melhor horário para conhecer este imóvel.</p>
                  </div>
                  <button onClick={() => setIsScheduleModalOpen(false)} aria-label="Fechar" className="w-9 h-9 rounded-full hover:bg-[#e2e0d9] flex items-center justify-center transition-colors"><X size={18} className="text-[#6B6B6B]" /></button>
                </div>
                {scheduleStep === 'form' ? (
                  <form onSubmit={handleScheduleSubmit} className="space-y-4">
                    <div className="relative">
                      <User size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                      <input required type="text" placeholder="Nome completo" value={scheduleData.name} onChange={(e) => setScheduleData({ ...scheduleData, name: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] focus:border-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="relative">
                        <Phone size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="tel" placeholder="Telefone" value={scheduleData.phone} onChange={(e) => setScheduleData({ ...scheduleData, phone: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                      <div className="relative">
                        <Mail size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="email" placeholder="E-mail" value={scheduleData.email} onChange={(e) => setScheduleData({ ...scheduleData, email: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wide mb-1.5 ml-1">Horário de preferência (opcional)</label>
                      <div className="relative">
                        <Calendar size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF] pointer-events-none" />
                        <input type="datetime-local" min={minDateTime} value={scheduleData.preferredTime} onChange={(e) => setScheduleData({ ...scheduleData, preferredTime: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] focus:border-[#2b534e] outline-none transition-all text-[#16181a] [&:invalid]:text-[#9CA3AF]" />
                      </div>
                    </div>
                    <button disabled={scheduleLoading} className="w-full bg-[#2b534e] text-white py-4 rounded-2xl text-[11px] font-bold tracking-[0.18em] uppercase hover:bg-[#213f3b] transition-colors flex items-center justify-center gap-3 disabled:opacity-50 mt-2">
                      {scheduleLoading ? <Loader2 className="animate-spin" size={16} /> : 'Confirmar visita'}
                    </button>
                    <button type="button" onClick={handleWhatsApp} className="w-full text-[#6B6B6B] text-[11px] font-bold tracking-[0.18em] uppercase hover:text-[#16181a] transition-colors pt-1">Prefiro combinar por WhatsApp</button>
                  </form>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-[#2b534e]/10 text-[#2b534e] rounded-[20px] flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={28} /></div>
                    <h3 className="pl-serif text-3xl mb-3">Solicitação enviada</h3>
                    <p className="text-[#6B6B6B] mb-8 px-4">Recebemos sua solicitação. O corretor responsável entrará em contato em breve.</p>
                    <button onClick={() => setIsScheduleModalOpen(false)} className="w-full bg-[#16181a] text-white py-4 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase hover:bg-[#2b534e] transition-colors">Entendido</button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Contato ── */}
      <AnimatePresence>
        {isContactModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsContactModalOpen(false)} />
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-[#f6f5f1] w-full max-w-lg rounded-[28px] overflow-hidden shadow-2xl">
              <div className="p-8 md:p-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="pl-serif text-3xl mb-1">Entre em contato</h2>
                    <p className="text-[#6B6B6B] text-sm">Envie uma mensagem e responderemos em breve.</p>
                  </div>
                  <button onClick={() => setIsContactModalOpen(false)} aria-label="Fechar" className="w-9 h-9 rounded-full hover:bg-[#e2e0d9] flex items-center justify-center transition-colors"><X size={18} className="text-[#6B6B6B]" /></button>
                </div>
                {contactStep === 'form' ? (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <div className="relative">
                      <User size={16} className="absolute left-5 top-[22px] -translate-y-1/2 text-[#9CA3AF]" />
                      <input required type="text" placeholder="Nome completo" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="relative">
                        <Phone size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="tel" placeholder="Telefone" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                      <div className="relative">
                        <Mail size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="email" placeholder="E-mail" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                    </div>
                    <div className="relative">
                      <textarea required rows={4} placeholder="Sua mensagem" value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} className="w-full px-5 py-4 bg-white border border-[#e2e0d9] rounded-2xl text-sm focus:ring-1 focus:ring-[#2b534e] outline-none transition-all placeholder:text-[#9CA3AF] resize-none" />
                    </div>
                    <button disabled={contactLoading} className="w-full bg-[#2b534e] text-white py-4 rounded-2xl text-[11px] font-bold tracking-[0.18em] uppercase hover:bg-[#213f3b] transition-colors flex items-center justify-center gap-3 disabled:opacity-50 mt-2">
                      {contactLoading ? <Loader2 className="animate-spin" size={16} /> : 'Enviar mensagem'}
                    </button>
                  </form>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-[#2b534e]/10 text-[#2b534e] rounded-[20px] flex items-center justify-center mx-auto mb-6"><CheckCircle2 size={28} /></div>
                    <h3 className="pl-serif text-3xl mb-3">Mensagem enviada</h3>
                    <p className="text-[#6B6B6B] mb-8 px-4">Obrigado pelo contato. Um corretor retornará em breve.</p>
                    <button onClick={() => { setIsContactModalOpen(false); setTimeout(() => setContactStep('form'), 300); }} className="w-full bg-[#16181a] text-white py-4 rounded-full text-[11px] font-bold tracking-[0.18em] uppercase hover:bg-[#2b534e] transition-colors">Fechar</button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
