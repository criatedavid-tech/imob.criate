const RAZAO_SOCIAL = 'Criate Tecnologia em Marketing e Vendas LTDA';

// Rodapé de copyright com ano dinâmico, reutilizado em todas as páginas.
// variant='dark' para telas com fundo escuro (glass), 'light' para PropertyLanding.
// short=true usa o texto reduzido, para espaços estreitos (ex.: sidebar).
export default function Copyright({ variant = 'dark', short = false, className = '' }: { variant?: 'dark' | 'light'; short?: boolean; className?: string }) {
  const year = new Date().getFullYear();
  const color = variant === 'light' ? 'text-[#1a1a1a]/40' : 'text-white/30';

  return (
    <p title={`${RAZAO_SOCIAL}. Todos os direitos reservados.`} className={`text-center text-[11px] ${color} ${className}`}>
      {short ? `© ${year} Real Estate` : `© ${year} Real Estate · ${RAZAO_SOCIAL}. Todos os direitos reservados.`}
    </p>
  );
}
