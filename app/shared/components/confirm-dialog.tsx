import { useEffect, useId, useRef, type ReactNode } from "react";

import { Alert } from "./alert";
import { Button } from "./button";

/** Confirmación pendiente: acción, impacto escrito y etiqueta «Sí, …». */
export interface ConfirmRequest {
  /** La acción que se va a ejecutar, como título (nombra objeto y acción). */
  title: string;
  /** Impacto escrito: qué cambia y qué no tiene vuelta atrás. */
  impact: ReactNode;
  /** Si la acción es irreversible, el impacto se muestra como aviso. */
  irreversible?: boolean;
  /** Etiqueta del botón que ejecuta la acción («Sí, …»). */
  confirmLabel: string;
  onConfirm: () => void;
}

/**
 * Confirmación con impacto para acciones irreversibles o que reescriben
 * datos (patrón del sistema): aviso + impacto escrito + «Sí, …»/«No,
 * volver». Sustituye a `window.confirm` para que el impacto sea legible y
 * la acción se nombre en ambos controles.
 */
export function ConfirmDialog({
  title,
  impact,
  irreversible = false,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmRequest & { onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // El foco abre en la opción segura («No, volver»): el Enter a ciegas no
  // ejecuta una acción irreversible. Al cerrar (cualquiera que sea la vía)
  // el foco vuelve al control que abrió el diálogo.
  useEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    safeRef.current?.focus();
    return () => {
      openerRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="confirm-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="confirm-dialog"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          // Diálogo con dos controles: Tab retiene el foco dentro.
          if (event.key === "Tab") {
            event.preventDefault();
            const focusables = dialogRef.current?.querySelectorAll("button");
            if (!focusables || focusables.length < 2) return;
            const other =
              document.activeElement === focusables[0]
                ? focusables[focusables.length - 1]
                : focusables[0];
            other?.focus();
          }
        }}
      >
        <h2 id={titleId} className="confirm-title">
          {title}
        </h2>
        {irreversible ? <Alert variant="warning">{impact}</Alert> : <p>{impact}</p>}
        <div className="confirm-actions">
          <Button onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="secondary" ref={safeRef} onClick={onClose}>
            No, volver
          </Button>
        </div>
      </div>
    </div>
  );
}
