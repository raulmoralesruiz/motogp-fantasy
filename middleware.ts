import { NextResponse, type NextRequest } from "next/server";

import { evaluateCors } from "./cors";

/**
 * Middleware CORS (T-20): solo aplica a /api/* (ver `config.matcher`).
 * La lógica de decisión está en `evaluateCors` (función pura, testeada de
 * forma aislada); este wrapper solo traduce el resultado a respuesta de
 * Next.js. Las páginas y assets estáticos son same-origin y no necesitan CORS.
 */
export function middleware(req: NextRequest) {
  const outcome = evaluateCors({
    method: req.method,
    origin: req.headers.get("origin"),
    host: req.headers.get("host"),
  });

  if (outcome.kind === "reject") {
    return NextResponse.json(
      { error: "Origen no permitido para la API." },
      { status: 403 },
    );
  }

  if (outcome.kind === "preflight") {
    const res = new NextResponse(null, { status: 204 });
    for (const [key, value] of Object.entries(outcome.headers)) {
      res.headers.set(key, value);
    }
    return res;
  }

  // pass: la petición continúa hacia el handler.
  const res = NextResponse.next();
  // `Vary: Origin` siempre: evita que caches (p. ej. Cloudflare) sirvan una
  // respuesta con/ sin `Access-Control-Allow-Origin` a un origen distinto.
  res.headers.set("vary", "Origin");
  if (outcome.allowOrigin) {
    res.headers.set("access-control-allow-origin", outcome.allowOrigin);
  }
  return res;
}

export const config = {
  // Solo la API: el resto de rutas no necesita CORS (son same-origin).
  matcher: ["/api/:path*"],
};
