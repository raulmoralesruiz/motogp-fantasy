"use client";

import { type ButtonHTMLAttributes, type Ref, useId } from "react";

/** Motivo de bloqueo escrito junto a un control deshabilitado. */
export function DisabledReason({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} className="muted button-disabled-reason">
      {children}
    </span>
  );
}

/**
 * Botón de acción (rojo de marca cuando es primario).
 *
 * Unifica las dos clases anteriores (`.form button` y `.action-button`):
 * dentro de un formulario se usa con `type="submit"`; fuera (p. ej. cerrar
 * sesión en home) con `type="button"`.
 *
 * `variant="secondary"` es la acción neutra (filete de gris de pista): la
 * opción segura de los diálogos y los ajustes que no son el primario de su
 * región (Regla de la Señal — un solo relleno rojo por región).
 *
 * `disabledReason` escribe el motivo de bloqueo junto al control (compromiso
 * de marca: nunca un control bloqueado sin explicación) y lo asocia al botón
 * con `aria-describedby`. Con motivo escrito el botón se bloquea con
 * `aria-disabled` —sigue en el orden de foco, para que el motivo se anuncie
 * al navegar con teclado/lector—; sin motivo (estados transitorios) se usa
 * `disabled` nativo.
 */
export function Button({
  type = "button",
  variant = "primary",
  disabledReason,
  onClick,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Motivo de bloqueo; se escribe junto al botón si este está deshabilitado. */
  disabledReason?: string;
  /** `primary` = relleno del acento; `secondary` = neutro con filete. */
  variant?: "primary" | "secondary";
  ref?: Ref<HTMLButtonElement>;
}) {
  const reasonId = useId();
  const isDisabled = props.disabled === true;
  const showReason = isDisabled && disabledReason != null;
  return (
    <>
      <button
        type={type}
        className={variant === "secondary" ? "button-secondary" : "button"}
        {...props}
        ref={ref}
        disabled={showReason ? undefined : props.disabled}
        aria-disabled={showReason ? "true" : undefined}
        aria-describedby={showReason ? reasonId : undefined}
        onClick={(event) => {
          if (showReason) return;
          onClick?.(event);
        }}
      />
      {showReason ? (
        <DisabledReason id={reasonId}>{disabledReason}</DisabledReason>
      ) : null}
    </>
  );
}
