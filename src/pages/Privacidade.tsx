import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { motion } from 'motion/react';
import Copyright from '../components/Copyright';

const RAZAO_SOCIAL  = 'Criate Tecnologia em Marketing e Vendas LTDA';
const CNPJ          = '54.236.008/0001-80';
const ENDERECO      = 'Rua 14, nº 201, Quadra B8, Lote 20, Sala 02, Setor Oeste, Goiânia/GO, CEP 74120-070';
const NOME_DPO      = 'Hiago Vieira';
const CARGO_DPO     = 'Proprietário';
const EMAIL_DPO     = 'criateoficial@gmail.com';
const EMAIL_CONTATO = 'criateoficial@gmail.com';
const CIDADE_ESTADO = 'Goiânia/GO';
const DATA_VIGENCIA = '11 de agosto de 2026';

export default function Privacidade() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen app-bg py-10 px-4 font-sans relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 max-w-3xl mx-auto rounded-[32px] p-8 md:p-12
          backdrop-blur-2xl bg-[var(--control-fill-hover)] border border-[var(--glass-border)]
          shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_24px_64px_rgba(0,0,0,0.4)]"
      >
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-[var(--text-mid)] hover:text-[var(--text-hi)] mb-8 transition-all"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center backdrop-blur-md bg-[var(--control-fill-hover)] border border-[var(--glass-border-strong)]">
            <ShieldCheck className="w-5 h-5 text-[var(--text-hi)]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-[var(--text-hi)]">Política de Privacidade</h1>
        </div>
        <p className="text-[var(--text-low)] text-sm mb-8">
          Vigência: {DATA_VIGENCIA} · Em conformidade com a LGPD (Lei nº 13.709/2018), Marco Civil da Internet
          (Lei nº 12.965/2014) e Decreto nº 8.771/2016
        </p>

        <div className="space-y-7 text-[var(--text-mid)] text-sm leading-relaxed [&_h2]:text-[var(--text-hi)] [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-[var(--text-hi)] [&_ul]:mt-2 [&_ul]:space-y-1 [&_li]:ml-5 [&_li]:list-disc">

          <section>
            <h2>1. Controlador e Encarregado pelo Tratamento (DPO)</h2>
            <p>
              <strong>{RAZAO_SOCIAL}</strong>, CNPJ {CNPJ}, {ENDERECO}, é a{' '}
              <strong>controladora</strong> dos dados pessoais tratados na Plataforma ImobiFlow, nos termos do art. 5º,
              VI da <strong>Lei nº 13.709/2018</strong> (LGPD).
            </p>
            <p className="mt-2">
              <strong>Encarregado pelo Tratamento de Dados (DPO):</strong> {NOME_DPO}, {CARGO_DPO}. Contato:{' '}
              <a href={`mailto:${EMAIL_DPO}`} className="underline">{EMAIL_DPO}</a>. O Encarregado é responsável por atender
              solicitações de titulares, comunicar-se com a ANPD e orientar internamente o cumprimento da LGPD
              (art. 41 da LGPD e Resolução CD/ANPD nº 18/2024).
            </p>
          </section>

          <section>
            <h2>2. Âmbito de Aplicação e Papéis de Tratamento</h2>
            <p>
              Esta Política aplica-se a todos os dados pessoais tratados no contexto da Plataforma, incluindo dados
              de: (a) corretores e demais usuários cadastrados; (b) representantes e integrantes de imobiliárias e
              incorporadoras; (c) visitantes das
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
              <strong>3.1 Identificação e contato:</strong> nome, e-mail, número de telefone/WhatsApp e tipo de conta.
              CPF/CNPJ e endereço podem ser solicitados no fluxo de contratação e pagamento.
            </p>
            <p className="mt-2">
              <strong>3.2 Dados profissionais e organizacionais:</strong> nome, endereço e informações de configuração
              da corretora, imobiliária ou incorporadora, quando fornecidos pelo usuário.
            </p>
            <p className="mt-2">
              <strong>3.3 Dados de pagamento:</strong> processados e armazenados diretamente pelo{' '}
              <strong>Asaas</strong>. A Criate recebe apenas confirmações transacionais (status de pagamento, ID de
              assinatura). O número completo do cartão de crédito <strong>nunca é armazenado</strong> pela Criate.
            </p>
            <p className="mt-2">
              <strong>3.4 Dados técnicos e de acesso:</strong> endereço IP, data e hora de acesso, rota acessada,
              identificadores técnicos de sessão, tipo de dispositivo e navegador, quando gerados pela aplicação ou
              por seus provedores de infraestrutura para autenticação, segurança, prevenção de abuso e cumprimento
              de obrigações legais.
            </p>
            <p className="mt-2">
              <strong>3.5 Dados gerados pelo uso:</strong> imóveis cadastrados, configurações de IA e de follow-up,
              agenda, contatos, histórico de conversas de leads, mensagens, notas, arquivos, imagens, áudios e
              transcrições necessários às funcionalidades utilizadas (armazenados como operadora quando relativos
              aos leads e clientes do usuário).
            </p>
            <p className="mt-2">
              <strong>3.6 Chave de API de terceiros:</strong> chave OpenRouter do corretor, armazenada em formato{' '}
              <strong>criptografado (AES-256)</strong>, nunca exposta em texto puro ou em logs.
            </p>
            <p className="mt-2">
              <strong>3.7 Google Agenda:</strong> quando o usuário opta pela sincronização bidirecional, o ImobiFlow
              recebe um token OAuth e trata os títulos, descrições, datas, horários e identificadores dos eventos da
              agenda secundária criada pelo próprio aplicativo. O escopo utilizado é{' '}
              <code>calendar.app.created</code>; ele não concede acesso à agenda principal nem aos outros calendários
              pessoais do usuário.
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
                <strong>Cumprimento de obrigação legal (art. 7º, II):</strong> guarda de registros de acesso (Marco
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
                <strong>Consentimento (art. 7º, I):</strong> envio de comunicações de marketing e outras finalidades
                opcionais que venham a ser apresentadas de forma destacada. O consentimento pode ser revogado a
                qualquer tempo, sem prejuízo do tratamento já
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
              A Plataforma é destinada a profissionais e representantes de empresas do setor imobiliário, sendo{' '}
              <strong>proibido o cadastro de menores de 18 anos</strong>. Caso dados de crianças ou adolescentes sejam
              inseridos em conversas ou cadastros de leads, o usuário controlador deverá observar o melhor interesse
              do titular e possuir base legal adequada, nos termos do art. 14 da LGPD.
            </p>
          </section>

          <section>
            <h2>7. Registros de Conexão e Acesso — Marco Civil da Internet</h2>
            <p>
              Em conformidade com os <strong>arts. 10, 11 e 15 da Lei nº 12.965/2014</strong> e com o{' '}
              <strong>Decreto nº 8.771/2016</strong>:
            </p>
            <ul>
              <li>
                <strong>Registros de acesso à aplicação</strong>, compostos por data, hora e endereço IP, são mantidos
                sob sigilo e em ambiente controlado pelo prazo legal de <strong>6 meses</strong>, quando aplicável;
              </li>
              <li>
                Tais registros somente serão fornecidos a terceiros mediante <strong>ordem judicial</strong> ou
                requisição de autoridade legalmente competente (art. 10, §1º do Marco Civil);
              </li>
              <li>
                A aplicação principal é executada na região GRU da Fly.io. Alguns operadores podem processar ou
                armazenar dados em outras jurisdições, conforme descrito na seção 10.
              </li>
            </ul>
          </section>

          <section>
            <h2>8. Decisões Automatizadas e Inteligência Artificial (LGPD art. 20)</h2>
            <p>
              A Plataforma utiliza modelos de linguagem e recursos de transcrição ou análise de mídia via OpenRouter
              para gerar respostas e executar funcionalidades solicitadas. Conforme o recurso utilizado, mensagens,
              imagens, áudios, transcrições e contexto do atendimento podem ser enviados ao provedor e podem conter
              dados pessoais inseridos pelo usuário ou pelo lead. Em conformidade com o <strong>art. 20 da LGPD</strong>,
              o titular pode solicitar ao
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
              A Criate mantém configurações técnicas necessárias à operação e à auditabilidade do agente. O agente de
              IA não deve tomar decisões que produzam efeitos jurídicos ou
              impacto significativo sem supervisão humana do corretor.
            </p>
          </section>

          <section>
            <h2>9. Compartilhamento e Operadores (LGPD art. 37)</h2>
            <p>
              Os dados são compartilhados com fornecedores necessários à prestação, segurança e cobrança do serviço,
              de acordo com suas funções e instruções contratuais. A Criate não vende dados pessoais.
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
                <strong>UAZAPI</strong> — provisionamento de canal WhatsApp Business e entrega de mensagens;
              </li>
              <li>
                <strong>OpenRouter Inc.</strong> — inferência de modelos de linguagem, transcrição e análise de mídia;
              </li>
              <li>
                <strong>n8n / instância própria</strong> — automações de fluxo e webhooks internos.
              </li>
              <li>
                <strong>Google Calendar API</strong> — sincronização opcional de eventos exclusivamente na agenda
                secundária criada pelo ImobiFlow, após autorização expressa do usuário;
              </li>
              <li>
                <strong>Upstash / Redis</strong> — filas, coordenação de processamento, limitação de requisições e
                armazenamento técnico temporário necessário à estabilidade do serviço;
              </li>
              <li>
                <strong>Sentry</strong> — monitoramento de erros de produção. A integração é configurada para remover
                corpo de requisição, cabeçalhos, cookies, parâmetros de consulta, endereço IP e identificação do usuário
                antes do envio dos eventos.
              </li>
            </ul>
          </section>

          <section>
            <h2>9.1 Uso de dados da API do Google</h2>
            <p>
              O uso e a transferência, pelo ImobiFlow, de informações recebidas das APIs do Google obedecem à{' '}
              <strong>Google API Services User Data Policy</strong>, inclusive aos requisitos de <em>Limited Use</em>.
              Esses dados são usados somente para exibir e sincronizar os compromissos solicitados pelo usuário e não
              são utilizados para publicidade, venda de dados ou treinamento de modelos de inteligência artificial.
            </p>
            <p className="mt-2">
              O token de acesso permanece protegido no servidor. O usuário pode interromper a integração na opção
              <strong> Agenda → Sincronizar calendário → Desconectar Google</strong>. A desconexão revoga a autorização,
              remove as credenciais armazenadas pelo ImobiFlow e interrompe as sincronizações futuras.
            </p>
          </section>

          <section>
            <h2>10. Transferência Internacional de Dados (LGPD art. 33)</h2>
            <p>
              Alguns operadores listados na seção 9 estão sediados fora do Brasil ou utilizam infraestrutura em outras
              jurisdições. Essas operações caracterizam ou podem caracterizar transferência internacional de dados e
              devem observar o <strong>art. 33 da LGPD</strong> e a{' '}
              <strong>Resolução CD/ANPD nº 19/2024</strong>, mediante o mecanismo legal aplicável, incluindo:
            </p>
            <ul>
              <li>
                decisão de adequação reconhecida pela ANPD, quando existente e aplicável;
              </li>
              <li>
                cláusulas-padrão contratuais aprovadas pela ANPD ou outro instrumento admitido pela regulamentação;
              </li>
              <li>
                outra hipótese prevista no art. 33 da LGPD, quando demonstrada para a operação específica.
              </li>
            </ul>
            <p className="mt-2">
              Informações sobre países de destino, fornecedores envolvidos e mecanismo utilizado podem ser solicitadas
              ao Encarregado.
            </p>
          </section>

          <section>
            <h2>11. Retenção e Eliminação de Dados (LGPD art. 16)</h2>
            <p>Os dados são mantidos pelo período necessário às finalidades que justificaram a coleta:</p>
            <ul>
              <li>
                <strong>Durante a vigência da conta:</strong> todos os dados necessários à prestação do serviço;
              </li>
              <li>
                <strong>Após o encerramento da conta:</strong> o conteúdo operacional será eliminado ou anonimizado,
                ressalvados os dados que precisem ser conservados para cumprimento de obrigação legal, exercício
                regular de direitos e prevenção de fraude, pelos prazos aplicáveis a cada finalidade;
              </li>
              <li>
                <strong>Registros de acesso à aplicação:</strong> <strong>6 meses</strong>, ressalvada ordem de
                preservação ou outra obrigação legal aplicável (Marco Civil, art. 15);
              </li>
              <li>
                <strong>Dados de pagamento:</strong> conforme os prazos legais e a política própria do Asaas;
              </li>
              <li>
                <strong>Dados técnicos temporários no Redis:</strong> pelo tempo necessário ao processamento da fila,
                limitação de requisições ou expiração técnica configurada;
              </li>
              <li>
                <strong>Eventos de erro no Sentry:</strong> conforme a retenção configurada no projeto de monitoramento,
                limitada ao necessário para diagnóstico e correção.
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
              <li>Isolamento lógico por conta e por usuário mediante autenticação e controles de autorização no backend;</li>
              <li>Segredos e credenciais administrativas mantidos apenas no ambiente do servidor;</li>
              <li>Monitoramento de erros de produção com filtros de privacidade;</li>
              <li>Rate limiting e proteção contra força bruta nos endpoints sensíveis.</li>
            </ul>
          </section>

          <section>
            <h2>13. Incidentes de Segurança (LGPD art. 48; Resolução CD/ANPD nº 15/2024)</h2>
            <p>
              Em caso de incidente de segurança que possa acarretar risco ou dano relevante aos titulares, a Criate:
            </p>
            <ul>
              <li>
                comunicará a <strong>ANPD</strong> e os titulares afetados no prazo de <strong>3 dias úteis</strong>,
                contado do conhecimento do incidente pelo controlador, quando o evento puder acarretar risco ou dano
                relevante, ressalvado prazo específico previsto em lei;
              </li>
              <li>
                apresentará aos <strong>titulares afetados</strong> informações claras sobre a natureza e os riscos do
                incidente, as medidas adotadas e orientações para proteção;
              </li>
              <li>adotará medidas de contenção e correção e manterá registro do incidente pelo prazo regulamentar mínimo de 5 anos.</li>
            </ul>
            <p className="mt-2">
              Para reportar suspeitas de incidente: <a href={`mailto:${EMAIL_DPO}`} className="underline">{EMAIL_DPO}</a>.
            </p>
          </section>

          <section>
            <h2>14. Direitos do Titular (LGPD art. 18)</h2>
            <p>
              O titular dos dados pode exercer gratuitamente os seguintes direitos, mediante solicitação ao
              Encarregado ({NOME_DPO}, {EMAIL_DPO}):
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
              A confirmação e o acesso simplificado serão providenciados imediatamente quando possível. A declaração
              clara e completa prevista no art. 19, II, da LGPD será fornecida em até <strong>15 dias corridos</strong>,
              contados do requerimento. Os demais pedidos serão atendidos nos prazos legais ou regulamentares aplicáveis.
            </p>
          </section>

          <section>
            <h2>15. Cookies e Armazenamento Local</h2>
            <p>A aplicação web utiliza:</p>
            <ul>
              <li>
                <strong>sessionStorage:</strong> token de autenticação e dados mínimos da sessão para manutenção do
                login, isolados por aba do navegador e removidos no encerramento da sessão correspondente.
              </li>
            </ul>
            <p className="mt-2">
              A Plataforma <strong>não utiliza</strong> cookies de rastreamento de terceiros, pixels de redes sociais
              ou ferramentas de publicidade comportamental. O Sentry é utilizado exclusivamente para diagnóstico de
              erros, com os filtros de privacidade descritos nesta Política.
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
              <strong>{CIDADE_ESTADO}</strong>, ressalvadas as hipóteses de competência legal obrigatória e o direito
              do consumidor de recorrer ao foro de seu domicílio quando aplicável.
            </p>
          </section>

          <p className="text-[var(--text-low)] text-xs pt-4 border-t border-[var(--hairline)]">
            Encarregado / DPO: {NOME_DPO}, {CARGO_DPO} · {EMAIL_DPO} · {RAZAO_SOCIAL} · CNPJ {CNPJ} · {ENDERECO} · {EMAIL_CONTATO}
          </p>
          <Copyright />
        </div>
      </motion.div>
    </div>
  );
}
