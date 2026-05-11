import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
// ... imports omitted for brevity, ensure all standard icons are still there
import { 
  MapPin, 
  BedDouble, 
  Bath, 
  Square, 
  CheckCircle2, 
  Calendar, 
  MessageCircle, 
  ArrowRight,
  Shield,
  Star,
  X,
  Mail,
  User,
  Phone,
  Clock,
  Send,
  Loader2
} from 'lucide-react';
import { motion } from 'motion/react';

export default function PropertyLanding() {
  const { slug } = useParams();
  const [property, setProperty] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // NOVO LANDING 30/04/2026 - Estados para agendamento
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [scheduleStep, setScheduleStep] = useState<'date' | 'form' | 'success'>('date');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleData, setScheduleData] = useState({ name: '', phone: '', email: '' });

  // NOVO LANDING 30/04/2026 - Estados para formulário lateral
  const [leadData, setLeadData] = useState({ name: '', phone: '' });
  const [submittingLead, setSubmittingLead] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState(false);

  // NOVO LANDING Modals adicionais
  const [isPhilosophyModalOpen, setIsPhilosophyModalOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactStep, setContactStep] = useState<'form' | 'success'>('form');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', message: '' });
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  const handleContactSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setContactLoading(true);
    setTimeout(() => {
      setContactLoading(false);
      setContactStep('success');
      setContactForm({ name: '', email: '', message: '' });
    }, 1500);
  };

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        const response = await fetch(`/api/properties/${slug}`);
        if (response.ok) {
          const data = await response.json();
          setProperty(data);
        }
      } catch (error) {
        console.error("Erro ao buscar imóvel:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProperty();
  }, [slug]);

  // NOVO LANDING 30/04/2026 - Busca de agenda
  const fetchAgenda = async () => {
    try {
      const response = await fetch('/api/agenda');
      if (response.ok) {
        const data = await response.json();
        // Filtrar apenas slots não ocupados se a tabela existir e tiver esse campo
        // Como o fallback é [], mostramos a mensagem de indisponibilidade
        setAvailableSlots(data);
      }
    } catch (e) {
      setAvailableSlots([]);
    }
  };

  const handleOpenSchedule = () => {
    setIsScheduleModalOpen(true);
    fetchAgenda();
  };

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setScheduleLoading(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          name: scheduleData.name,
          phone: scheduleData.phone,
          email: scheduleData.email,
          status: 'visita_agendada',
          notes: `Visita solicitada para o slot: ${selectedSlot}`
        })
      });
      if (response.ok) setScheduleStep('success');
    } catch (e) {
      console.error(e);
    } finally {
      setScheduleLoading(false);
    }
  };

  const handleWhatsApp = () => {
    const phone = property.brokers?.phone || '5500000000000';
    const text = `Olá, tenho interesse no imóvel REF: ${property.id || property.slug} - ${property.location}`;
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleLeadSubmit = async () => {
    // FLUXO ENVIAR LEAD 30/04/2026
    if (!leadData.name || !leadData.phone) {
      alert("Por favor, preencha nome e telefone.");
      return;
    }
    
    setSubmittingLead(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: property.id,
          name: leadData.name,
          phone: leadData.phone,
          status: 'new',
          notes: 'Interesse via formulário lateral Landing Page'
        })
      });
      
      if (response.ok) {
        setLeadSuccess(true);
      } else {
        const err = await response.json();
        alert(err.error || "Erro ao enviar mensagem. Por favor, tente o WhatsApp.");
      }
    } catch (e) {
      console.error(e);
      alert("Erro de conexão. Por favor, tente o WhatsApp.");
    } finally {
      setSubmittingLead(false);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-bold">Carregando landing page...</div>;
  if (!property) return <div className="h-screen flex items-center justify-center font-bold">Imóvel não encontrado.</div>;

  const mainImage = (property.images && property.images.length > 0) 
    ? property.images[0] 
    : (property.imageUrl || 'https://picsum.photos/seed/luxuryhome/1200/800');
  
  const additionalImages = property.images && property.images.length > 1 
    ? property.images.slice(1) 
    : [];

  // Deserialize extra data from description if present
  let extraData: any = {};
  let cleanDescription = property.description;
  if (property.description && property.description.includes('---DETALHES-GERADOS---')) {
    const parts = property.description.split('---DETALHES-GERADOS---');
    cleanDescription = parts[0].trim();
    try {
      extraData = JSON.parse(parts[1].trim());
    } catch (e) {
      console.error("Erro ao parsear detalhes extras:", e);
    }
  }

  const displayData = {
    title: property.title,
    location: property.location,
    price: property.price,
    description: cleanDescription,
    image: mainImage,
    images: additionalImages,
    bedrooms: extraData.quartos ?? property.bedrooms ?? 0,
    bathrooms: extraData.banheiros ?? property.bathrooms ?? 0,
    area: extraData.area ?? property.area ?? 0,
    livingRooms: extraData.sala ?? 0,
    kitchens: extraData.cozinha ?? 0,
    pool: extraData.piscina || 'Não informado',
    gourmet: extraData.varanda_gourmet || 'Não',
    features: [
      extraData.quartos > 0 ? `${extraData.quartos} Quartos` : null,
      extraData.banheiros > 0 ? `${extraData.banheiros} Banheiros` : null,
      extraData.sala > 0 ? `${extraData.sala} Sala(s)` : null,
      extraData.cozinha > 0 ? `${extraData.cozinha} Cozinha(s)` : null,
      extraData.piscina && extraData.piscina !== 'Não' ? `Piscina: ${extraData.piscina}` : null,
      extraData.varanda_gourmet === 'Sim' ? 'Varanda Gourmet' : null,
      'Espaço Gourmet',
      'Segurança 24h',
    ].filter(Boolean) as string[]
  };

  let brokerProfile = {
    name: property.brokers?.name || 'Elenore Vance',
    title: 'Principal Broker',
    photoUrl: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&q=80',
    bio1: 'For over a decade, Élevé has redefined the luxury real estate experience. We don\'t just sell properties; we curate architectural masterpieces for those who demand the extraordinary.',
    bio2: 'With more than 150 exclusive estates sold globally, our trajectory is built on absolute discretion, impeccable taste, and an intimate understanding of high-end living.',
    quote: '"Architecture is not just about spaces; it\'s about the life that unfolds within them. My mission is to match extraordinary people with their ultimate sanctuary."',
    propertiesSold: '150+',
    volumeSold: '$2B+'
  };

  if (property.brokers?.broker_address) {
    try {
      const extraProfile = JSON.parse(property.brokers.broker_address);
      if (extraProfile.title !== undefined) brokerProfile.title = extraProfile.title;
      if (extraProfile.photoUrl !== undefined && extraProfile.photoUrl.trim() !== '') brokerProfile.photoUrl = extraProfile.photoUrl;
      if (extraProfile.bio1 !== undefined) brokerProfile.bio1 = extraProfile.bio1;
      if (extraProfile.bio2 !== undefined) brokerProfile.bio2 = extraProfile.bio2;
      if (extraProfile.quote !== undefined) {
        const q = extraProfile.quote.trim();
        brokerProfile.quote = q ? (q.startsWith('"') ? q : `"${q}"`) : '';
      }
      if (extraProfile.propertiesSold !== undefined) brokerProfile.propertiesSold = extraProfile.propertiesSold;
      if (extraProfile.volumeSold !== undefined) brokerProfile.volumeSold = extraProfile.volumeSold;
    } catch (e) {}
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-sans text-[#000000] selection:bg-black selection:text-white pb-32">
      {/* Navigation (Fixed Top) */}
      <nav className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-6 md:px-12 py-6 bg-transparent mix-blend-difference text-white">
        <div className="font-serif text-2xl tracking-widest uppercase">
          {/* Logo removed */}
        </div>
        {/* Navigation visually removed per instruction */}
        <div className="hidden"></div>
      </nav>

      {/* Hero Section (100vh) */}
      <section className="relative h-screen min-h-screen overflow-hidden">
        <img 
          src={displayData.image}
          alt={displayData.title}
          className="absolute inset-0 w-full h-full object-cover origin-center scale-105 animate-[slowZoom_20s_ease-out_infinite_alternate]"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-x-0 bottom-0 h-[40vh] bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
        
        {/* Glassmorphism Card */}
        <div className="absolute top-[40%] md:top-[60%] -translate-y-1/2 left-6 right-6 md:translate-y-0 md:bottom-20 md:left-20 max-w-[520px] rounded-[32px] p-8 md:p-12 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.08)] bg-[rgba(250,250,250,0.72)] backdrop-blur-[40px] saturate-[180%] border border-white/30 transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] opacity-100 animate-[fadeInUp_1.2s_ease-out]">
          <h1 className="font-serif text-[2.5rem] leading-[1] md:text-5xl lg:text-[4rem] font-light tracking-tight mb-6 text-[#1a1a1a]">
            {displayData.title}
          </h1>
          <div className="h-[1px] w-12 bg-black/20 mb-6" />
          <p className="text-[#333333] text-sm md:text-base font-light leading-relaxed mb-10">
            A seamless blend of nature and modern design, crafted for those who elevate the art of living.
          </p>
          <button 
            onClick={handleWhatsApp}
            className="group relative inline-flex h-14 items-center justify-center overflow-hidden rounded-full bg-black px-8 font-medium text-white transition-all duration-300 hover:scale-105 focus:outline-none"
          >
            <span className="text-xs tracking-widest uppercase">Explore Estates</span>
            <ArrowRight size={16} className="ml-3 transition-transform duration-300 group-hover:translate-x-1" />
          </button>
        </div>

        {/* Scroll Indicator */}
        <div className="hidden md:flex flex-col items-center absolute bottom-20 right-12 text-white/80 gap-4 mix-blend-difference">
          <span className="text-[10px] tracking-[0.3em] uppercase rotate-90 origin-right translate-x-5">Scroll</span>
          <div className="w-[1px] h-16 bg-white/30 overflow-hidden mt-8">
            <div className="w-full h-1/2 bg-white animate-[scrollDown_2s_infinite]" />
          </div>
        </div>
      </section>

      {/* Featured Section */}
      <section id="featured-property" className="bg-[#F5F2EF] py-24 md:py-40 px-6 md:px-20 relative z-10 rounded-t-[40px] -mt-10">
        <div className="max-w-[1400px] mx-auto">
          <header className="mb-20 md:mb-32 md:text-center">
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#6B6B6B] uppercase mb-6">
              Featured Residence
            </p>
            <h2 className="font-serif text-5xl md:text-[5rem] lg:text-[7rem] font-light leading-[1.1] tracking-tight text-[#1a1a1a]">
              {displayData.title || "The Horizon Villa"}
            </h2>
          </header>

          {/* Asymmetrical Layout */}
          <div className="relative flex flex-col md:flex-row items-center md:items-start justify-between pb-20 md:pb-40 gap-8 md:gap-0">
            
            {/* Left Image (Pill) */}
            <div className="w-full md:w-[65%] h-[400px] sm:h-[500px] md:h-[700px] rounded-[40px] md:rounded-[9999px] overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.08)] transform transition-transform duration-[1200ms] hover:scale-[1.03] ease-[cubic-bezier(0.22,1,0.36,1)] relative z-10">
              <img 
                src={displayData.images?.[0] || mainImage} 
                alt="Interior view" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Floating Details Card (Mobile natural flow, Desktop absolute) */}
            <div className="relative md:absolute w-full md:w-[460px] md:left-[55%] md:top-[40%] bg-[#FAFAFA] rounded-[32px] p-8 md:p-12 shadow-[0_60px_160px_-30px_rgba(0,0,0,0.1)] z-30 md:-translate-x-1/2 md:-translate-y-1/2 transform transition-transform duration-[1200ms] md:hover:-translate-y-[calc(50%+10px)] ease-[cubic-bezier(0.22,1,0.36,1)] mt-4 md:mt-0">
              <div className="flex items-center gap-3 text-[#6B6B6B] mb-8">
                <MapPin size={16} />
                <span className="text-xs tracking-widest uppercase font-medium mt-1">{displayData.location}</span>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mb-6 border-y border-[#E8E4E0] py-8">
                <div className="text-center">
                  <p className="font-serif text-3xl md:text-4xl mb-2">{displayData.bedrooms}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#6B6B6B]">Bedrooms</p>
                </div>
                <div className="text-center border-x border-[#E8E4E0]">
                  <p className="font-serif text-3xl md:text-4xl mb-2">{displayData.bathrooms}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#6B6B6B]">Bathrooms</p>
                </div>
                <div className="text-center">
                  <p className="font-serif text-3xl md:text-4xl mb-2">{displayData.area > 0 ? displayData.area : 'N/A'}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#6B6B6B]">Sq Ft</p>
                </div>
              </div>

              {(displayData.livingRooms > 0 || displayData.kitchens > 0 || (displayData.pool && displayData.pool !== 'Não') || displayData.gourmet === 'Sim') && (
                <div className="flex flex-wrap gap-2 mb-8">
                  {displayData.livingRooms > 0 && <span className="px-3 py-1 bg-[#E8E4E0] rounded-full text-[10px] uppercase tracking-widest font-medium text-[#1a1a1a]">{displayData.livingRooms} Sala{displayData.livingRooms > 1 ? 's' : ''}</span>}
                  {displayData.kitchens > 0 && <span className="px-3 py-1 bg-[#E8E4E0] rounded-full text-[10px] uppercase tracking-widest font-medium text-[#1a1a1a]">{displayData.kitchens} Cozinha{displayData.kitchens > 1 ? 's' : ''}</span>}
                  {displayData.pool && displayData.pool !== 'Não' && displayData.pool !== 'Não informado' && <span className="px-3 py-1 bg-[#E8E4E0] rounded-full text-[10px] uppercase tracking-widest font-medium text-[#1a1a1a]">{displayData.pool.toLowerCase() === 'sim' ? 'Piscina' : `Piscina: ${displayData.pool}`}</span>}
                  {displayData.gourmet === 'Sim' && <span className="px-3 py-1 bg-[#E8E4E0] rounded-full text-[10px] uppercase tracking-widest font-medium text-[#1a1a1a]">Varanda Gourmet</span>}
                </div>
              )}
              
              <div className="mb-10 text-[#6B6B6B] leading-relaxed relative">
                <p className={`whitespace-pre-line ${!isDescriptionExpanded ? 'line-clamp-4' : ''}`}>
                  {displayData.description}
                </p>
                {displayData.description && displayData.description.length > 150 && (
                  <button 
                    onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                    className="text-black font-semibold text-xs mt-2 hover:underline uppercase tracking-widest"
                  >
                    {isDescriptionExpanded ? 'Ler menos' : 'Ler mais'}
                  </button>
                )}
              </div>
              
              <button 
                onClick={handleWhatsApp}
                className="w-full py-4 border border-[#E8E4E0] rounded-full text-[10px] font-semibold tracking-widest uppercase hover:bg-black hover:text-white transition-colors duration-300 hover:border-black"
              >
                Falar com o Corretor
              </button>
            </div>

            {/* Right Image (Arch) */}
            <div className="w-full md:w-[45%] h-[300px] sm:h-[400px] md:h-[600px] rounded-[40px] md:rounded-[9999px_9999px_24px_24px] overflow-hidden shadow-[0_60px_160px_-30px_rgba(0,0,0,0.1)] md:mt-[10rem] md:-ml-20 z-10 transform transition-transform duration-[1200ms] hover:scale-[1.03] ease-[cubic-bezier(0.22,1,0.36,1)]">
              <img 
                src={displayData.images?.[1] || mainImage} 
                alt="Exterior view" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      {property?.images && property.images.length > 0 && (
        <section className="bg-white py-20 px-6 md:px-20 relative z-10 w-full overflow-hidden border-t border-[#E8E4E0]">
          <div className="max-w-[1400px] mx-auto">
            <header className="mb-16 md:text-center">
              <p className="text-[11px] font-bold tracking-[0.2em] text-[#6B6B6B] uppercase mb-4">
                Gallery
              </p>
              <h2 className="font-serif text-4xl md:text-5xl font-light tracking-tight text-[#1a1a1a]">
                All Images
              </h2>
            </header>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {property.images.map((img: string, idx: number) => (
                <div key={idx} className="aspect-[4/3] rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-shadow duration-300 bg-[#FAFAFA]">
                  <img 
                    src={img} 
                    alt={`Property Image ${idx + 1}`} 
                    className="w-full h-full object-cover transform hover:scale-105 transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Map Section */}
      <section id="location-map" className="bg-[#FAFAFA] py-20 px-6 md:px-20 relative z-10 w-full overflow-hidden border-t border-[#E8E4E0]">
        <div className="max-w-[1400px] mx-auto">
          <header className="mb-12 md:text-center">
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#6B6B6B] uppercase mb-4">
              Localização
            </p>
            <h2 className="font-serif text-4xl md:text-5xl font-light tracking-tight text-[#1a1a1a]">
              {displayData.location}
            </h2>
          </header>
          <div className="w-full h-[400px] md:h-[500px] rounded-[32px] overflow-hidden shadow-[0_40px_120px_-20px_rgba(0,0,0,0.08)] bg-[#E8E4E0] relative group">
            <iframe 
              title="Property Location on Google Maps"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(displayData.location)}&t=&z=15&ie=UTF8&iwloc=&output=embed`} 
              width="100%" 
              height="100%" 
              style={{ border: 0 }} 
              allowFullScreen={false} 
              loading="lazy" 
              referrerPolicy="no-referrer-when-downgrade"
              className="absolute inset-0 w-full h-full grayscale-[20%] group-hover:grayscale-0 transition-all duration-700"
            ></iframe>
          </div>
          <div className="mt-12 flex justify-center">
            <a 
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayData.location)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center px-10 py-5 border border-[#1a1a1a] rounded-full text-[11px] font-semibold tracking-widest uppercase text-[#1a1a1a] hover:text-white hover:bg-black transition-colors duration-300"
            >
              View on Map
            </a>
          </div>
        </div>
      </section>

      {/* Floating CTA */}
      <button 
        onClick={handleWhatsApp}
        className="fixed bottom-8 right-8 z-[100] w-16 h-16 bg-[#25D366] rounded-full flex items-center justify-center text-white shadow-[0_20px_40px_rgba(0,0,0,0.2)] transition-all duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-[1.05] hover:-translate-y-1 hover:shadow-[0_30px_60px_rgba(0,0,0,0.3)] hover:bg-[#1EBE55] group"
        aria-label="Contact on WhatsApp"
      >
        <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor" className="transition-transform duration-300 group-hover:scale-110">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.878-.788-1.472-1.761-1.645-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
        </svg>
      </button>

      {/* Modal de Agendamento */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 sm:p-10">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setIsScheduleModalOpen(false)} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative bg-[#FAFAFA] w-full max-w-xl rounded-[32px] overflow-hidden shadow-2xl"
          >
            <div className="p-8 md:p-12">
              <div className="flex justify-between items-start mb-10">
                <div>
                  <h2 className="font-serif text-3xl font-light tracking-tight mb-2">Schedule Viewing</h2>
                  <p className="text-[#6B6B6B] text-sm">Choose the best time to experience this property.</p>
                </div>
                <button 
                  onClick={() => setIsScheduleModalOpen(false)}
                  className="w-10 h-10 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all"
                >
                  <X size={20} className="text-[#6B6B6B]" />
                </button>
              </div>

              {scheduleStep === 'date' && (
                <div className="space-y-8">
                  <div className="grid grid-cols-1 gap-4">
                    {availableSlots.length > 0 ? (
                      availableSlots.map((slot, idx) => (
                        <button 
                          key={idx}
                          onClick={() => {
                            setSelectedSlot(slot.horario);
                            setScheduleStep('form');
                          }}
                          className={"w-full p-6 border rounded-2xl text-left transition-all flex items-center justify-between group " + (selectedSlot === slot.horario ? "border-black bg-black text-white" : "border-[#E8E4E0] hover:border-black/50 bg-white")}
                        >
                          <div className="flex items-center gap-4">
                            <Clock size={20} className={selectedSlot === slot.horario ? "text-white" : "text-[#6B6B6B]"} />
                            <span className="font-medium text-sm tracking-wide">{slot.data} at {slot.horario}</span>
                          </div>
                          <ArrowRight size={18} className="opacity-0 group-hover:opacity-100 transition-all" />
                        </button>
                      ))
                    ) : (
                      <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-[#E8E4E0]">
                        <Calendar size={40} className="mx-auto text-[#E8E4E0] mb-4" />
                        <p className="font-medium mb-2 text-[#000000]">No slots available currently</p>
                        <p className="text-[#6B6B6B] text-sm mb-8 px-10">You can speak directly with the broker via WhatsApp to arrange a custom time.</p>
                        <button 
                          onClick={handleWhatsApp}
                          className="px-8 py-3 bg-black text-white rounded-full text-[10px] font-semibold tracking-widest uppercase hover:bg-[#1a1a1a] transition-all"
                        >
                          Contact via WhatsApp
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {scheduleStep === 'form' && (
                <form onSubmit={handleScheduleSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="relative">
                      <User size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                      <input 
                        required
                        type="text" 
                        placeholder="Full Name"
                        value={scheduleData.name}
                        onChange={e => setScheduleData({...scheduleData, name: e.target.value})}
                        className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="relative">
                        <Phone size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input 
                          required
                          type="tel" 
                          placeholder="Phone / WhatsApp"
                          value={scheduleData.phone}
                          onChange={e => setScheduleData({...scheduleData, phone: e.target.value})}
                          className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]"
                        />
                      </div>
                      <div className="relative">
                        <Mail size={18} className="absolute left-6 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                        <input 
                          required
                          type="email" 
                          placeholder="Email Address"
                          value={scheduleData.email}
                          onChange={e => setScheduleData({...scheduleData, email: e.target.value})}
                          className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]"
                        />
                      </div>
                    </div>
                  </div>
                  <button 
                    disabled={scheduleLoading}
                    className="w-full bg-black text-white py-5 rounded-2xl text-[10px] font-semibold tracking-widest uppercase hover:bg-[#1a1a1a] transition-all flex items-center justify-center gap-3 disabled:opacity-50 mt-4"
                  >
                    {scheduleLoading ? <Loader2 className="animate-spin" /> : "Confirm Viewing"}
                  </button>
                  <button 
                    type="button"
                    onClick={() => setScheduleStep('date')}
                    className="w-full text-[#6B6B6B] text-[10px] font-semibold tracking-widest uppercase hover:text-black transition-all pt-2"
                  >
                    Back to dates
                  </button>
                </form>
              )}

              {scheduleStep === 'success' && (
                <div className="text-center py-10">
                  <div className="w-20 h-20 bg-green-50 text-green-600 rounded-[20px] flex items-center justify-center mx-auto mb-8 border border-green-100">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className="font-serif text-3xl font-light tracking-tight mb-4 text-[#000000]">Request Submitted</h3>
                  <p className="text-[#6B6B6B] mb-10 px-6">We've received your request. The responsible broker will contact you shortly to confirm the timeline.</p>
                  <button 
                    onClick={() => setIsScheduleModalOpen(false)}
                    className="w-full bg-black text-white py-4 rounded-full text-[10px] font-semibold tracking-widest uppercase hover:bg-[#1a1a1a] transition-all"
                  >
                    Understood
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal de Filosofia/Trajetória do Corretor */}
      {isPhilosophyModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 sm:p-10">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setIsPhilosophyModalOpen(false)} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative bg-[#FAFAFA] w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-[32px] overflow-hidden shadow-2xl flex flex-col md:flex-row"
          >
            <div className="w-full md:w-2/5 md:h-auto h-64 bg-black relative">
              <img 
                src={brokerProfile.photoUrl} 
                alt="Broker" 
                className="w-full h-full object-cover opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex flex-col justify-end p-8">
                <p className="text-white font-serif text-3xl font-light">{brokerProfile.name}</p>
                <p className="text-white/70 text-xs tracking-[0.2em] uppercase mt-2">{brokerProfile.title}</p>
              </div>
            </div>
            <div className="w-full md:w-3/5 p-8 md:p-14 bg-[#FAFAFA] flex flex-col justify-center relative">
              <button 
                onClick={() => setIsPhilosophyModalOpen(false)}
                className="absolute top-6 right-6 w-10 h-10 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all"
              >
                <X size={20} className="text-[#6B6B6B]" />
              </button>
              
              <h2 className="font-serif text-4xl md:text-5xl font-light tracking-tight mb-8 text-[#000000]">
                A Legacy of Curation
              </h2>
              
              <div className="space-y-6 text-[#6B6B6B] font-light leading-relaxed mb-10">
                <p>
                  {brokerProfile.bio1}
                </p>
                <p>
                  {brokerProfile.bio2}
                </p>
                <blockquote className="border-l-2 border-[#E8E4E0] pl-6 italic text-[#1a1a1a] ml-4">
                  {brokerProfile.quote}
                </blockquote>
              </div>
              
              <div className="grid grid-cols-2 gap-8 border-t border-[#E8E4E0] pt-8">
                <div>
                  <p className="font-serif text-4xl mb-1 text-[#000000]">{brokerProfile.propertiesSold}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#6B6B6B]">Properties Sold</p>
                </div>
                <div>
                  <p className="font-serif text-4xl mb-1 text-[#000000]">{brokerProfile.volumeSold}</p>
                  <p className="text-[10px] uppercase tracking-widest text-[#6B6B6B]">Volume Sold</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal de Contato */}
      {isContactModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 sm:p-10">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => setIsContactModalOpen(false)} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="relative bg-[#FAFAFA] w-full max-w-xl rounded-[32px] overflow-hidden shadow-2xl"
          >
            <div className="p-8 md:p-12">
              <div className="flex justify-between items-start mb-10">
                <div>
                  <h2 className="font-serif text-3xl font-light tracking-tight mb-2">Get in Touch</h2>
                  <p className="text-[#6B6B6B] text-sm">Send us a message and we will respond promptly.</p>
                </div>
                <button 
                  onClick={() => setIsContactModalOpen(false)}
                  className="w-10 h-10 rounded-full hover:bg-[#E8E4E0] flex items-center justify-center transition-all"
                >
                  <X size={20} className="text-[#6B6B6B]" />
                </button>
              </div>

              {contactStep === 'form' ? (
                <form onSubmit={handleContactSubmit} className="space-y-6">
                  <div className="space-y-4">
                    <div className="relative">
                      <User size={18} className="absolute left-6 top-[22px] -translate-y-1/2 text-[#9CA3AF]" />
                      <input 
                        required
                        type="text" 
                        placeholder="Full Name"
                        value={contactForm.name}
                        onChange={e => setContactForm({...contactForm, name: e.target.value})}
                        className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]"
                      />
                    </div>
                    <div className="relative">
                      <Mail size={18} className="absolute left-6 top-[22px] -translate-y-1/2 text-[#9CA3AF]" />
                      <input 
                        required
                        type="email" 
                        placeholder="Email Address"
                        value={contactForm.email}
                        onChange={e => setContactForm({...contactForm, email: e.target.value})}
                        className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF]"
                      />
                    </div>
                    <div className="relative">
                      <MessageCircle size={18} className="absolute left-6 top-6 text-[#9CA3AF]" />
                      <textarea 
                        required
                        rows={4}
                        placeholder="Your Message"
                        value={contactForm.message}
                        onChange={e => setContactForm({...contactForm, message: e.target.value})}
                        className="w-full pl-16 pr-6 py-4 bg-white border border-[#E8E4E0] rounded-2xl focus:ring-1 focus:ring-black focus:border-black outline-none transition-all placeholder:text-[#9CA3AF] resize-none"
                      />
                    </div>
                  </div>
                  <button 
                    disabled={contactLoading}
                    className="w-full bg-black text-white py-5 rounded-2xl text-[10px] font-semibold tracking-widest uppercase hover:bg-[#1a1a1a] transition-all flex items-center justify-center gap-3 disabled:opacity-50 mt-4"
                  >
                    {contactLoading ? <Loader2 className="animate-spin" /> : "Send Message"}
                  </button>
                </form>
              ) : (
                <div className="text-center py-10">
                  <div className="w-20 h-20 bg-green-50 text-green-600 rounded-[20px] flex items-center justify-center mx-auto mb-8 border border-green-100">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className="font-serif text-3xl font-light tracking-tight mb-4 text-[#000000]">Message Sent</h3>
                  <p className="text-[#6B6B6B] mb-10 px-6">Thank you for reaching out. A dedicated broker will get back to you within 24 hours.</p>
                  <button 
                    onClick={() => {
                      setIsContactModalOpen(false);
                      setTimeout(() => setContactStep('form'), 300);
                    }}
                    className="w-full bg-black text-white py-4 rounded-full text-[10px] font-semibold tracking-widest uppercase hover:bg-[#1a1a1a] transition-all"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}

function Stat({ icon, label, value }: any) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-black/40">{icon}</div>
      <div className="flex flex-col md:flex-row md:items-center md:gap-1">
        <span className="text-[10px] text-[#9CA3AF] font-bold uppercase tracking-wider md:hidden">{label}</span>
        <span className="font-bold text-sm">{value}</span>
        {label && <span className="hidden md:inline text-sm font-medium text-[#6B7280]">{label}</span>}
      </div>
    </div>
  );
}
