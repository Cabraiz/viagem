const allowedOrigins = new Set(['https://viagem.cyou', 'https://www.viagem.cyou']);

// CORS limita leitura pelo navegador, não substitui autenticação das futuras rotas.
export default {
  fetch(request: Request): Response {
    const origin = request.headers.get('origin');
    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    if (origin && !allowedOrigins.has(origin)) {
      return new Response(null, { status: 403, headers });
    }
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      return new Response(null, { status: 204, headers });
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      headers.set('Allow', 'GET, HEAD, OPTIONS');
      return new Response(null, { status: 405, headers });
    }
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ status: 'ok', service: 'viagem-api' }), { headers });
  },
};
