import { type ButtonHTMLAttributes } from "react";

/**
 * Botón de acción primario (rojo de marca).
 *
 * Unifica las dos clases anteriores (`.form button` y `.action-button`):
 * dentro de un formulario se usa con `type="submit"`; fuera (p. ej. cerrar
 * sesión en home) con `type="button"`.
 */
export function Button({
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className="button" {...props} />;
}
