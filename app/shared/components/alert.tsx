import { type ReactNode } from "react";

interface AlertProps {
  variant: "error" | "success" | "warning" | "info";
  children: ReactNode;
}

/**
 * Mensaje de estado: error general (rechazo del servidor o validación),
 * confirmación de éxito, aviso (p. ej. lockout próximo — US-15) o
 * información (p. ej. resultados actualizados — US-15).
 *
 * Cada variante se anuncia por `role` (status/alert) y lleva caja tintada
 * (P2 audit): válida dentro y fuera de `.form`. Un control bloqueado sin
 * motivo escrito o un error sin `role` rompen el compromiso de marca.
 */
export function Alert({ variant, children }: AlertProps) {
  if (variant === "success") {
    return (
      <p className="alert-ok" role="status">
        {children}
      </p>
    );
  }
  if (variant === "warning") {
    return (
      <p className="alert-warning" role="alert">
        {children}
      </p>
    );
  }
  if (variant === "info") {
    return (
      <p className="alert-info" role="status">
        {children}
      </p>
    );
  }
  return (
    <p className="alert-error" role="alert">
      {children}
    </p>
  );
}
