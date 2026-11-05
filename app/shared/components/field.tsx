import { type InputHTMLAttributes, useId } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "name"> {
  label: string;
  name: string;
  error?: string | null;
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
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} name={name} type={type} {...inputProps} />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
