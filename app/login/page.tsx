import type { Metadata } from "next";

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
      <LoginForm />
      <p className="muted">
        <a href="/recuperar-contrasena">¿Olvidaste tu contraseña?</a>
      </p>
    </main>
  );
}
