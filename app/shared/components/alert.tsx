import { type ReactNode } from "react";

interface AlertProps {
  variant: "error" | "success";
  children: ReactNode;
}

/**
 * Mensaje a nivel de formulario: error general (rechazo del servidor o
 * validación) o confirmación de éxito.
 */
export function Alert({ variant, children }: AlertProps) {
  if (variant === "success") {
    return (
      <p className="ok" role="status">
        {children}
      </p>
    );
  }
  return (
    <p className="form-error" role="alert">
      {children}
    </p>
  );
}
