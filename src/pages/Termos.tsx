import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { motion } from 'motion/react';

export default function Termos() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 py-10 px-4 font-sans relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")'}} />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-3xl mx-auto rounded-[32px] p-8 md:p-12
          backdrop-blur-2xl bg-white/10 border border-white/15
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_24px_64px_rgba(0,0,0,0.4)]"
      >
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-white/60 hover:text-white mb-8 transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center backdrop-blur-md bg-white/15 border border-white/25">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white">Termos de Uso</h1>
        </div>
        <p className="text-white/40 text-sm mb-8">Última atualização: [DATA] · ImobiFlow</p>

        <div className="space-y-7 text-white/70 text-sm leading-relaxed [&_h2]:text-white [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-7 [&_h2]:mb-2 [&_strong]:text-white/90">
          <section>
            <h2>1. Objeto</h2>
            <p>Estes Termos de Uso regulam o acesso e a utilização da plataforma <strong>ImobiFlow</strong> ("Plataforma"), um serviço de software como serviço (SaaS) destinado a corretores e corretoras de imóveis, oferecendo gestão de imóveis, captação e qualificação de leads, agenda e atendimento automatizado via inteligência artificial no WhatsApp.</p>
          </section>

          <section>
            <h2>2. Aceitação</h2>
            <p>Ao criar uma conta e/ou utilizar a Plataforma, o usuário declara ter lido, compreendido e aceito integralmente estes Termos e a Política de Privacidade. Caso não concorde, não deverá utilizar o serviço.</p>
          </section>

          <section>
            <h2>3. Cadastro e Conta</h2>
            <p>O usuário compromete-se a fornecer dados verídicos, completos e atualizados, incluindo número de registro no CRECI quando aplicável. O usuário é o único responsável pela guarda de suas credenciais e por toda atividade realizada em sua conta.</p>
          </section>

          <section>
            <h2>4. Planos, Cobrança Recorrente e Renovação</h2>
            <p>A Plataforma é oferecida mediante <strong>assinatura mensal recorrente</strong>, processada pelo gateway de pagamento Asaas. A cobrança é realizada automaticamente no cartão de crédito cadastrado, com <strong>renovação automática</strong> a cada ciclo, até que o usuário solicite o cancelamento. Valores e condições vigentes são exibidos na contratação.</p>
          </section>

          <section>
            <h2>5. Cancelamento e Suspensão</h2>
            <p>O usuário pode cancelar a assinatura a qualquer momento, cessando as cobranças futuras. O acesso permanece ativo até o fim do ciclo já pago. Em caso de inadimplência, o acesso poderá ser <strong>suspenso após período de tolerância (grace period) de 3 dias</strong> e o ambiente desativado em caso de cancelamento da assinatura.</p>
          </section>

          <section>
            <h2>6. Responsabilidades do Usuário</h2>
            <p>O usuário responsabiliza-se pela veracidade das informações de imóveis e clientes cadastrados, pelo uso regular de seu registro CRECI, pelo cumprimento da legislação aplicável e por não utilizar a Plataforma para fins ilícitos, fraudulentos ou que violem direitos de terceiros.</p>
          </section>

          <section>
            <h2>7. Propriedade Intelectual</h2>
            <p>Todo o software, código-fonte, design, marca e materiais da Plataforma são protegidos pela <strong>Lei nº 9.609/1998</strong> (Lei do Software) e pela Lei nº 9.610/1998, sendo de titularidade exclusiva de [RAZÃO SOCIAL], CNPJ [CNPJ]. É vedada a cópia, engenharia reversa, sublicenciamento ou exploração não autorizada.</p>
          </section>

          <section>
            <h2>8. Limitação de Responsabilidade e SLA</h2>
            <p>A Plataforma é fornecida "no estado em que se encontra". Envidamos esforços para manter disponibilidade adequada, porém não garantimos operação ininterrupta. Não nos responsabilizamos por indisponibilidades de terceiros (Asaas, provedores de WhatsApp/IA, infraestrutura de nuvem) nem por lucros cessantes decorrentes de uso ou indisponibilidade do serviço.</p>
          </section>

          <section>
            <h2>9. Alterações</h2>
            <p>Estes Termos podem ser atualizados a qualquer tempo. Alterações relevantes serão comunicadas pelos canais cadastrados. O uso continuado após a alteração implica concordância.</p>
          </section>

          <section>
            <h2>10. Foro</h2>
            <p>Fica eleito o foro da Comarca de <strong>Goiânia/GO</strong> para dirimir quaisquer controvérsias decorrentes destes Termos, com renúncia a qualquer outro, por mais privilegiado que seja.</p>
          </section>

          <p className="text-white/40 text-xs pt-4 border-t border-white/10">
            Dúvidas: [E-MAIL DE CONTATO] · [RAZÃO SOCIAL] · CNPJ [CNPJ]
          </p>
        </div>
      </motion.div>
    </div>
  );
}
