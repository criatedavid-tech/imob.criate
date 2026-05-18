import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

export default function Privacidade() {
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
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white">Política de Privacidade</h1>
        </div>
        <p className="text-white/40 text-sm mb-8">Última atualização: [DATA] · Em conformidade com a LGPD (Lei nº 13.709/2018) e o Marco Civil da Internet (Lei nº 12.965/2014)</p>

        <div className="space-y-7 text-white/70 text-sm leading-relaxed [&_h2]:text-white [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-7 [&_h2]:mb-2 [&_strong]:text-white/90 [&_li]:ml-4 [&_li]:list-disc">
          <section>
            <h2>1. Controlador dos Dados</h2>
            <p><strong>[RAZÃO SOCIAL]</strong>, inscrita no CNPJ sob nº <strong>[CNPJ]</strong>, é a controladora dos dados pessoais tratados na Plataforma ImobiFlow. Encarregado(a) pelo Tratamento de Dados (DPO): <strong>[E-MAIL DO DPO]</strong>.</p>
          </section>

          <section>
            <h2>2. Base Legal (LGPD art. 7º e 9º)</h2>
            <p>O tratamento de dados fundamenta-se na <strong>execução de contrato</strong> (art. 7º, V), no <strong>cumprimento de obrigação legal/regulatória</strong> (art. 7º, II), no <strong>legítimo interesse</strong> (art. 7º, IX) e no <strong>consentimento</strong> do titular quando aplicável.</p>
          </section>

          <section>
            <h2>3. Dados Coletados</h2>
            <ul className="space-y-1">
              <li><strong>Identificação e contato:</strong> nome, e-mail, telefone/WhatsApp, CPF/CNPJ.</li>
              <li><strong>Dados profissionais:</strong> registro CRECI, dados da corretora representada.</li>
              <li><strong>Dados de pagamento:</strong> processados diretamente pelo Asaas — não armazenamos número completo de cartão.</li>
              <li><strong>Dados de uso:</strong> logs de acesso, endereço IP e registros de aplicação (Marco Civil, art. 7º e 15).</li>
              <li><strong>Dados de leads:</strong> informações de clientes finais inseridas pelo usuário/corretor.</li>
            </ul>
          </section>

          <section>
            <h2>4. Finalidades (LGPD art. 6º)</h2>
            <ul className="space-y-1">
              <li>Criar e gerenciar a conta do usuário;</li>
              <li>Processar a cobrança recorrente da assinatura;</li>
              <li>Enviar credenciais de acesso via WhatsApp e e-mail;</li>
              <li>Operar o atendimento automatizado por IA;</li>
              <li>Prestar suporte e cumprir obrigações legais e fiscais.</li>
            </ul>
          </section>

          <section>
            <h2>5. Compartilhamento</h2>
            <p>Os dados são compartilhados estritamente com operadores necessários à prestação do serviço: <strong>Asaas</strong> (processamento de pagamentos), provedor de <strong>infraestrutura em nuvem</strong>, plataforma de <strong>automação (n8n)</strong> e <strong>provedor de WhatsApp/IA</strong>. Não vendemos dados pessoais.</p>
          </section>

          <section>
            <h2>6. Direitos do Titular (LGPD art. 18)</h2>
            <p>O titular pode solicitar, a qualquer momento: confirmação de tratamento, acesso, correção, anonimização, portabilidade, eliminação e revogação de consentimento. Canal de exercício: <strong>[E-MAIL DO DPO]</strong>.</p>
          </section>

          <section>
            <h2>7. Retenção</h2>
            <p>Os dados são mantidos enquanto a conta estiver ativa e, após o encerramento, pelo prazo legal/fiscal de até <strong>5 anos</strong>, ou prazo superior exigido por lei.</p>
          </section>

          <section>
            <h2>8. Segurança</h2>
            <p>Adotamos medidas técnicas e administrativas como criptografia em trânsito (HTTPS/TLS), controle de acesso segregado por tenant e princípio do menor privilégio para proteger os dados contra acessos não autorizados.</p>
          </section>

          <section>
            <h2>9. Cookies e Rastreamento</h2>
            <p>A Plataforma utiliza cookies e armazenamento local estritamente necessários à autenticação e funcionamento da sessão. Não utilizamos cookies de publicidade de terceiros.</p>
          </section>

          <section>
            <h2>10. Transferência Internacional</h2>
            <p>Caso operadores estejam sediados no exterior, a transferência observará as salvaguardas do art. 33 da LGPD.</p>
          </section>

          <section>
            <h2>11. Alterações e Foro</h2>
            <p>Esta Política pode ser atualizada; alterações relevantes serão comunicadas. Fica eleito o foro da Comarca de <strong>Goiânia/GO</strong> para questões relativas a esta Política.</p>
          </section>

          <p className="text-white/40 text-xs pt-4 border-t border-white/10">
            Encarregado(a) / DPO: [E-MAIL DO DPO] · [RAZÃO SOCIAL] · CNPJ [CNPJ]
          </p>
        </div>
      </motion.div>
    </div>
  );
}
