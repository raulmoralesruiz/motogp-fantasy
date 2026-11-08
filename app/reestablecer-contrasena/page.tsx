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
      {/* F3 R4 P2: intro line (consistencia con login/registro/recuperar, que
          sí la tienen) + salida al login (control del usuario). */}
      <p className="muted">
        Establece una nueva contraseña para tu cuenta.{" "}
        <a href="/login">Volver a iniciar sesión</a>
      </p>
      {/* useSearchParams exige un límite de Suspense en el prerender (Next 15). */}
      <Suspense fallback={<p className="muted">Cargando…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
