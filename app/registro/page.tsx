import type { Metadata } from "next";

import RegisterForm from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta — Fantasy MotoGP Independiente",
};

export default function RegisterPage() {
  return (
    <main>
      <h1>
        Crea tu <span>cuenta</span>
      </h1>
      <p className="muted">
        Regístrate para participar en ligas de fantasy. ¿Ya tienes cuenta?{" "}
        <a href="/login">Inicia sesión</a>
      </p>
      <RegisterForm />
    </main>
  );
}
