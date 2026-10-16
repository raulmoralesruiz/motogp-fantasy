import type { Metadata } from "next";
import { Suspense } from "react";

import ResetPasswordForm from "./reset-password-form";

export const metadata: Metadata = {
  title: "Restablecer contraseña — Fantasy MotoGP Independiente",
};

export default function ResetPasswordPage() {
  return (
    <main>
      <h1>
        Restablece tu <span>contraseña</span>
      </h1>
      {/* useSearchParams exige un límite de Suspense en el prerender (Next 15). */}
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
