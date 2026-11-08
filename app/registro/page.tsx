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
        {/* F3 P2: el first-timer sabe qué va a hacer aquí — la composición
            real del lineup (invariante 1) y el objetivo (compite en ligas),
            no un «ligas de fantasy» genérico. */}
        Monta tu lineup de 2 oro + 2 plata + 1 constructor + 1 equipo y
        compite cada GP en tus ligas. ¿Ya tienes cuenta?{" "}
        <a href="/login">Inicia sesión</a>
      </p>
      <RegisterForm />
    </main>
  );
}
