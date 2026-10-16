"use client";

import { type ChangeEvent } from "react";

interface RulesJsonFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Error (validación local o del servidor) mostrado bajo el campo. */
  error?: string | null;
}

/**
 * Editor de reglas de temporada en JSON (US-04, UI admin): etiqueta +
 * textarea + mensaje de error. Reutiliza la clase `.field` de las
 * primitivas de formulario (`Field` solo soporta `<input>`).
 */
export function RulesJsonField({
  id,
  label,
  value,
  onChange,
  error,
}: RulesJsonFieldProps) {
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={id}
        rows={14}
        value={value}
        onChange={handleChange}
        spellCheck={false}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
