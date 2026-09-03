/**
 * Mesmo problema documentado em publicAboutPage.ts: o verificador de branding
 * do Google não garante execução de JavaScript, então a rota /privacidade
 * (React puro, SPA) chegava até ele como um <div id="root"></div> vazio —
 * a política real (Privacidade.tsx) é extensa e correta, mas invisível pra
 * quem não roda o bundle. O Google sinalizou isso como "não tem conteúdo
 * suficiente" na verificação de marca de 11/08/2026 (ver NEXT_TASK.md).
 *
 * Esta versão sem JavaScript resume, com o MESMO texto legal das seções mais
 * relevantes de Privacidade.tsx (controlador, dados coletados, base legal,
 * compartilhamento — com destaque pro item do Google Calendar/Limited Use —,
 * retenção e direitos do titular), o suficiente pra um crawler que só lê
 * HTML entender a coleta e o uso de dados sem precisar rodar React. Quando
 * o bundle carrega, o React substitui normalmente o conteúdo de #root pela
 * página completa (18 seções). Se o texto de Privacidade.tsx mudar de forma
 * relevante nessas seções, revisar este resumo junto.
 */
const RAZAO_SOCIAL = "Criate Tecnologia em Marketing e Vendas LTDA";
const CNPJ = "54.236.008/0001-80";
const EMAIL_DPO = "criateoficial@gmail.com";

const PUBLIC_PRIVACY_MARKUP = `
  <main id="public-privacy-static">
    <header>
      <strong>ImobiFlow</strong>
      <nav aria-label="Links institucionais">
        <a href="/sobre">Sobre</a>
        <a href="/termos">Termos de Uso</a>
        <a href="mailto:${EMAIL_DPO}">Suporte</a>
      </nav>
    </header>
    <section>
      <h1>Política de Privacidade</h1>
      <p>
        Esta política é publicada pela <strong>${RAZAO_SOCIAL}</strong>, CNPJ ${CNPJ},
        controladora dos dados pessoais tratados na Plataforma ImobiFlow nos termos da
        Lei nº 13.709/2018 (LGPD). Dúvidas ou solicitações sobre dados pessoais podem
        ser enviadas ao Encarregado (DPO) em
        <a href="mailto:${EMAIL_DPO}">${EMAIL_DPO}</a>.
      </p>

      <h2>Quais dados coletamos</h2>
      <p>
        Identificação e contato (nome, e-mail, telefone/WhatsApp); dados profissionais
        da corretora, imobiliária ou incorporadora; confirmações de pagamento recebidas
        do processador Asaas (o número do cartão nunca é armazenado por nós); dados
        técnicos e de acesso (IP, data/hora, dispositivo) usados para autenticação e
        segurança; e dados gerados pelo uso da Plataforma, como imóveis cadastrados,
        agenda, contatos e histórico de conversas com leads.
      </p>

      <h2>Google Agenda</h2>
      <p>
        Quando o usuário opta pela sincronização com o Google Agenda, o ImobiFlow
        recebe um token OAuth e trata apenas os títulos, descrições, datas, horários
        e identificadores dos eventos de uma agenda secundária chamada ImobiFlow,
        criada pelo próprio aplicativo — o escopo utilizado é <code>calendar.app.created</code>
        e não concede acesso à agenda principal nem aos outros calendários pessoais do
        usuário. O uso e a transferência dessas informações obedecem à
        <strong>Google API Services User Data Policy</strong>, inclusive aos requisitos
        de <em>Limited Use</em>: os dados são usados somente para exibir e sincronizar
        os compromissos solicitados pelo usuário, nunca para publicidade, venda de
        dados ou treinamento de modelos de inteligência artificial. O usuário pode
        revogar essa autorização a qualquer momento em
        <strong>Agenda → Sincronizar calendário → Desconectar Google</strong>, o que
        remove as credenciais armazenadas por nós e interrompe as sincronizações
        futuras.
      </p>

      <h2>Com quem compartilhamos</h2>
      <p>
        Compartilhamos dados apenas com fornecedores necessários à prestação do
        serviço, cada um sob suas próprias funções e instruções contratuais — nunca
        vendemos dados pessoais. Isso inclui Supabase (banco de dados), Asaas
        (pagamentos), Fly.io (hospedagem), UAZAPI (canal WhatsApp), OpenRouter
        (inferência de IA e transcrição) e a Google Calendar API, nos termos descritos
        acima.
      </p>

      <h2>Por quanto tempo guardamos</h2>
      <p>
        Os dados são mantidos enquanto a conta estiver ativa. Após o encerramento, o
        conteúdo operacional é eliminado ou anonimizado, ressalvado o que precise ser
        conservado por obrigação legal ou para exercício regular de direitos, pelos
        prazos aplicáveis a cada finalidade — por exemplo, registros de acesso são
        mantidos por 6 meses, conforme o Marco Civil da Internet.
      </p>

      <h2>Direitos do titular</h2>
      <p>
        Qualquer titular pode solicitar ao Encarregado, gratuitamente, a confirmação
        do tratamento, acesso, correção, anonimização, eliminação ou portabilidade de
        seus dados, informação sobre com quem foram compartilhados, e a revogação de
        consentimento a qualquer tempo — conforme o art. 18 da LGPD.
      </p>

      <p>
        Este é um resumo com foco na coleta e no uso de dados. A política completa,
        com todas as seções (controlador, bases legais detalhadas, dados sensíveis,
        transferência internacional, segurança, incidentes e mais), fica disponível
        nesta mesma página assim que o aplicativo carrega.
      </p>
    </section>
    <footer>
      ${RAZAO_SOCIAL} · CNPJ ${CNPJ} · Goiânia/GO, Brasil.
    </footer>
  </main>`;

export function injectPublicPrivacyPage(html: string): string {
  const emptyRoot = /<div\s+id=["']root["']\s*>\s*<\/div>/i;
  if (!emptyRoot.test(html)) return html;
  return html.replace(emptyRoot, `<div id="root">${PUBLIC_PRIVACY_MARKUP}</div>`);
}
