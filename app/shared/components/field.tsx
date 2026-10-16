import { type InputHTMLAttributes } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "name"> {
  label: string;
  name: string;
  error?: string | null;
}

/**
 * Campo de formulario de texto: etiqueta + input + mensaje de error.
 *
 * El `id` del input se deriva de `name` si no se pasa uno explícito.
 * El checkbox de términos (registro) sigue inline: una sola aparición,
 * aún no cumple la regla de la tercera aparición.
 */
export function Field({
  label,
  name,
  error,
  id,
  type = "text",
  ...inputProps
}: FieldProps) {
  const inputId = id ?? name;
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input id={inputId} name={name} type={type} {...inputProps} />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
