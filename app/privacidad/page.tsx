import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de privacidad — Fantasy MotoGP Independiente",
};

/**
 * Política de privacidad (F3 P1): la casilla de aceptación del registro debe
 * enlazar a un documento legible. Describe los datos reales que la app recoge
 * (email, seudónimo, datos de juego) y los derechos GDPR que ya implementa
 * (exportación JSON y eliminación/anonimización de cuenta — US-03, ADR-0016).
 */
export default function PrivacidadPage() {
  return (
    <main>
      <h1>
        Política de <span>privacidad</span>
      </h1>
      <p className="muted">
        <a href="/registro">Volver al registro</a>
      </p>

      <section className="form">
        <h2>1. Qué datos recogemos</h2>
        <p>
          Solo lo necesario para que el juego funcione, con minimización
          (RGPD): tu email, tu nombre de usuario (seudónimo público), tu
          contraseña (hash, nunca en claro) y tus datos de juego (lineups,
          puntuaciones, ligas a las que perteneces). No recogemos datos de
          tarjetas, ubicación ni perfiles publicitarios.
        </p>

        <h2>2. Para qué los usamos</h2>
        <p>
          Para gestionar tu cuenta, calcular tus puntuaciones y rankings dentro
          de tus ligas, y enviarte avisos por email cuando algo afecta a tus
          resultados (publicación del definitivo o un recálculo). Puedes
          desactivar estos avisos en tu perfil; la desactivación no afecta al
          funcionamiento del juego.
        </p>

        <h2>3. Con quién los compartimos</h2>
        <p>
          Solo con los demás miembros de las ligas a las que pertenezcas: tu
          nombre de usuario y tus resultados. No vendemos ni cedemos tus datos
          a terceros con fines publicitarios.
        </p>

        <h2>4. Tus derechos</h2>
        <p>
          Puedes ejercer tus derechos en cualquier momento desde tu perfil:
        </p>
        <ul className="status">
          <li>
            <strong>Acceso y portabilidad:</strong> exporta todos tus datos en
            un archivo JSON.
          </li>
          <li>
            <strong>Supresión:</strong> elimina tu cuenta. Anonimizamos tus
            datos de juego conservando la coherencia de las ligas y rankings,
            y borramos los datos que te identifiquen.
          </li>
          <li>
            <strong>Opuesto a la automatización:</strong> las decisiones sobre
            tu cuenta (sanciones, suspensiones) se toman con criterio humano y
            quedan registradas.
          </li>
        </ul>

        <h2>5. Conservación y seguridad</h2>
        <p>
          Guardamos los datos el tiempo necesario para el funcionamiento del
          juego y aplicamos medidas de seguridad razonables: contraseñas con
          hash, sesiones revocables, protección contra fuerza bruta y registro
          auditable de las acciones sensibles.
        </p>

        <h2>6. Contacto</h2>
        <p>
          Para cualquier cuestión sobre privacidad, escribe al administrador
          del servicio en{" "}
          <a href="mailto:raumorales22@gmail.com">raumorales22@gmail.com</a>.
        </p>
      </section>
    </main>
  );
}
