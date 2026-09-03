/**
 * O verificador de branding do Google não executa necessariamente o React.
 * Esta versão sem JavaScript deixa explícitos, no HTML inicial, o nome do app,
 * sua finalidade e os links institucionais exigidos pelo fluxo OAuth.
 * Quando o bundle carrega, o React substitui normalmente o conteúdo de #root.
 */
const PUBLIC_ABOUT_MARKUP = `
  <main id="public-about-static">
    <header>
      <strong>PANTUS</strong>
      <nav aria-label="Links institucionais">
        <a href="/privacidade">Política de Privacidade</a>
        <a href="/termos">Termos de Uso</a>
        <a href="mailto:criateoficial@gmail.com">Suporte</a>
      </nav>
    </header>
    <section>
      <h1>PANTUS — plataforma imobiliária com inteligência artificial</h1>
      <p>
        O PANTUS é uma plataforma da Criate Tecnologia em Marketing e Vendas LTDA
        para corretores, imobiliárias e incorporadoras organizarem imóveis, clientes,
        conversas, agenda de visitas, locações, cobranças e equipes.
      </p>
      <h2>Integração opcional com o Google Agenda</h2>
      <p>
        Com autorização do usuário, o PANTUS cria uma agenda secundária chamada
        PANTUS e pode consultar, criar, alterar e excluir somente os eventos dessa
        agenda criada pelo próprio aplicativo. O sistema não solicita acesso à agenda
        principal nem aos outros calendários pessoais do usuário.
      </p>
      <p>
        A conexão pode ser desfeita a qualquer momento na tela Agenda do PANTUS ou
        nas permissões da Conta Google.
      </p>
    </section>
    <footer>
      Criate Tecnologia em Marketing e Vendas LTDA · CNPJ 54.236.008/0001-80 · Goiânia/GO, Brasil.
    </footer>
  </main>`;

export function injectPublicAboutPage(html: string): string {
  const emptyRoot = /<div\s+id=["']root["']\s*>\s*<\/div>/i;
  if (!emptyRoot.test(html)) return html;
  return html.replace(emptyRoot, `<div id="root">${PUBLIC_ABOUT_MARKUP}</div>`);
}

