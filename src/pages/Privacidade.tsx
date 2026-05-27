import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';

// ─── PREENCHER ANTES DE IR AO AR ────────────────────────────────────────────
const RAZAO_SOCIAL  = '[RAZÃO SOCIAL DA EMPRESA]';
const CNPJ          = '[CNPJ]';
const ENDERECO      = '[ENDEREÇO COMPLETO DA SEDE]';
const EMAIL_DPO     = '[E-MAIL DO DPO/ENCARREGADO]';
const EMAIL_CONTATO = '[E-MAIL DE CONTATO]';
const CIDADE_ESTADO = 'Goiânia/GO';
const DATA_VIGENCIA = '27 de maio de 2026';
// ────────────────────────────────────────────────────────────────────────────

export default function Privacidade() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 py-10 px-4 font-sans relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
      />

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
        <p className="text-white/40 text-sm mb-8">
          Vigência: {DATA_VIGENCIA} · Em conformidade com a LGPD (Lei nº 13.709/2018), Marco Civil da Internet
          (Lei nº 12.965/2014) e Decreto nº 8.771/2016
        </p>

        <div className="space-y-7 text-white/70 text-sm leading-relaxed [&_h2]:text-white [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-white/90 [&_ul]:mt-2 [&_ul]:space-y-1 [&_li]:ml-5 [&_li]:list-disc">

          <section>
            <h2>1. Controlador e Encarregado pelo Tratamento (DPO)</h2>
            <p>
              <strong>{RAZAO_SOCIAL}</strong>, CNPJ {CNPJ}, {ENDERECO}, é a{' '}
              <strong>controladora</strong> dos dados pessoais tratados na Plataforma Criate, nos termos do art. 5º,
              VI da <strong>Lei nº 13.709/2018</strong> (LGPD).
            </p>
            <p className="mt-2">
              <strong>Encarregado pelo Tratamento de Dados (DPO):</strong>{' '}
              <a href={`mailto:${EMAIL_DPO}`} className="underline">{EMAIL_DPO}</a> — responsável por atender
              solicitações de titulares, comunicar-se com a ANPD e orientar internamente o cumprimento da LGPD
              (art. 41). O Encarregado pode ser pessoa física ou jurídica.
            </p>
          </section>

          <section>
            <h2>2. Âmbito de Aplicação e Papéis de Tratamento</h2>
            <p>
              Esta Política aplica-se a todos os dados pessoais tratados no contexto da Plataforma, incluindo dados
              de: (a) corretores e usuários cadastrados; (b) representantes de corretoras; (c) visitantes das
              landing pages de imóveis geradas pela Plataforma.
            </p>
            <p className="mt-2">
              Dados de <strong>leads e clientes finais</strong> inseridos pelos corretores são tratados pelo próprio
              corretor na qualidade de <strong>controlador autônomo</strong> (art. 5º, VI da LGPD); a Criate atua
              como <strong>operadora</strong> para esses dados (art. 5º, VII e art. 39), processando-os apenas
              conforme instrução documentada do corretor/controlador.
            </p>
          </section>

          <section>
            <h2>3. Dados Pessoais Coletados</h2>
            <p>
              <strong>3.1 Identificação e contato:</strong> nome completo, CPF/CNPJ, e-mail, número de
              telefone/WhatsApp, foto de perfil (opcional).
            </p>
            <p className="mt-2">
              <strong>3.2 Dados profissionais:</strong> número de registro no CRECI, nome e endereço da corretora.
            </p>
            <p className="mt-2">
              <strong>3.3 Dados de pagamento:</strong> processados e armazenados diretamente pelo{' '}
              <strong>Asaas</strong>. A Criate recebe apenas confirmações transacionais (status de pagamento, ID de
              assinatura). O número completo do cartão de crédito <strong>nunca é armazenado</strong> pela Criate.
            </p>
            <p className="mt-2">
              <strong>3.4 Dados de conexão (Marco Civil, arts. 10 e 15):</strong> endereço IP, data e hora de
              início/fim de sessão, identificador de sessão, tipo de dispositivo e navegador. Mantidos por no mínimo{' '}
              <strong>6 meses</strong> (prazo legal obrigatório) e por até <strong>1 ano</strong> para fins de
              segurança e auditoria interna (Decreto nº 8.771/2016, art. 13).
            </p>
            <p className="mt-2">
              <strong>3.5 Dados gerados pelo uso:</strong> imóveis cadastrados, configurações de IA e de follow-up,
              histórico de conversas de leads (armazenado como operadora).
            </p>
            <p className="mt-2">
              <strong>3.6 Chave de API de terceiros:</strong> chave OpenRouter do corretor, armazenada em formato{' '}
              <strong>criptografado (AES-256)</strong>, nunca exposta em texto puro ou em logs.
            </p>
          </section>

          <section>
            <h2>4. Bases Legais e Finalidades (LGPD art. 7º)</h2>
            <p>Cada operação de tratamento possui base legal específica:</p>
            <ul>
              <li>
                <strong>Execução de contrato (art. 7º, V):</strong> criação e gestão de conta; provisionamento do
                canal WhatsApp; processamento da assinatura; envio de credenciais; operação do atendimento
                automatizado por IA.
              </li>
              <li>
                <strong>Cumprimento de obrigação legal (art. 7º, II):</strong> guarda de registros de conexão (Marco
                Civil art. 15); emissão e arquivamento de documentos fiscais; atendimento de determinações judiciais
                ou administrativas.
              </li>
              <li>
                <strong>Legítimo interesse (art. 7º, IX):</strong> prevenção de fraudes e abusos; segurança da
                plataforma; melhoria contínua do serviço com base em dados agregados e anonimizados. O legítimo
                interesse não prevalece quando causar prejuízo aos direitos e liberdades fundamentais do titular
                (art. 10, §1º).
              </li>
              <li>
                <strong>Consentimento (art. 7º, I):</strong> envio de comunicações de marketing; uso de cookies não
                essenciais. O consentimento pode ser revogado a qualquer tempo, sem prejuízo do tratamento já
                realizado com base nele (art. 8º, §5º).
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Dados Pessoais Sensíveis</h2>
            <p>
              A Plataforma <strong>não coleta intencionalmente</strong> dados pessoais sensíveis (art. 5º, II da LGPD),
              tais como origem racial ou étnica, convicção religiosa, dado genético, biométrico, relativo à saúde ou
              à vida sexual, ou filiação a organização de caráter político, sindical ou religioso. Caso o Usuário
              insira dados dessa natureza em campos de texto livre (p. ex., descrição de leads), deve garantir a base
              legal adequada (art. 11 LGPD) e responde exclusivamente por isso.
            </p>
          </section>

          <section>
            <h2>6. Proteção de Crianças e Adolescentes (LGPD art. 14)</h2>
            <p>
              A Plataforma é destinada exclusivamente a profissionais registrados no CRECI, sendo{' '}
              <strong>proibido o cadastro de menores de 18 anos</strong>. Dados de crianças identificados serão
              imediatamente excluídos. O tratamento de dados de menores em conversas de leads exige que o corretor
              obtenha consentimento específico dos responsáveis legais, conforme art. 14 da LGPD e art. 227 da
              Constituição Federal.
            </p>
          </section>

          <section>
            <h2>7. Registros de Conexão e Acesso — Marco Civil da Internet</h2>
            <p>
              Em conformidade com os <strong>arts. 10, 11 e 15 da Lei nº 12.965/2014</strong> e arts. 13–17 do{' '}
              <strong>Decreto nº 8.771/2016</strong>:
            </p>
            <ul>
              <li>
                <strong>Registros de conexão</strong> (data/hora, IP, porta lógica) são mantidos por no mínimo{' '}
                <strong>6 meses</strong>;
              </li>
              <li>
                <strong>Registros de acesso a aplicações</strong> são mantidos por no mínimo{' '}
                <strong>6 meses</strong>, podendo ser retidos por até <strong>1 ano</strong> para fins de segurança;
              </li>
              <li>
                Tais registros somente serão fornecidos a terceiros mediante <strong>ordem judicial</strong> ou
                requisição de autoridade legalmente competente (art. 10, §1º do Marco Civil);
              </li>
              <li>
                Os dados são armazenados em servidores hospedados no Brasil (Fly.io, região GRU — São Paulo),
                atendendo ao <strong>art. 11 do Marco Civil</strong> quando aplicável.
              </li>
            </ul>
          </section>

          <section>
            <h2>8. Decisões Automatizadas e Inteligência Artificial (LGPD art. 20)</h2>
            <p>
              A Plataforma utiliza modelos de linguagem (LLM via OpenRouter) para geração de respostas automáticas de
              atendimento. Em conformidade com o <strong>art. 20 da LGPD</strong>, o titular pode solicitar ao
              Encarregado ({EMAIL_DPO}):
            </p>
            <ul>
              <li>
                <strong>revisão</strong> de decisões tomadas unicamente com base em tratamento automatizado;
              </li>
              <li>
                <strong>informações claras</strong> sobre os critérios e procedimentos utilizados na decisão
                automatizada.
              </li>
            </ul>
            <p className="mt-2">
              A Criate mantém registro das versões de modelos e das configurações de prompt para fins de{' '}
              <strong>auditabilidade</strong>. O agente de IA não toma decisões que produzam efeitos jurídicos ou
              impacto significativo sem supervisão humana do corretor.
            </p>
          </section>

          <section>
            <h2>9. Compartilhamento e Operadores (LGPD art. 37)</h2>
            <p>
              Os dados são compartilhados exclusivamente com <strong>operadores</strong> vinculados por instrumento
              contratual (DPA) que impõe obrigações compatíveis com a LGPD (art. 37). Não vendemos dados pessoais.
            </p>
            <ul>
              <li>
                <strong>Supabase Inc.</strong> — banco de dados relacional e autenticação (PostgreSQL hospedado em
                infraestrutura com certificações de segurança);
              </li>
              <li>
                <strong>Asaas Gestão Financeira S.A.</strong> — processamento de pagamentos recorrentes;
              </li>
              <li>
                <strong>Fly.io Inc.</strong> — hospedagem da aplicação (região GRU, São Paulo);
              </li>
              <li>
                <strong>Z-PRO / UAZAPI</strong> — provisionamento de canal WhatsApp Business e entrega de mensagens;
              </li>
              <li>
                <strong>OpenRouter Inc.</strong> — inferência de modelos de linguagem (recebe apenas o conteúdo das
                conversas de atendimento, sem dados de identificação do Usuário);
              </li>
              <li>
                <strong>n8n / instância própria</strong> — automações de fluxo e webhooks internos.
              </li>
            </ul>
          </section>

          <section>
            <h2>10. Transferência Internacional de Dados (LGPD art. 33)</h2>
            <p>
              Alguns operadores listados na seção 9 estão sediados fora do Brasil. Em conformidade com o{' '}
              <strong>art. 33 da LGPD</strong> e as resoluções da ANPD, essas transferências observam pelo menos
              uma das seguintes salvaguardas:
            </p>
            <ul>
              <li>
                o país ou organismo internacional oferece <strong>grau de proteção adequado</strong> reconhecido pela
                ANPD (art. 33, I);
              </li>
              <li>
                o operador fornece <strong>garantias suficientes</strong> por meio de cláusulas contratuais padrão
                (SCCs) ou certificações reconhecidas (art. 33, II);
              </li>
              <li>
                a transferência é necessária para a <strong>execução do contrato</strong> firmado com o titular ou
                para a prestação de serviços em benefício do titular (art. 33, V).
              </li>
            </ul>
          </section>

          <section>
            <h2>11. Retenção e Eliminação de Dados (LGPD art. 16)</h2>
            <p>Os dados são mantidos pelo período necessário às finalidades que justificaram a coleta:</p>
            <ul>
              <li>
                <strong>Durante a vigência da conta:</strong> todos os dados necessários à prestação do serviço;
              </li>
              <li>
                <strong>Após o encerramento da conta:</strong> até <strong>5 anos</strong> para cumprimento de
                obrigações fiscais, tributárias e defesa em processos judiciais/administrativos (CTN art. 173; CC
                art. 206; Lei nº 9.430/1996);
              </li>
              <li>
                <strong>Registros de conexão/acesso:</strong> mínimo de <strong>6 meses</strong> (Marco Civil
                art. 15), podendo ser retidos por até <strong>1 ano</strong>;
              </li>
              <li>
                <strong>Dados de pagamento:</strong> conforme política própria do Asaas e obrigações da
                Resolução BCB nº 4.658/2018.
              </li>
            </ul>
            <p className="mt-2">
              Encerrado o prazo legal, os dados são <strong>eliminados de forma segura ou anonimizados</strong>,
              tornando-os não identificáveis de forma irreversível (LGPD art. 5º, XI e art. 16, §1º).
            </p>
          </section>

          <section>
            <h2>12. Medidas de Segurança (LGPD art. 46; Decreto nº 8.771/2016)</h2>
            <p>
              A Criate adota medidas técnicas e administrativas proporcionais ao risco:
            </p>
            <ul>
              <li>Criptografia em trânsito (<strong>HTTPS/TLS 1.2+</strong>) e em repouso;</li>
              <li>Senhas armazenadas com <strong>hash seguro</strong>; chaves de API com <strong>AES-256</strong>;</li>
              <li>Autenticação JWT com expiração e revogação de sessão;</li>
              <li>
                Isolamento por tenant — cada corretor acessa <em>exclusivamente</em> seus próprios dados (row-level
                security no banco);
              </li>
              <li>Princípio do menor privilégio na service role do banco de dados;</li>
              <li>Monitoramento contínuo de acessos e alertas de anomalia;</li>
              <li>Rate limiting e proteção contra força bruta nos endpoints sensíveis.</li>
            </ul>
          </section>

          <section>
            <h2>13. Incidentes de Segurança (LGPD art. 48; Resolução CD/ANPD nº 2/2022)</h2>
            <p>
              Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares, a Criate:
            </p>
            <ul>
              <li>
                comunicará a <strong>ANPD</strong> em prazo razoável, com informações sobre a natureza dos dados
                afetados, número de titulares impactados e medidas adotadas;
              </li>
              <li>
                comunicará os <strong>titulares afetados</strong> de maneira clara e objetiva, com orientações sobre
                como se proteger;
              </li>
              <li>adotará medidas de contenção e correção imediatas.</li>
            </ul>
            <p className="mt-2">
              Para reportar suspeitas de incidente: <a href={`mailto:${EMAIL_DPO}`} className="underline">{EMAIL_DPO}</a>.
            </p>
          </section>

          <section>
            <h2>14. Direitos do Titular (LGPD art. 18)</h2>
            <p>
              O titular dos dados pode exercer gratuitamente os seguintes direitos, mediante solicitação ao
              Encarregado ({EMAIL_DPO}):
            </p>
            <ul>
              <li>
                <strong>Confirmação e acesso (art. 18, I e II):</strong> saber se há tratamento e acessar os dados;
              </li>
              <li>
                <strong>Correção (art. 18, III):</strong> atualizar dados incompletos, inexatos ou desatualizados;
              </li>
              <li>
                <strong>Anonimização, bloqueio ou eliminação (art. 18, IV):</strong> de dados desnecessários ou
                tratados em desconformidade;
              </li>
              <li>
                <strong>Portabilidade (art. 18, V):</strong> receber dados em formato estruturado e
                interoperável, conforme regulamentação da ANPD;
              </li>
              <li>
                <strong>Eliminação de dados tratados com consentimento (art. 18, VI);</strong>
              </li>
              <li>
                <strong>Informação sobre compartilhamento (art. 18, VII):</strong> saber com quem os dados foram
                compartilhados;
              </li>
              <li>
                <strong>Informação sobre consequências da não-concessão do consentimento (art. 18, VIII);</strong>
              </li>
              <li>
                <strong>Revogação do consentimento (art. 18, IX):</strong> a qualquer tempo, sem ônus;
              </li>
              <li>
                <strong>Oposição (art. 18, §2º):</strong> ao tratamento baseado em legítimo interesse, quando
                não justificado;
              </li>
              <li>
                <strong>Revisão de decisão automatizada (art. 20).</strong>
              </li>
            </ul>
            <p className="mt-2">
              Prazo de resposta: até <strong>15 dias úteis</strong>, conforme orientação da ANPD. Respostas podem
              ser comunicadas ao e-mail cadastrado.
            </p>
          </section>

          <section>
            <h2>15. Cookies e Armazenamento Local</h2>
            <p>A Plataforma utiliza:</p>
            <ul>
              <li>
                <strong>Cookies de sessão estritamente necessários:</strong> token de autenticação JWT — sem eles o
                serviço não funciona;
              </li>
              <li>
                <strong>localStorage:</strong> dados de sessão para manutenção do login ativo no navegador.
              </li>
            </ul>
            <p className="mt-2">
              A Plataforma <strong>não utiliza</strong> cookies de rastreamento de terceiros, pixels de redes sociais
              ou ferramentas de analytics que transmitam dados a terceiros. Cookies de sessão podem ser removidos
              pelas configurações do navegador, ciente de que isso encerrará o acesso autenticado.
            </p>
          </section>

          <section>
            <h2>16. Reclamações à Autoridade Nacional de Proteção de Dados (ANPD)</h2>
            <p>
              O titular que considerar que um direito previsto na LGPD foi descumprido pode apresentar petição à{' '}
              <strong>ANPD</strong> (gov.br/anpd), sem prejuízo do recurso ao Poder Judiciário. Em relações de
              consumo, cabe também reclamação ao <strong>PROCON</strong> (procon.go.gov.br) e ao portal{' '}
              <strong>consumidor.gov.br</strong>.
            </p>
          </section>

          <section>
            <h2>17. Alterações a Esta Política</h2>
            <p>
              Esta Política poderá ser atualizada para refletir mudanças em nossas práticas, na legislação ou nas
              orientações da ANPD. Alterações relevantes serão comunicadas com antecedência mínima de{' '}
              <strong>15 dias</strong> via e-mail ou notificação na Plataforma. A versão vigente é sempre a
              publicada em <em>/privacidade</em>.
            </p>
          </section>

          <section>
            <h2>18. Foro</h2>
            <p>
              Para questões relativas a esta Política, fica eleito o foro da Comarca de{' '}
              <strong>{CIDADE_ESTADO}</strong>, com renúncia a qualquer outro.
            </p>
          </section>

          <p className="text-white/40 text-xs pt-4 border-t border-white/10">
            Encarregado / DPO: {EMAIL_DPO} · {RAZAO_SOCIAL} · CNPJ {CNPJ} · {ENDERECO} · {EMAIL_CONTATO}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
