import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { motion } from 'motion/react';
import Copyright from '../components/Copyright';

const RAZAO_SOCIAL   = 'Criate Tecnologia em Marketing e Vendas LTDA';
const CNPJ           = '54.236.008/0001-80';
const ENDERECO       = 'Rua 14, nº 201, Quadra B8, Lote 20, Sala 02, Setor Oeste, Goiânia/GO, CEP 74120-070';
const EMAIL_CONTATO  = 'criateoficial@gmail.com';
const EMAIL_DPO      = 'criateoficial@gmail.com';
const CIDADE_ESTADO  = 'Goiânia/GO';
const DATA_VIGENCIA  = '1º de julho de 2026';

export default function Termos() {
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
            <FileText className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white">Termos de Uso</h1>
        </div>
        <p className="text-white/40 text-sm mb-8">
          Vigência: {DATA_VIGENCIA} · Criate · {RAZAO_SOCIAL} · CNPJ {CNPJ}
        </p>

        <div className="space-y-7 text-white/70 text-sm leading-relaxed [&_h2]:text-white [&_h2]:font-bold [&_h2]:text-base [&_h2]:mt-8 [&_h2]:mb-3 [&_strong]:text-white/90 [&_ul]:mt-2 [&_ul]:space-y-1 [&_li]:ml-5 [&_li]:list-disc">

          <section>
            <h2>1. Identificação das Partes</h2>
            <p>
              <strong>Fornecedora:</strong> {RAZAO_SOCIAL}, pessoa jurídica de direito privado inscrita no CNPJ/ME sob o
              nº {CNPJ}, com sede em {ENDERECO}, doravante denominada <strong>"Criate"</strong> ou{' '}
              <strong>"Plataforma"</strong>.
            </p>
            <p className="mt-2">
              <strong>Usuário/Contratante:</strong> pessoa física ou jurídica que realiza o cadastro na Plataforma,
              obrigatoriamente habilitada como corretor(a) de imóveis com registro ativo no CRECI da respectiva
              seccional estadual, doravante denominada <strong>"Usuário"</strong>.
            </p>
          </section>

          <section>
            <h2>2. Objeto e Natureza Jurídica</h2>
            <p>
              O objeto deste instrumento é a <strong>licença de uso não exclusiva, intransferível e por tempo
              determinado</strong> do software <em>Criate</em>, disponibilizado em modelo SaaS (
              <em>Software as a Service</em>), com acesso exclusivamente pela internet, nos termos da{' '}
              <strong>Lei nº 9.609/1998</strong> (Lei do Software) e da <strong>Lei nº 9.610/1998</strong> (LDA). O
              contrato <strong>não transfere</strong> ao Usuário qualquer direito de propriedade sobre o software,
              código-fonte, algoritmos ou documentação. É vedada cessão, sublicenciamento ou exploração comercial a
              terceiros sem anuência escrita prévia da Criate.
            </p>
          </section>

          <section>
            <h2>3. Aceitação e Capacidade Civil</h2>
            <p>
              Ao clicar em <em>"Criar conta"</em> ou <em>"Concordar"</em>, o Usuário manifesta consentimento{' '}
              <strong>livre, informado e inequívoco</strong> nos termos do art. 8º do Marco Civil da Internet (
              <strong>Lei nº 12.965/2014</strong>) e declara:
            </p>
            <ul>
              <li>ter lido e compreendido integralmente estes Termos e a Política de Privacidade;</li>
              <li>ser maior de 18 anos e civilmente capaz (CC arts. 3–5);</li>
              <li>
                possuir <strong>registro ativo e regular no CRECI</strong> para exercício da atividade de corretagem
                imobiliária (Lei nº 6.530/1978 e Resolução-COFECI nº 1.426/2020);
              </li>
              <li>agir em nome próprio ou estar devidamente autorizado a representar pessoa jurídica.</li>
            </ul>
          </section>

          <section>
            <h2>4. Cadastro e Segurança da Conta</h2>
            <p>
              O Usuário obriga-se a fornecer dados <strong>verídicos, completos e atualizados</strong>, respondendo
              civil e criminalmente pela falsidade de informações (CC art. 186; CP arts. 171 e 299). São de
              responsabilidade exclusiva do Usuário:
            </p>
            <ul>
              <li>a guarda e confidencialidade de suas credenciais de acesso;</li>
              <li>toda atividade realizada sob sua conta;</li>
              <li>
                notificar a Criate imediatamente sobre acesso não autorizado pelo canal {EMAIL_CONTATO}.
              </li>
            </ul>
          </section>

          <section>
            <h2>5. Planos, Cobrança Recorrente e Reajuste</h2>
            <p>
              A Plataforma é oferecida mediante <strong>assinatura mensal recorrente</strong> processada pelo gateway{' '}
              <strong>Asaas</strong> (Asaas Gestão Financeira S.A.). Condições:
            </p>
            <ul>
              <li>
                A cobrança é <strong>automática</strong> no cartão de crédito cadastrado a cada ciclo mensal, com{' '}
                <strong>renovação automática</strong> até cancelamento expresso;
              </li>
              <li>
                O valor vigente é exibido no momento da contratação; reajustes serão comunicados com{' '}
                <strong>antecedência mínima de 30 dias</strong>;
              </li>
              <li>
                Reajustes anuais podem ser aplicados com base na variação do <strong>IPCA</strong> (IBGE) do período,
                independentemente de nova notificação, desde que informados previamente;
              </li>
              <li>
                Em caso de recusa de cobrança, o Usuário terá <strong>3 dias corridos (grace period)</strong> para
                regularização antes da suspensão.
              </li>
            </ul>
          </section>

          <section>
            <h2>6. Direito de Arrependimento (CDC art. 49)</h2>
            <p>
              O Usuário que contrate como <strong>consumidor pessoa física</strong> poderá exercer o direito de
              arrependimento no prazo de <strong>7 dias corridos</strong> contados da contratação realizada por meio
              eletrônico, nos termos do <strong>art. 49 do CDC (Lei nº 8.078/1990)</strong> e do{' '}
              <strong>art. 5º do Decreto nº 7.962/2013</strong>. A solicitação deve ser enviada a {EMAIL_CONTATO} com
              indicação do e-mail cadastrado, e os valores pagos serão restituídos integralmente. Após esse prazo,
              cancelamentos produzem efeito ao término do ciclo de faturamento vigente.
            </p>
          </section>

          <section>
            <h2>7. Cancelamento, Suspensão e Rescisão</h2>
            <p>
              O Usuário pode cancelar a assinatura a qualquer momento pelo painel ou por {EMAIL_CONTATO}. A Criate
              pode suspender ou rescindir imediatamente o acesso nas seguintes hipóteses:
            </p>
            <ul>
              <li>violação de qualquer cláusula destes Termos;</li>
              <li>uso para fins ilícitos, fraudulentos ou que violem direitos de terceiros;</li>
              <li>inadimplência superior ao grace period;</li>
              <li>cassação, suspensão ou irregularidade do registro CRECI;</li>
              <li>
                prática de atos incompatíveis com a <strong>Lei nº 13.709/2018</strong> (LGPD) em relação aos dados de
                leads inseridos na Plataforma;
              </li>
              <li>
                envio de mensagens de cunho spam, enganoso, discriminatório ou proibido pelas{' '}
                <strong>Políticas do WhatsApp Business (Meta Platforms, Inc.)</strong>.
              </li>
            </ul>
          </section>

          <section>
            <h2>8. Obrigações do Usuário</h2>
            <ul>
              <li>utilizar a Plataforma exclusivamente para fins lícitos, éticos e nos limites contratados;</li>
              <li>manter registro CRECI ativo durante toda a vigência da assinatura;</li>
              <li>
                obter <strong>base legal adequada</strong> (em regra, consentimento) dos leads/clientes finais para o
                tratamento de seus dados pessoais pela Plataforma, nos termos da LGPD;
              </li>
              <li>
                manter informações de imóveis verídicas e atualizadas, cumprindo as normas do{' '}
                <strong>COFECI/CRECI</strong> sobre publicidade imobiliária (Res. COFECI nº 458/1995);
              </li>
              <li>
                não realizar engenharia reversa, descompilação, desmontagem ou tentativa de acesso ao código-fonte da
                Plataforma (Lei nº 9.609/1998 art. 6º);
              </li>
              <li>não contornar mecanismos de segurança, autenticação ou controle de acesso;</li>
              <li>não sobrecarregar intencionalmente a infraestrutura (ataques DoS/DDoS);</li>
              <li>não utilizar crawlers, bots ou scrapers não autorizados.</li>
            </ul>
          </section>

          <section>
            <h2>9. Propriedade Intelectual</h2>
            <p>
              Todo o software, código-fonte, algoritmos, modelos de IA, interfaces, banco de dados, marcas, logotipos
              e demais ativos intelectuais da Plataforma são de <strong>titularidade exclusiva da Criate</strong>,
              protegidos nos termos da <strong>Lei nº 9.609/1998</strong> e da <strong>Lei nº 9.610/1998</strong>,
              com vigência de 70 anos contados da publicação. Nenhuma disposição destes Termos transfere ao Usuário
              qualquer direito de propriedade intelectual.
            </p>
            <p className="mt-2">
              Os <strong>dados e conteúdos inseridos pelo Usuário</strong> (imóveis, fotos, informações de leads)
              permanecem de sua titularidade. Ao inseri-los, o Usuário outorga à Criate licença não exclusiva para
              armazená-los, processá-los e exibi-los <em>exclusivamente</em> na prestação do serviço contratado.
            </p>
          </section>

          <section>
            <h2>10. Uso de Inteligência Artificial</h2>
            <p>
              A Plataforma inclui agente de atendimento automatizado por IA (modelos de linguagem via OpenRouter). O
              Usuário reconhece que:
            </p>
            <ul>
              <li>
                respostas geradas por IA têm caráter auxiliar e não substituem orientação jurídica, técnica ou de
                especialistas;
              </li>
              <li>
                o Usuário é o <strong>responsável final</strong> por todo conteúdo enviado aos seus clientes via IA,
                nos termos do <strong>Marco Civil da Internet, art. 18</strong>;
              </li>
              <li>
                conforme o <strong>art. 20 da LGPD</strong>, clientes podem solicitar explicação sobre decisões
                automatizadas — o Usuário deve acionar o canal {EMAIL_DPO} para obter as informações cabíveis;
              </li>
              <li>a Criate adota medidas técnicas para mitigar erros e vieses, mas não garante precisão absoluta.</li>
            </ul>
          </section>

          <section>
            <h2>11. Proteção de Dados Pessoais</h2>
            <p>
              O tratamento de dados pessoais do Usuário é regido pela{' '}
              <strong>Política de Privacidade</strong> da Plataforma (disponível em <em>/privacidade</em>),
              incorporada a estes Termos por referência. O Usuário, ao inserir dados de{' '}
              <strong>leads e clientes finais</strong> na Plataforma, atua como{' '}
              <strong>controlador autônomo</strong> perante a LGPD, sendo responsável pela licitude do tratamento
              (art. 7º). A Criate atua como <strong>operadora</strong> para esses dados e se compromete a
              processá-los apenas conforme instrução do Usuário/controlador (art. 39 LGPD).
            </p>
          </section>

          <section>
            <h2>12. Direitos Assegurados pelo Marco Civil da Internet</h2>
            <p>
              Em observância ao <strong>art. 7º da Lei nº 12.965/2014</strong>, são assegurados ao Usuário:
            </p>
            <ul>
              <li>
                inviolabilidade e sigilo de suas comunicações pela Plataforma, salvo por ordem judicial;
              </li>
              <li>
                não fornecimento de seus dados a terceiros, salvo mediante consentimento ou determinação legal;
              </li>
              <li>informações claras e completas sobre o serviço contratado (art. 7º, XI);</li>
              <li>
                não suspensão da conta por fatos alheios ao uso da Plataforma (art. 7º, IV).
              </li>
            </ul>
          </section>

          <section>
            <h2>13. Disponibilidade, Manutenção e SLA</h2>
            <p>
              A Criate envidará seus melhores esforços para garantir disponibilidade adequada, sem obrigação de SLA
              mínimo garantido nos planos básicos. Manutenções programadas serão comunicadas com{' '}
              <strong>antecedência mínima de 12 horas</strong> pelos canais cadastrados. Indisponibilidades causadas
              por terceiros (Asaas, Meta/WhatsApp, provedores de nuvem, provedores de IA) estão fora do controle da
              Criate e configuram hipótese de <strong>caso fortuito ou força maior</strong> (CC art. 393).
            </p>
          </section>

          <section>
            <h2>14. Limitação de Responsabilidade</h2>
            <p>
              Na extensão máxima permitida pelo Direito brasileiro, a responsabilidade total da Criate limita-se ao
              valor pago nos últimos <strong>3 meses</strong> de assinatura. Não há responsabilidade por:
            </p>
            <ul>
              <li>lucros cessantes, danos indiretos ou perda de negócios por fatos imputáveis ao Usuário;</li>
              <li>conteúdo de comunicações enviadas por leads/terceiros via Plataforma;</li>
              <li>descumprimento dos termos do WhatsApp Business pela conduta do Usuário;</li>
              <li>uso indevido ou não autorizado da conta pelo Usuário ou terceiros a ele vinculados.</li>
            </ul>
            <p className="mt-2">
              Não há exclusão de responsabilidade por <strong>dolo ou culpa grave</strong> da Criate (CDC art. 25;
              CC art. 422).
            </p>
          </section>

          <section>
            <h2>15. Informações Obrigatórias — Comércio Eletrônico (Decreto nº 7.962/2013)</h2>
            <p>
              Em conformidade com o <strong>Decreto nº 7.962/2013</strong> (regulamenta o CDC para o comércio
              eletrônico), a Criate disponibiliza:
            </p>
            <ul>
              <li>
                <strong>Identificação:</strong> {RAZAO_SOCIAL}, CNPJ {CNPJ}, {ENDERECO};
              </li>
              <li>
                <strong>Contato:</strong> {EMAIL_CONTATO};
              </li>
              <li>
                <strong>Características do serviço</strong> e valor disponíveis no ato da contratação;
              </li>
              <li>
                <strong>Confirmação de contratação</strong> enviada ao e-mail cadastrado;
              </li>
              <li>
                <strong>Sumário do contrato</strong> antes da conclusão da compra.
              </li>
            </ul>
          </section>

          <section>
            <h2>16. Comunicações</h2>
            <p>
              A Criate comunicará o Usuário pelo e-mail e WhatsApp informados no cadastro. Notificações legais devem
              ser enviadas a {EMAIL_CONTATO}. O Usuário autoriza comunicações de cunho operacional, de segurança e
              contratual. Para comunicações de marketing, o Usuário poderá cancelar a qualquer momento (
              <em>opt-out</em>).
            </p>
          </section>

          <section>
            <h2>17. Cessão e Subcontratação</h2>
            <p>
              A Criate pode ceder ou subcontratar parcialmente obrigações a terceiros, mantendo responsabilidade
              solidária. O Usuário não pode ceder sua conta ou os direitos derivados destes Termos sem anuência
              expressa e por escrito da Criate.
            </p>
          </section>

          <section>
            <h2>18. Alterações nos Termos</h2>
            <p>
              A Criate poderá revisar estes Termos a qualquer tempo. Alterações relevantes serão comunicadas com
              antecedência mínima de <strong>30 dias</strong> pelo e-mail ou WhatsApp cadastrado. O uso continuado
              após a data de vigência implica concordância tácita. Em caso de discordância, o Usuário poderá
              rescindir sem multa até a data de vigência das alterações.
            </p>
          </section>

          <section>
            <h2>19. Disposições Gerais</h2>
            <ul>
              <li>
                <strong>Integralidade:</strong> estes Termos e a Política de Privacidade constituem o acordo integral
                entre as partes;
              </li>
              <li>
                <strong>Nulidade parcial:</strong> a invalidade de qualquer cláusula não contamina as demais (CC
                art. 184);
              </li>
              <li>
                <strong>Tolerância:</strong> o não exercício de qualquer direito não importa renúncia;
              </li>
              <li>
                <strong>Independência:</strong> as partes são independentes — não há relação de emprego, mandato ou
                sociedade.
              </li>
            </ul>
          </section>

          <section>
            <h2>20. Resolução de Conflitos e Foro</h2>
            <p>
              As partes comprometem-se a buscar solução amigável. A Criate pode instaurar procedimento de{' '}
              <strong>mediação (Lei nº 13.140/2015)</strong> antes do ajuizamento de ação judicial. Persistindo o
              conflito, fica eleito o foro da Comarca de <strong>{CIDADE_ESTADO}</strong>, com renúncia expressa a
              qualquer outro foro, por mais privilegiado que seja.
            </p>
          </section>

          <p className="text-white/40 text-xs pt-4 border-t border-white/10">
            {RAZAO_SOCIAL} · CNPJ {CNPJ} · {ENDERECO} · Contato: {EMAIL_CONTATO}
          </p>
          <Copyright />
        </div>
      </motion.div>
    </div>
  );
}
