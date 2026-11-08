import { type InputHTMLAttributes, type Ref, useId } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "name"> {
  label: string;
  name: string;
  error?: string | null;
  /** Ref al `<input>` subyacente (React 19: ref-as-prop; fluye vía `...inputProps`). */
  ref?: Ref<HTMLInputElement>;
}

/**
 * Campo de formulario de texto: etiqueta + input + mensaje de error.
 *
 * El `id` del input es único por instancia (`useId`) salvo que se pase uno
 * explícito: derivarlo del `name` cruzaba etiquetas entre formularios cuando
 * varios convivían en el mismo DOM (p. ej. dos campos «Nombre» con
 * `htmlFor="name"` apuntando al primer input del documento).
 */
export function Field({
  label,
  name,
  error,
  id,
  type = "text",
  ...inputProps
}: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {error ? (
        // F3 P2: el error se asocia al input (`aria-describedby`) y se
        // anuncia a lectores de pantalla (`role="alert"` al aparecer).
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
