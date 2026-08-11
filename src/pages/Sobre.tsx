import React from 'react';
import { Link } from 'react-router-dom';
import { Bot, CalendarSync, CheckCircle2, Home, ShieldCheck } from 'lucide-react';
import Copyright from '../components/Copyright';

const features = [
  'Carteira de imóveis, CRM e conversas em um único ambiente',
  'Assistente interno por painel e WhatsApp Pai',
  'Agenda de visitas com sincronização opcional de calendários',
  'Locação, cobranças, relatórios e operação de equipes',
];

export default function Sobre() {
  return (
    <main className="min-h-screen app-bg px-4 py-8 font-sans text-[var(--text-mid)] md:py-14">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
          <Link to="/sobre" className="flex items-center gap-3 text-[var(--text-hi)]">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--glass-border-strong)] bg-[var(--control-fill-hover)]">
              <Home className="h-5 w-5" />
            </span>
            <span>
              <strong className="block text-lg">ImobiFlow</strong>
              <span className="text-xs text-[var(--text-low)]">Tecnologia para o mercado imobiliário</span>
            </span>
          </Link>
          <nav className="flex items-center gap-3" aria-label="Acesso à plataforma">
            <Link to="/login" className="rounded-xl px-4 py-2 text-sm font-semibold hover:bg-[var(--control-fill-hover)]">Entrar</Link>
            <Link to="/signup" className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-400">Criar conta</Link>
          </nav>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
          <article className="rounded-[30px] border border-[var(--glass-border)] bg-[var(--control-fill-hover)] p-7 shadow-2xl md:p-10">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-500/10 px-3 py-1 text-xs font-bold text-sky-200">
              <Bot className="h-4 w-4" /> Plataforma imobiliária com IA
            </span>
            <h1 className="max-w-2xl text-3xl font-black leading-tight text-[var(--text-hi)] md:text-5xl">
              Operação imobiliária organizada do atendimento à locação.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-mid)]">
              O ImobiFlow é uma plataforma da Criate Tecnologia em Marketing e Vendas LTDA para corretores,
              imobiliárias e incorporadoras administrarem imóveis, clientes, agendas e rotinas comerciais.
            </p>
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature} className="flex gap-2 rounded-2xl border border-[var(--hairline)] p-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> {feature}
                </li>
              ))}
            </ul>
          </article>

          <aside className="rounded-[30px] border border-[var(--glass-border)] bg-[var(--control-fill-hover)] p-7 md:p-8">
            <CalendarSync className="h-8 w-8 text-sky-300" />
            <h2 className="mt-5 text-xl font-black text-[var(--text-hi)]">Integração com o Google Agenda</h2>
            <p className="mt-3 text-sm leading-6">
              A conexão é opcional e cria uma agenda secundária chamada ImobiFlow. A plataforma pode criar,
              consultar, alterar e excluir somente os eventos dessa agenda criada pelo próprio aplicativo.
            </p>
            <p className="mt-3 text-sm leading-6">
              O ImobiFlow não solicita acesso à agenda principal nem aos demais calendários pessoais do usuário.
              A integração pode ser desconectada a qualquer momento dentro da Agenda.
            </p>
            <div className="mt-6 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              Tokens são protegidos no servidor e nunca são expostos no navegador.
            </div>
          </aside>
        </section>

        <footer className="mt-8 rounded-2xl border border-[var(--hairline)] bg-[var(--control-fill-hover)] p-5 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link to="/privacidade" className="font-semibold text-sky-300 hover:text-sky-200">Política de Privacidade</Link>
            <Link to="/termos" className="font-semibold text-sky-300 hover:text-sky-200">Termos de Uso</Link>
            <a href="mailto:criateoficial@gmail.com" className="font-semibold text-sky-300 hover:text-sky-200">Suporte</a>
          </div>
          <p className="mt-4 text-xs leading-5 text-[var(--text-low)]">
            Criate Tecnologia em Marketing e Vendas LTDA · CNPJ 54.236.008/0001-80 · Goiânia/GO, Brasil.
          </p>
          <div className="mt-4"><Copyright /></div>
        </footer>
      </div>
    </main>
  );
}
