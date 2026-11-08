import type { Metadata } from "next";
import { Suspense } from "react";

import LoginForm from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión — Fantasy MotoGP Independiente",
};

export default function LoginPage() {
  return (
    <main>
      <h1>
        Inicia <span>sesión</span>
      </h1>
      <p className="muted">
        ¿Aún no tienes cuenta? <a href="/registro">Regístrate</a>
      </p>
      {/* useSearchParams (destino `next`) exige un límite de Suspense en el
          prerender (Next 15). */}
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
