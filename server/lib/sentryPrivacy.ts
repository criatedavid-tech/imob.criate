import type { ErrorEvent } from "@sentry/node";

function withoutQueryOrFragment(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.split(/[?#]/, 1)[0];
}

/**
 * Última barreira contra vazamento de dados no error tracking.
 *
 * O ImobiFlow processa mensagens, documentos, telefones e tokens. Para
 * diagnosticar uma falha precisamos do stack trace e da rota, não do payload
 * do cliente. A função fica isolada da inicialização da infraestrutura para ser
 * testada sem conectar Redis, Supabase ou Sentry.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    event.request.url = withoutQueryOrFragment(event.request.url);
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.env;
  }

  // Mesmo com sendDefaultPii=false, dados adicionados explicitamente por código
  // não são removidos pelo SDK. Mantemos a política conservadora no backend.
  delete event.user;
  delete event.extra;

  // console.* pode conter conteúdo de mensagens ou respostas de integrações.
  // Breadcrumbs HTTP continuam úteis, mas URLs nunca levam query/fragmento.
  event.breadcrumbs = event.breadcrumbs
    ?.filter((breadcrumb) => breadcrumb.category !== "console")
    .map((breadcrumb) => {
      const data = breadcrumb.data;
      if (!data || typeof data.url !== "string") return breadcrumb;
      return {
        ...breadcrumb,
        data: { ...data, url: withoutQueryOrFragment(data.url) },
      };
    });

  return event;
}
