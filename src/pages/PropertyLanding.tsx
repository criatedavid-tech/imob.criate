import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  MapPin, CheckCircle2, Calendar, MessageCircle,
  ArrowRight, X, Mail, User, Phone,
  Loader2, ChevronDown, BedDouble, Bath, Maximize2,
  Sofa, UtensilsCrossed, Waves
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Copyright from '../components/Copyright';

// ── Animation variants ──────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 48 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } }
};
const fadeIn = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.8 } }
};

export default function PropertyLanding() {
  const { slug } = useParams();
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [scheduleStep, setScheduleStep] = useState<'form' | 'success'>('form');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleData, setScheduleData] = useState({ name: '', phone: '', email: '', preferredTime: '' });

  const [isPhilosophyModalOpen, setIsPhilosophyModalOpen] = useState(false);
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
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          name: scheduleData.name, phone: scheduleData.phone, email: scheduleData.email,
          status: 'visita_agendada',
          notes: scheduleData.preferredTime
            ? `Visita solicitada — horário de preferência: ${scheduleData.preferredTime}`
            : 'Visita solicitada via landing page'
        })
      });
      if (response.ok) setScheduleStep('success');
    } catch (e) { console.error(e); }
    finally { setScheduleLoading(false); }
  };

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
          name: contactForm.name,
          phone: contactForm.phone,
          email: contactForm.email,
          status: 'contato',
          notes: contactForm.message
        })
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
    <div className="h-screen flex items-center justify-center bg-[#FAFAFA]">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-[#9CA3AF]" size={32} />
        <p className="text-sm text-[#9CA3AF] tracking-widest uppercase">Carregando</p>
      </motion.div>
    </div>
  );
  if (!property) return (
    <div className="h-screen flex items-center justify-center bg-[#FAFAFA]">
      <p className="text-[#6B7280] font-medium">Imóvel não encontrado.</p>
    </div>
  );

  // ── Data processing ────────────────────────────────────────────────────────
  let extraData: any = {};
  let cleanDescription = property.description;
  if (property.description?.includes('---DETALHES-GERADOS---')) {
    const parts = property.description.split('---DETALHES-GERADOS---');
    cleanDescription = parts[0].trim();
    try { extraData = JSON.parse(parts[1].trim()); } catch { }
  }

  const mainImage = property.images?.length > 0
    ? property.images[0]
    : (property.imageUrl || 'https://picsum.photos/seed/luxuryhome/1200/800');
  const allImages: string[] = property.images?.length > 0
    ? property.images
    : [mainImage];

  const displayData = {
    title: property.title,
    location: property.location,
    price: property.price,
    description: cleanDescription,
    bedrooms: extraData.quartos ?? property.bedrooms ?? 0,
    bathrooms: extraData.banheiros ?? property.bathrooms ?? 0,
    area: extraData.area ?? property.area ?? 0,
    livingRooms: extraData.sala ?? 0,
    kitchens: extraData.cozinha ?? 0,
    pool: extraData.piscina || 'Não',
    gourmet: extraData.varanda_gourmet || 'Não',
  };

  let brokerProfile = {
    name: property.brokers?.name || 'Corretor',
    title: 'Principal Broker',
    photoUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80',
    bio1: 'Para quem busca excelência no mercado imobiliário.',
    bio2: 'Com experiência e dedicação, garantimos a melhor experiência na compra ou venda do seu imóvel.',
    quote: ''
  };
  if (property.brokers?.broker_address) {
    try {
      const ep = JSON.parse(property.brokers.broker_address);
      if (ep.title) brokerProfile.title = ep.title;
      if (ep.photoUrl?.trim()) brokerProfile.photoUrl = ep.photoUrl;
      if (ep.bio1) brokerProfile.bio1 = ep.bio1;
      if (ep.bio2) brokerProfile.bio2 = ep.bio2;
      if (ep.quote) brokerProfile.quote = ep.quote.startsWith('"') ? ep.quote : `"${ep.quote}"`;
    } catch { }
  }

  // ── Featured photo+text sections (up to 5) ────────────────────────────────
  const featuredImages = allImages.slice(0, 5);
  const galleryImages = allImages.slice(5);

  const descParagraphs = (cleanDescription || '')
    .split(/\n\n+|\n(?=[A-ZÀ-Ú])/)
    .map(s => s.trim())
    .filter(s => s.length > 30);

  const sectionMeta = [
    { tag: 'Sobre o Imóvel', heading: displayData.title },
    { tag: 'Detalhes', heading: 'Requinte em cada detalhe' },
    { tag: 'Diferenciais', heading: 'Um estilo de vida único' },
    { tag: 'Experiência', heading: 'Conforto absoluto' },
    { tag: 'Exclusividade', heading: 'Sua residência ideal' },
  ];

  const specs = [
    { icon: <BedDouble size={18} />, value: displayData.bedrooms, label: 'Quartos', show: displayData.bedrooms > 0 },
    { icon: <Bath size={18} />, value: displayData.bathrooms, label: 'Banheiros', show: displayData.bathrooms > 0 },
    { icon: <Maximize2 size={18} />, value: displayData.area > 0 ? `${displayData.area}m²` : null, label: 'Área Total', show: displayData.area > 0 },
    { icon: <Sofa size={18} />, value: displayData.livingRooms || null, label: 'Salas', show: displayData.livingRooms > 0 },
    { icon: <UtensilsCrossed size={18} />, value: displayData.kitchens || null, label: 'Cozinhas', show: displayData.kitchens > 0 },
    {
      icon: <Waves size={18} />,
      value: (displayData.pool !== 'Sim' && displayData.pool !== 'Não' && displayData.pool !== 'Não informado') ? displayData.pool : null,
      label: displayData.pool === 'Privativa' ? 'Piscina Privativa' : displayData.pool === 'Compartilhada' ? 'Piscina Compartilhada' : 'Piscina',
      show: displayData.pool !== 'Não' && displayData.pool !== 'Não informado'
    },
  ].filter(s => s.show);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#FAFAFA] font-sans text-[#1a1a1a] selection:bg-black selection:text-white overflow-x-hidden">

      {/* ── Fixed Nav ── */}
      <motion.nav
        className={`fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 py-5 transition-all duration-500 ${navScrolled ? 'bg-white/90 backdrop-blur-xl shadow-[0_1px_0_rgba(0,0,0,0.06)]' : 'bg-transparent'}`}
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.8 }}
      >
        <span className={`font-serif text-lg tracking-widest uppercase transition-colors duration-500 ${navScrolled ? 'text-[#1a1a1a]' : 'text-white'}`}>
          Criate
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenSchedule}
            className={`hidden md:flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] font-semibold tracking-widest uppercase border transition-all duration-300 ${navScrolled ? 'border-[#1a1a1a] text-[#1a1a1a] hover:bg-black hover:text-white' : 'border-white/50 text-white hover:bg-white hover:text-black'}`}
          >
            <Calendar size={13} /> Agendar Visita
          </button>
          <button
            onClick={handleWhatsApp}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-[10px] font-semibold tracking-widest uppercase transition-all duration-300 ${navScrolled ? 'bg-black text-white hover:bg-[#333]' : 'bg-white/15 backdrop-blur-sm border border-white/30 text-white hover:bg-white hover:text-black'}`}
          >
            <MessageCircle size={13} /> WhatsApp
          </button>
        </div>
      </motion.nav>

      {/* ── Hero ── */}
      <section className="relative h-screen overflow-hidden">
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <img src={mainImage} alt={displayData.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        </motion.div>
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-black/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />

        {/* Content */}
        <div className="relative h-full flex flex-col justify-end px-8 md:px-16 lg:px-24 pb-20 md:pb-28">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="flex items-center gap-2 mb-5"
          >
            <div className="w-6 h-[1px] bg-white/60" />
            <MapPin size={13} className="text-white/70" />
            <span className="text-white/70 text-[11px] tracking-[0.25em] uppercase">{displayData.location}</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
            className="font-serif text-5xl md:text-7xl lg:text-[5.5rem] font-light text-white leading-[0.92] tracking-tight mb-8 max-w-3xl"
          >
            {displayData.title}
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.9 }}
            className="flex flex-col sm:flex-row items-start sm:items-center gap-5"
          >
            <span className="text-white/90 text-2xl md:text-3xl font-light tracking-tight">
              {displayData.price}
            </span>
            <div className="hidden sm:block w-px h-7 bg-white/25" />
            <div className="flex items-center gap-3">
              <button
                onClick={handleWhatsApp}
                className="group flex items-center gap-3 h-13 px-7 py-3.5 bg-white text-black rounded-full text-xs font-bold tracking-widest uppercase hover:bg-white/90 transition-all duration-300"
              >
                Explorar Imóvel
                <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform duration-300" />
              </button>
              <button
                onClick={handleOpenSchedule}
                className="group flex items-center gap-2 h-13 px-7 py-3.5 border border-white/35 text-white rounded-full text-xs font-bold tracking-widest uppercase backdrop-blur-sm hover:bg-white hover:text-black transition-all duration-300"
              >
                <Calendar size={14} /> Agendar
              </button>
            </div>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }}
          className="absolute bottom-8 right-10 flex flex-col items-center gap-3 text-white/50"
        >
          <motion.div animate={{ y: [0, 7, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
            <ChevronDown size={18} />
          </motion.div>
          <span className="text-[9px] tracking-[0.35em] uppercase rotate-90 origin-center translate-y-3">Scroll</span>
        </motion.div>
      </section>

      {/* ── Specs Strip ── */}
      {specs.length > 0 && (
        <section className="bg-white border-y border-[#E8E4E0] py-7 px-6 md:px-16 overflow-hidden">
          <div className="max-w-5xl mx-auto flex flex-wrap justify-center gap-x-12 gap-y-5">
            {specs.map((spec, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 } as any}
                className="flex items-center gap-3"
              >
                <div className="w-9 h-9 bg-[#F5F2EF] rounded-xl flex items-center justify-center text-[#6B6B6B]">
                  {spec.icon}
                </div>
                <div className="flex flex-col">
                  {spec.value != null && (
                    <span className="font-serif text-xl leading-tight">{spec.value}</span>
                  )}
                  <span className={`uppercase tracking-widest text-[#9CA3AF] ${spec.value != null ? 'text-[9px]' : 'text-[11px] font-semibold'}`}>{spec.label}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ── Featured Photo + Text Sections ── */}
      {featuredImages.map((img, i) => {
        const isReverse = i % 2 !== 0;
        const meta = sectionMeta[i];
        const text = descParagraphs[i] || descParagraphs[0] || cleanDescription || '';
        const sectionBg = i % 2 === 0 ? 'bg-[#F5F2EF]' : 'bg-white';

        return (
          <section key={i} className={`${sectionBg} overflow-hidden`}>
            <div className={`flex flex-col ${isReverse ? 'md:flex-row-reverse' : 'md:flex-row'}`} style={{ minHeight: '90vh' }}>

              {/* Photo */}
              <motion.div
                className="relative w-full md:w-[58%] overflow-hidden"
                style={{ minHeight: '55vw', maxHeight: '95vh' }}
                initial={{ opacity: 0, x: isReverse ? 80 : -80 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <img
                  src={img}
                  alt={`${displayData.title} — ${i + 1}`}
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                {/* Section number badge */}
                <div className="absolute top-6 left-6 w-10 h-10 bg-white/10 backdrop-blur-md border border-white/25 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  {String(i + 1).padStart(2, '0')}
                </div>
              </motion.div>

              {/* Text content */}
              <div className="w-full md:w-[42%] flex flex-col justify-center px-8 md:px-12 lg:px-16 xl:px-20 py-16 md:py-24">
                <motion.div
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: '-60px' }}
                  transition={{ staggerChildren: 0.12 } as any}
                  className="space-y-6"
                >
                  <motion.p variants={fadeUp} className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#9CA3AF] flex items-center gap-3">
                    <span className="w-8 h-px bg-[#9CA3AF] inline-block" />{meta.tag}
                  </motion.p>

                  <motion.h2 variants={fadeUp} className="font-serif text-3xl md:text-4xl lg:text-[2.75rem] font-light leading-[1.1] text-[#1a1a1a]">
                    {meta.heading}
                  </motion.h2>

                  {text && (
                    <motion.p variants={fadeUp} className="text-[#6B6B6B] leading-[1.8] font-light text-[15px] md:text-base">
                      {text.length > 280 ? text.slice(0, 280) + '…' : text}
                    </motion.p>
                  )}

                  {/* Section 0: feature tags */}
                  {i === 0 && (
                    <motion.div variants={fadeUp} className="flex flex-wrap gap-2 pt-1">
                      {[
                        displayData.bedrooms > 0 && `${displayData.bedrooms} Quartos`,
                        displayData.bathrooms > 0 && `${displayData.bathrooms} Banheiros`,
                        displayData.area > 0 && `${displayData.area} m²`,
                        displayData.gourmet === 'Sim' && 'Varanda Gourmet',
                        displayData.pool !== 'Não' && displayData.pool !== 'Não informado' && 'Piscina',
                      ].filter(Boolean).map((tag: any, ti) => (
                        <span key={ti} className="px-3 py-1.5 bg-[#E8E4E0] rounded-full text-[9px] font-bold uppercase tracking-widest text-[#1a1a1a]">
                          {tag}
                        </span>
                      ))}
                    </motion.div>
                  )}

                  {/* Section 1: mini stats grid */}
                  {i === 1 && specs.length > 0 && (
                    <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3 pt-1">
                      {specs.slice(0, 4).map((spec, si) => (
                        <div key={si} className={`rounded-2xl p-4 flex items-center gap-3 ${i % 2 === 0 ? 'bg-white' : 'bg-[#F5F2EF]'}`}>
                          <div className="text-[#9CA3AF]">{spec.icon}</div>
                          <div>
                            <p className="font-serif text-xl leading-none">{spec.value}</p>
                            <p className="text-[9px] uppercase tracking-wider text-[#9CA3AF] mt-1">{spec.label}</p>
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}

                  {/* Sections 2+: CTA links */}
                  {i >= 2 && (
                    <motion.div variants={fadeUp} className="flex flex-col sm:flex-row gap-4 pt-2">
                      <button
                        onClick={handleWhatsApp}
                        className="group inline-flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-[#1a1a1a] hover:gap-5 transition-all duration-300"
                      >
                        Falar com Corretor
                        <ArrowRight size={15} className="group-hover:translate-x-1 transition-transform" />
                      </button>
                      <button
                        onClick={handleOpenSchedule}
                        className="group inline-flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-[#9CA3AF] hover:text-[#1a1a1a] hover:gap-5 transition-all duration-300"
                      >
                        Agendar Visita
                        <Calendar size={14} className="transition-transform" />
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              </div>
            </div>
          </section>
        );
      })}

      {/* ── Gallery grid (remaining photos) ── */}
      {(galleryImages.length > 0 || allImages.length > 0) && (
        <section className="bg-[#F5F2EF] py-20 px-6 md:px-16 border-t border-[#E8E4E0]">
          <div className="max-w-[1400px] mx-auto">
            <motion.header
              variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
              className="mb-12 md:text-center"
            >
              <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#9CA3AF] mb-3 flex items-center md:justify-center gap-3">
                <span className="w-6 h-px bg-[#9CA3AF]" />Galeria<span className="w-6 h-px bg-[#9CA3AF]" />
              </p>
              <h2 className="font-serif text-4xl md:text-5xl font-light tracking-tight text-[#1a1a1a]">Todas as Fotos</h2>
            </motion.header>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
              {(galleryImages.length > 0 ? galleryImages : allImages).map((img, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, scale: 0.96 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.7, delay: (idx % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className={`overflow-hidden rounded-2xl bg-[#E8E4E0] group ${idx === 0 ? 'col-span-2 aspect-video' : 'aspect-[4/3]'}`}
                >
                  <img
                    src={img}
                    alt={`Foto ${idx + 1}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    referrerPolicy="no-referrer"
                  />
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Broker Section ── */}
      <section className="bg-[#111] py-24 md:py-32 px-6 md:px-16 overflow-hidden">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row gap-12 lg:gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              className="w-full md:w-64 lg:w-72 shrink-0"
            >
              <div className="aspect-[3/4] rounded-[40px] overflow-hidden">
                <img src={brokerProfile.photoUrl} alt={brokerProfile.name} className="w-full h-full object-cover" />
              </div>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="show" viewport={{ once: true }}
              transition={{ staggerChildren: 0.1, delayChildren: 0.2 } as any}
              className="flex-1 space-y-6"
            >
              <motion.p variants={fadeUp} className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#555] flex items-center gap-3">
                <span className="w-6 h-px bg-[#555]" />Seu Corretor
              </motion.p>
              <motion.div variants={fadeUp}>
                <h2 className="font-serif text-4xl md:text-5xl font-light text-white leading-tight">{brokerProfile.name}</h2>
                <p className="text-[#888] text-xs tracking-widest uppercase mt-2">{brokerProfile.title}</p>
              </motion.div>

              {brokerProfile.quote && (
                <motion.blockquote variants={fadeUp} className="border-l-2 border-white/15 pl-6 text-white/60 font-light italic text-base leading-relaxed">
                  {brokerProfile.quote}
                </motion.blockquote>
              )}


              <motion.div variants={fadeUp} className="flex flex-wrap gap-3 pt-2">
                <button
                  onClick={handleWhatsApp}
                  className="flex items-center gap-2 px-7 py-3.5 bg-white text-black rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-white/90 transition-all"
                >
                  <MessageCircle size={14} /> WhatsApp
                </button>
                <button
                  onClick={() => setIsPhilosophyModalOpen(true)}
                  className="flex items-center gap-2 px-7 py-3.5 border border-white/20 text-white rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all"
                >
                  Saiba Mais
                </button>
                <button
                  onClick={handleOpenSchedule}
                  className="flex items-center gap-2 px-7 py-3.5 border border-white/20 text-white rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all"
                >
                  <Calendar size={14} /> Agendar Visita
                </button>
                <button
                  onClick={() => setIsContactModalOpen(true)}
                  className="flex items-center gap-2 px-7 py-3.5 border border-white/20 text-white rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-white/10 transition-all"
                >
                  <Mail size={14} /> Enviar Mensagem
                </button>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── Map ── */}
      <section className="bg-[#FAFAFA] py-20 px-6 md:px-16 border-t border-[#E8E4E0]">
        <div className="max-w-[1400px] mx-auto">
          <motion.header
            variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true }}
            className="mb-10 md:text-center"
          >
            <p className="text-[10px] font-bold tracking-[0.3em] uppercase text-[#9CA3AF] mb-3 flex items-center md:justify-center gap-3">
              <span className="w-6 h-px bg-[#9CA3AF]" />Localização<span className="w-6 h-px bg-[#9CA3AF]" />
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-light tracking-tight text-[#1a1a1a]">{displayData.location}</h2>
          </motion.header>

          <motion.div
            initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
            transition={{ duration: 1 }}
            className="w-full h-[400px] md:h-[500px] rounded-[32px] overflow-hidden shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] bg-[#E8E4E0] group"
          >
            <iframe
              title="Localização"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(displayData.location)}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
              width="100%" height="100%"
              style={{ border: 0 }} allowFullScreen={false} loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="w-full h-full grayscale-[15%] group-hover:grayscale-0 transition-all duration-700"
            />
          </motion.div>

          <div className="mt-8 flex justify-center">
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayData.location)}`}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-10 py-4 border border-[#1a1a1a] rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-black hover:text-white transition-all duration-300"
            >
              <MapPin size={13} /> Ver no Mapa
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-[#FAFAFA] py-8 px-6 border-t border-[#E8E4E0]">
        <Copyright variant="light" />
      </footer>

      {/* ── Fixed WhatsApp ── */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.5 }}
        onClick={handleWhatsApp}
        className="fixed bottom-7 right-7 z-[90] w-14 h-14 bg-[#25D366] rounded-full flex items-center justify-center text-white shadow-[0_8px_30px_rgba(37,211,102,0.4)] hover:scale-110 hover:-translate-y-1 transition-all duration-300 group"
        aria-label="WhatsApp"
      >
        <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" className="group-hover:scale-110 transition-transform">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.878-.788-1.472-1.761-1.645-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      </motion.button>

      {/* ── Modal: Agendar Visita ── */}
      <AnimatePresence>
        {isScheduleModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setIsScheduleModalOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 10 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-[#FAFAFA] w-full max-w-lg rounded-[32px] overflow-hidden shadow-2xl"
            >
              <div className="p-8 md:p-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="font-serif text-3xl font-light tracking-tight mb-1">Agendar Visita</h2>
                    <p className="text-[#6B6B6B] text-sm">Escolha o melhor horário para conhecer este imóvel.</p>
                  </div>
                  <button onClick={() => setIsScheduleModalOpen(false)} className="w-9 h-9 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all">
                    <X size={18} className="text-[#6B6B6B]" />
                  </button>
                </div>

                {scheduleStep === 'form' && (
                  <form onSubmit={handleScheduleSubmit} className="space-y-4">
                    <div className="relative">
                      <User size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                      <input required type="text" placeholder="Nome Completo" value={scheduleData.name} onChange={e => setScheduleData({ ...scheduleData, name: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <Phone size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="tel" placeholder="Telefone" value={scheduleData.phone} onChange={e => setScheduleData({ ...scheduleData, phone: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                      <div className="relative">
                        <Mail size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="email" placeholder="E-mail" value={scheduleData.email} onChange={e => setScheduleData({ ...scheduleData, email: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                    </div>
                    <div className="relative">
                      <Calendar size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                      <input type="text" placeholder="Horário de preferência (opcional)" value={scheduleData.preferredTime} onChange={e => setScheduleData({ ...scheduleData, preferredTime: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                    </div>
                    <button disabled={scheduleLoading} className="w-full bg-black text-white py-4 rounded-2xl text-[10px] font-bold tracking-widest uppercase hover:bg-[#333] transition-all flex items-center justify-center gap-3 disabled:opacity-50 mt-2">
                      {scheduleLoading ? <Loader2 className="animate-spin" size={16} /> : 'Confirmar Visita'}
                    </button>
                    <button type="button" onClick={handleWhatsApp} className="w-full text-[#6B6B6B] text-[10px] font-bold tracking-widest uppercase hover:text-black transition-all pt-1">
                      Prefiro combinar por WhatsApp
                    </button>
                  </form>
                )}

                {scheduleStep === 'success' && (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-green-50 text-green-600 rounded-[20px] flex items-center justify-center mx-auto mb-6 border border-green-100">
                      <CheckCircle2 size={28} />
                    </div>
                    <h3 className="font-serif text-3xl font-light mb-3">Solicitação Enviada</h3>
                    <p className="text-[#6B6B6B] mb-8 px-4">Recebemos sua solicitação. O corretor responsável entrará em contato em breve.</p>
                    <button onClick={() => setIsScheduleModalOpen(false)} className="w-full bg-black text-white py-4 rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-[#333] transition-all">
                      Entendido
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Modal: Trajetória do Corretor ── */}
      <AnimatePresence>
        {isPhilosophyModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-8">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setIsPhilosophyModalOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-[#FAFAFA] w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[32px] shadow-2xl flex flex-col md:flex-row"
            >
              <div className="w-full md:w-2/5 h-56 md:h-auto bg-black relative shrink-0">
                <img src={brokerProfile.photoUrl} alt="Corretor" className="w-full h-full object-cover opacity-75" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-8">
                  <p className="text-white font-serif text-3xl font-light">{brokerProfile.name}</p>
                  <p className="text-white/60 text-[10px] tracking-[0.2em] uppercase mt-2">{brokerProfile.title}</p>
                </div>
              </div>
              <div className="w-full md:w-3/5 p-8 md:p-12 flex flex-col justify-center relative">
                <button onClick={() => setIsPhilosophyModalOpen(false)} className="absolute top-5 right-5 w-9 h-9 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all">
                  <X size={18} className="text-[#6B6B6B]" />
                </button>
                <h2 className="font-serif text-4xl font-light tracking-tight mb-8">Uma Trajetória de Excelência</h2>
                <div className="space-y-5 text-[#6B6B6B] font-light leading-relaxed mb-10">
                  <p>{brokerProfile.bio1}</p>
                  <p>{brokerProfile.bio2}</p>
                  {brokerProfile.quote && (
                    <blockquote className="border-l-2 border-[#E8E4E0] pl-6 italic text-[#1a1a1a] ml-2">{brokerProfile.quote}</blockquote>
                  )}
                </div>
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
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative bg-[#FAFAFA] w-full max-w-lg rounded-[32px] overflow-hidden shadow-2xl"
            >
              <div className="p-8 md:p-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <h2 className="font-serif text-3xl font-light tracking-tight mb-1">Entre em Contato</h2>
                    <p className="text-[#6B6B6B] text-sm">Envie uma mensagem e responderemos em breve.</p>
                  </div>
                  <button onClick={() => setIsContactModalOpen(false)} className="w-9 h-9 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all">
                    <X size={18} className="text-[#6B6B6B]" />
                  </button>
                </div>
                {contactStep === 'form' ? (
                  <form onSubmit={handleContactSubmit} className="space-y-4">
                    <div className="relative">
                      <User size={16} className="absolute left-5 top-[22px] -translate-y-1/2 text-[#9CA3AF]" />
                      <input required type="text" placeholder="Nome Completo" value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="relative">
                        <Phone size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="tel" placeholder="Telefone" value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                      <div className="relative">
                        <Mail size={16} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input required type="email" placeholder="E-mail" value={contactForm.email} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF]" />
                      </div>
                    </div>
                    <div className="relative">
                      <MessageCircle size={16} className="absolute left-5 top-5 text-[#9CA3AF]" />
                      <textarea required rows={4} placeholder="Sua Mensagem" value={contactForm.message} onChange={e => setContactForm({ ...contactForm, message: e.target.value })} className="w-full pl-14 pr-5 py-4 bg-white border border-[#E8E4E0] rounded-2xl text-sm focus:ring-1 focus:ring-black outline-none transition-all placeholder:text-[#9CA3AF] resize-none" />
                    </div>
                    <button disabled={contactLoading} className="w-full bg-black text-white py-4 rounded-2xl text-[10px] font-bold tracking-widest uppercase hover:bg-[#333] transition-all flex items-center justify-center gap-3 disabled:opacity-50 mt-2">
                      {contactLoading ? <Loader2 className="animate-spin" size={16} /> : 'Enviar Mensagem'}
                    </button>
                  </form>
                ) : (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 bg-green-50 text-green-600 rounded-[20px] flex items-center justify-center mx-auto mb-6 border border-green-100">
                      <CheckCircle2 size={28} />
                    </div>
                    <h3 className="font-serif text-3xl font-light mb-3">Mensagem Enviada</h3>
                    <p className="text-[#6B6B6B] mb-8 px-4">Obrigado pelo contato. Um corretor dedicado retornará em até 24 horas.</p>
                    <button onClick={() => { setIsContactModalOpen(false); setTimeout(() => setContactStep('form'), 300); }} className="w-full bg-black text-white py-4 rounded-full text-[10px] font-bold tracking-widest uppercase hover:bg-[#333] transition-all">
                      Fechar
                    </button>
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
