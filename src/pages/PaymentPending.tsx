import React, { useState, useEffect } from 'react';
import { Home, CreditCard, Lock, Loader2, CheckCircle2, XCircle, User, Hash, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { authService } from '../services/auth';

interface CardForm {
  cpfCnpj: string;
  cardHolder: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
}

type FieldErrors = Partial<Record<keyof CardForm, string>>;

const BENEFITS = [
  'Imóveis ilimitados com landing page exclusiva',
  'Leads capturados automaticamente no CRM',
  'Agente IA respondendo seu WhatsApp 24h',
  'Dashboard com métricas em tempo real',
  '100 atendimentos de IA inclusos por mês',
];

// ── Validações ─────────────────────────────────────────────────────────────

function validateCPF(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +d[i] * (10 - i);
  let r = (sum * 10) % 11; if (r >= 10) r = 0;
  if (r !== +d[9]) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += +d[i] * (11 - i);
  r = (sum * 10) % 11; if (r >= 10) r = 0;
  return r === +d[10];
}

function luhn(raw: string): boolean {
  const d = raw.replace(/\s/g, '');
  if (d.length < 13 || d.length > 19 || !/^\d+$/.test(d)) return false;
  let sum = 0;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = +d[i];
    if ((d.length - i) % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

function validateFields(form: CardForm): FieldErrors {
  const e: FieldErrors = {};
  const cpfDigits = form.cpfCnpj.replace(/\D/g, '');
  if (!cpfDigits) {
    e.cpfCnpj = 'CPF obrigatório';
  } else if (cpfDigits.length === 11 && !validateCPF(form.cpfCnpj)) {
    e.cpfCnpj = 'CPF inválido';
  } else if (cpfDigits.length !== 11 && cpfDigits.length !== 14) {
    e.cpfCnpj = 'CPF inválido';
  }
  if (!form.cardHolder.trim()) e.cardHolder = 'Nome obrigatório';
  if (!form.cardNumber.trim()) {
    e.cardNumber = 'Número do cartão obrigatório';
  } else if (!luhn(form.cardNumber)) {
    e.cardNumber = 'Número do cartão inválido';
  }
  const month = parseInt(form.expiryMonth, 10);
  const year = parseInt(form.expiryYear, 10);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  if (!form.expiryMonth || isNaN(month) || month < 1 || month > 12) {
    e.expiryMonth = 'Mês inválido';
  } else if (!form.expiryYear || isNaN(year) || year < currentYear || (year === currentYear && month < currentMonth)) {
    e.expiryYear = 'Data inválida';
  }
  const cvvLen = form.cvv.replace(/\D/g, '').length;
  if (!form.cvv) {
    e.cvv = 'CVV obrigatório';
  } else if (cvvLen < 3 || cvvLen > 4) {
    e.cvv = 'CVV inválido';
  }
  return e;
}

// ── Helpers de estilo ───────────────────────────────────────────────────────

const baseInput =
  'w-full py-3 rounded-2xl outline-none transition-all text-sm font-medium text-white placeholder:text-white/30 ' +
  'bg-white/10 border focus:ring-2 focus:bg-white/15 [color-scheme:dark]';

function inputCls(err?: string) {
  return `${baseInput} ${err
    ? 'border-red-400/60 focus:ring-red-400/30'
    : 'border-white/15 focus:ring-white/25'}`;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1 pl-1">
      <XCircle className="w-3 h-3 shrink-0" /> {msg}
    </p>
  );
}

// ── Componente principal ────────────────────────────────────────────────────

export default function PaymentPending() {
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Partial<Record<keyof CardForm, boolean>>>({});
  const [acceptedRecurring, setAcceptedRecurring] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [planPrice, setPlanPrice] = useState<string>('687');
  const [form, setForm] = useState<CardForm>({
    cpfCnpj: '', cardHolder: '', cardNumber: '',
    expiryMonth: '', expiryYear: '', cvv: ''
  });

  useEffect(() => {
    fetch('/api/config/plan', { headers: authService.getAuthHeaders() })
      .then(r => r.json())
      .then(d => { if (d?.priceDisplay) setPlanPrice(d.priceDisplay); })
      .catch(() => {});
  }, []);

  const touch = (field: keyof CardForm) => () =>
    setTouched(t => ({ ...t, [field]: true }));

  const setField = (field: keyof CardForm, value: string) => {
    const next = { ...form, [field]: value };
    setForm(next);
    if (touched[field]) {
      const errs = validateFields(next);
      setFieldErrors(prev => ({ ...prev, [field]: errs[field] }));
    }
  };

  const formatCard = (v: string) =>
    v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  const formatCpfCnpj = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 14);
    if (d.length <= 11)
      return d.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4')
              .replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3')
              .replace(/(\d{3})(\d{1,3})/, '$1.$2');
    return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{1,2})/, '$1.$2.$3/$4-$5')
            .replace(/(\d{2})(\d{3})(\d{3})(\d{1,4})/, '$1.$2.$3/$4')
            .replace(/(\d{2})(\d{3})(\d{1,3})/, '$1.$2.$3')
            .replace(/(\d{2})(\d{1,3})/, '$1.$2');
  };

  // Mapeia erros do servidor para campos específicos
  function mapServerError(msg: string): { field?: keyof CardForm; message: string } {
    const m = msg.toLowerCase();
    if (m.includes('cartão') && (m.includes('número') || m.includes('inválido'))) return { field: 'cardNumber', message: 'Número do cartão inválido' };
    if (m.includes('cvv') || m.includes('código de segurança')) return { field: 'cvv', message: 'CVV inválido' };
    if (m.includes('validade') || m.includes('expir')) return { field: 'expiryMonth', message: 'Data de validade inválida' };
    if (m.includes('cpf') || m.includes('cnpj') || m.includes('document')) return { field: 'cpfCnpj', message: 'CPF/CNPJ inválido' };
    if (m.includes('nome') || m.includes('titular')) return { field: 'cardHolder', message: 'Nome no cartão inválido' };
    if (m.includes('recusado') || m.includes('declined') || m.includes('refused')) return { message: 'Pagamento recusado pela operadora. Verifique os dados ou use outro cartão.' };
    if (m.includes('saldo') || m.includes('limite')) return { message: 'Cartão sem limite disponível.' };
    return { message: msg };
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError('');

    // Valida tudo antes de enviar
    const allTouched = Object.fromEntries(Object.keys(form).map(k => [k, true]));
    setTouched(allTouched as any);
    const errs = validateFields(form);
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const resp = await fetch('/api/checkout', {
        method: 'POST',
        headers: { ...authService.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpfCnpj: form.cpfCnpj.replace(/\D/g, ''),
          cardHolder: form.cardHolder,
          cardNumber: form.cardNumber.replace(/\s/g, ''),
          expiryMonth: form.expiryMonth,
          expiryYear: form.expiryYear,
          cvv: form.cvv
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        const mapped = mapServerError(data.error || 'Erro ao processar pagamento');
        if (mapped.field) {
          setFieldErrors(prev => ({ ...prev, [mapped.field!]: mapped.message }));
        } else {
          setGlobalError(mapped.message);
        }
        return;
      }
      window.location.replace('/payment/success');
    } catch (err: any) {
      setGlobalError('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const priceNum = planPrice.replace('.', ',');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 flex flex-col items-center justify-start py-10 px-4 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative z-10 w-full max-w-lg"
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4
            backdrop-blur-md bg-white/15 border border-white/25
            shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_4px_16px_rgba(0,0,0,0.3)]">
            <Home className="text-white w-7 h-7" />
          </div>
          <h1 className="text-2xl font-black text-white">Ative seu plano</h1>
          <p className="text-white/50 text-sm mt-1">Preencha os dados do cartão para começar</p>
        </div>

        {/* Preço + benefícios */}
        <div className="rounded-3xl p-6 mb-5
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">
          <div className="flex items-center justify-between mb-5">
            <div>
              <span className="text-3xl font-black text-white">R$ {priceNum}</span>
              <span className="text-white/50 text-sm">/mês</span>
            </div>
            <span className="text-xs text-white/50 bg-white/10 border border-white/15 px-3 py-1.5 rounded-full">
              Cancele quando quiser
            </span>
          </div>
          <div className="space-y-2.5">
            {BENEFITS.map(b => (
              <div key={b} className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-sm text-white/70">{b}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-white/40 leading-relaxed mt-4 pt-4 border-t border-white/10">
            Caso ultrapasse os 100 atendimentos inclusos no mês, cada atendimento adicional custará{' '}
            <strong className="text-white/60">R$ 3,00</strong>. Você acompanha o uso em tempo real no seu painel para manter o controle total.
          </p>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} noValidate className="rounded-3xl p-6 space-y-4
          backdrop-blur-xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_32px_rgba(0,0,0,0.25)]">

          <div className="flex items-center gap-2 mb-1">
            <Lock className="w-4 h-4 text-white/30" />
            <span className="text-xs text-white/40 font-medium">Pagamento seguro — seus dados são criptografados</span>
          </div>

          {globalError && (
            <div className="flex items-center gap-2 bg-red-500/20 border border-red-400/30 text-red-300 p-3 rounded-2xl text-sm">
              <XCircle className="w-4 h-4 shrink-0" /> {globalError}
            </div>
          )}

          {/* CPF/CNPJ */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CPF / CNPJ</label>
            <div className="relative">
              <Hash className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                value={form.cpfCnpj}
                onChange={e => setField('cpfCnpj', formatCpfCnpj(e.target.value))}
                onBlur={touch('cpfCnpj')}
                className={`${inputCls(fieldErrors.cpfCnpj)} pl-11 pr-4`}
                placeholder="000.000.000-00"
              />
            </div>
            <FieldError msg={fieldErrors.cpfCnpj} />
          </div>

          {/* Nome no cartão */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Nome no Cartão</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                value={form.cardHolder}
                onChange={e => setField('cardHolder', e.target.value)}
                onBlur={touch('cardHolder')}
                className={`${inputCls(fieldErrors.cardHolder)} pl-11 pr-4`}
                placeholder="Como aparece no cartão"
              />
            </div>
            <FieldError msg={fieldErrors.cardHolder} />
          </div>

          {/* Número do cartão */}
          <div>
            <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Número do Cartão</label>
            <div className="relative">
              <CreditCard className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
              <input
                value={form.cardNumber}
                onChange={e => setField('cardNumber', formatCard(e.target.value))}
                onBlur={touch('cardNumber')}
                className={`${inputCls(fieldErrors.cardNumber)} pl-11 pr-4 tracking-widest`}
                placeholder="0000 0000 0000 0000"
                maxLength={19}
              />
            </div>
            <FieldError msg={fieldErrors.cardNumber} />
          </div>

          {/* Validade + CVV */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Mês</label>
              <input
                value={form.expiryMonth}
                onChange={e => setField('expiryMonth', e.target.value.replace(/\D/g, '').slice(0, 2))}
                onBlur={touch('expiryMonth')}
                maxLength={2}
                className={`${inputCls(fieldErrors.expiryMonth)} px-4 text-center`}
                placeholder="MM"
              />
              <FieldError msg={fieldErrors.expiryMonth} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">Ano</label>
              <input
                value={form.expiryYear}
                onChange={e => setField('expiryYear', e.target.value.replace(/\D/g, '').slice(0, 4))}
                onBlur={touch('expiryYear')}
                maxLength={4}
                className={`${inputCls(fieldErrors.expiryYear)} px-4 text-center`}
                placeholder="AAAA"
              />
              <FieldError msg={fieldErrors.expiryYear} />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-white/40 mb-1.5 uppercase tracking-widest pl-1">CVV</label>
              <div className="relative">
                <input
                  value={form.cvv}
                  onChange={e => setField('cvv', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onBlur={touch('cvv')}
                  maxLength={4}
                  type={showCvv ? 'text' : 'password'}
                  className={`${inputCls(fieldErrors.cvv)} px-4 pr-9 text-center`}
                  placeholder="•••"
                />
                <button type="button" onClick={() => setShowCvv(v => !v)}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-white/30 hover:text-white/70 transition-colors">
                  {showCvv ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <FieldError msg={fieldErrors.cvv} />
            </div>
          </div>

          {/* Checkboxes */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" checked={acceptedRecurring} onChange={e => setAcceptedRecurring(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-violet-400 cursor-pointer [color-scheme:dark]" />
              <span className="text-[10px] text-white/40 leading-relaxed group-hover:text-white/60 transition-colors">
                Autorizo a cobrança recorrente de <strong className="text-white/70">R$ {priceNum}/mês</strong> e o valor de <strong className="text-white/70">R$ 3,00 por atendimento adicional</strong> (acima de 100/mês), se houver. Posso cancelar a qualquer momento.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer group">
              <input type="checkbox" checked={acceptedTerms} onChange={e => setAcceptedTerms(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-violet-400 cursor-pointer [color-scheme:dark]" />
              <span className="text-[10px] text-white/40 leading-relaxed group-hover:text-white/60 transition-colors">
                Li e aceito os{' '}
                <a href="/termos" target="_blank" rel="noopener noreferrer" className="text-violet-300 font-semibold hover:text-violet-200 transition-colors">Termos de Uso</a>
                {' '}e a{' '}
                <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="text-violet-300 font-semibold hover:text-violet-200 transition-colors">Política de Privacidade</a>.
              </span>
            </label>
          </div>

          {/* Botão pagar */}
          <button
            type="submit"
            disabled={loading || !acceptedRecurring || !acceptedTerms}
            className="w-full h-14 flex items-center justify-center gap-2 rounded-2xl text-base font-bold mt-2
              transition-all active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed
              backdrop-blur-md bg-white/15 border border-white/25 text-white
              shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)]
              hover:bg-white/25 enabled:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_24px_rgba(0,0,0,0.35)]"
          >
            {loading
              ? <Loader2 className="animate-spin w-5 h-5" />
              : <><CreditCard className="w-5 h-5" /> Pagar R$ {priceNum}/mês</>
            }
          </button>
        </form>

        <button
          onClick={() => authService.logout()}
          className="mt-5 w-full text-center text-sm text-white/30 hover:text-white/60 transition-colors"
        >
          Sair da conta
        </button>
      </motion.div>
    </div>
  );
}
