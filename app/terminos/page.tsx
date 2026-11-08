import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos de uso — Fantasy MotoGP Independiente",
};

/**
 * Términos de uso (F3 P1): la casilla de aceptación del registro debe
 * enlazar a un documento legible — un consentimiento sin documento no es
 * informado. Contenido en español, coherente con la conducta real de la app
 * (datos de juego, ligas, puntuación; sin licencias de MotoGP — AGENTS.md §11).
 */
export default function TerminosPage() {
  return (
    <main>
      <h1>
        Términos de <span>uso</span>
      </h1>
      <p className="muted">
        <a href="/registro">Volver al registro</a>
      </p>

      <section className="form">
        <h2>1. Qué es este servicio</h2>
        <p>
          Fantasy MotoGP Independiente es un juego de fantasy de carreras de
          moto propio, multi-liga y gratuito. No es un producto oficial ni
          patrocinado por MotoGP, Dorna ni ninguna organización de carreras;
          no utiliza sus marcas, logos ni datos licenciados. Los nombres de
          pilotos, equipos y circuitos se usan de forma descriptiva para
          identificar las carreras que se simulan.
        </p>

        <h2>2. Cuentas y responsabilidad</h2>
        <p>
          Creas una cuenta con tu email, un nombre de usuario y una contraseña.
          Eres responsable de la actividad que se realice con tu cuenta y de
          mantener la confidencialidad de tus credenciales. Si has activado la
          autenticación en dos pasos, el código de tu app de autenticación es
          parte de tu seguridad: si pierdes el dispositivo, contacta con el
          administrador del servicio.
        </p>

        <h2>3. Conducta</h2>
        <p>
          El juego está pensado para el entretenimiento. No está permitido usar
          el servicio para automatizar acciones de forma engañosa, interferir
          con su funcionamiento o perjudicar a otros jugadores. Los
          administradores pueden revisar la actividad, aplicar sanciones y
          suspender cuentas que incumplan estos términos, con registro
          auditable de cada decisión.
        </p>

        <h2>4. Ligas y privacidad entre jugadores</h2>
        <p>
          Puedes crear ligas privadas (con código de invitación) o unirte a
          ligas públicas. Dentro de una liga, tu nombre de usuario y tus
          resultados son visibles para los demás miembros. Fuera de tus ligas,
          tus datos no se comparten con otros jugadores.
        </p>

        <h2>5. Disponibilidad y cambios</h2>
        <p>
          El servicio se ofrece «tal cual», sin garantías de disponibilidad
          continua. Podemos actualizar las reglas de juego (presupuesto,
          puntuación, precios) por temporada; cada cambio se versiona y se
          aplica solo a carreras futuras o mediante un recálculo explícito y
          auditado. Podemos modificar estos términos; el uso continuado del
          servicio tras la publicación de cambios implica su aceptación.
        </p>

        <h2>6. Limitación de responsabilidad</h2>
        <p>
          El servicio es gratuito y sin ánimo de lucro. En la medida máxima
          permitida por la ley, no nos hacemos responsables de daños derivados
          del uso del servicio, de la pérdida de datos de juego o de
          interrupciones del mismo.
        </p>

        <h2>7. Contacto</h2>
        <p>
          Para cualquier duda sobre estos términos, escribe al administrador
          del servicio en{" "}
          <a href="mailto:raumorales22@gmail.com">raumorales22@gmail.com</a>.
        </p>
      </section>
    </main>
  );
}
