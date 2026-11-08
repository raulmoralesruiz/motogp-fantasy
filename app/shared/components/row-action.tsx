"use client";

import { type ButtonHTMLAttributes, useId } from "react";

import { DisabledReason } from "./button";

/**
 * Acción fantasma de fila (borde fino del acento, sin relleno): el patrón
 * de las acciones secundarias sobre una fila (ver detalle, cerrar, estados
 * de evento). Nunca rellena: el rojo protagonista de la región es otro
 * (Regla de la Señal — un solo relleno rojo por región).
 *
 * `disabledReason` escribe el motivo de bloqueo junto al control, igual que
 * en `Button` (mismo criterio de `aria-disabled` con motivo / `disabled`
 * nativo en transitorios).
 */
export function RowAction({
  type = "button",
  disabledReason,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Motivo de bloqueo; se escribe junto al botón si este está deshabilitado. */
  disabledReason?: string;
}) {
  const reasonId = useId();
  const isDisabled = props.disabled === true;
  const showReason = isDisabled && disabledReason != null;
  return (
    <>
      <button
        type={type}
        className="row-action"
        {...props}
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
