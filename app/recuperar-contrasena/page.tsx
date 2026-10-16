import type { Metadata } from "next";

import ResetRequestForm from "./reset-request-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña — Fantasy MotoGP Independiente",
};

export default function RecoverPasswordPage() {
  return (
    <main>
      <h1>
        Recupera tu <span>contraseña</span>
      </h1>
      <p className="muted">
        Indica el email de tu cuenta y te enviaremos un enlace para restablecer la
        contraseña. <a href="/login">Volver a iniciar sesión</a>
      </p>
      <ResetRequestForm />
    </main>
  );
}
