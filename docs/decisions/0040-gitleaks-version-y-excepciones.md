# ADR-0040: Gitleaks — pin de versión y excepciones documentadas

- **Estado:** Aceptado (2026-11-04)
- **Fecha:** 2026-11-04
- **Relacionado:** T-19 (secrets en CI), D-07/ADR-0039 (vectores de test TOTP), ADR-0019 (fixtures PulseLive), `testing.md` §3 (sin PII ni datos reales en tests), ADR-0038 (precedente de "excepciones documentadas" en gates de CI).

## Problema

El job `Gitleaks` de CI (T-19) falló en el commit `c1bc607` (D-07, 2026-11-04) con 16 hallazgos de la regla `generic-api-key`; el commit anterior (`7f89d31`) había pasado con los mismos fixtures. La investigación identificó dos causas reales:

1. **Falsos positivos legítimos.** Los hallazgos eran:
   - el secreto TOTP de los tests `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` — el **ejemplo canónico de base32 del RFC 4648/4226** ("Hello! This is a secret"), un valor **público por definición** usado como vector de test reproducible (ADR-0039);
   - la contraseña de test `clave-de-prueba-123`;
   - y una bomba de relojería: 55 hallazgos potenciales más en los fixtures PulseLive `test/fixtures/pulselive/*.json` (datos anonimizados del contrato de la fuente, `testing.md` §3), que cualquier commit futuro que los tocara habría disparado.

   Ningún secreto real: los tests llevan valores fijos de reproducibilidad y los fixtures son datos de test.

2. **Gate no reproducible.** `gitleaks/gitleaks-action@v2` usa la versión **"latest"** de gitleaks si no se fija `GITLEAKS_VERSION`. Entre el commit verde y el rojo se publicó una release nueva upstream y las reglas activas cambiaron: el mismo árbol pasó de verde a rojo **sin que nadie cambiara código**. Un gate de seguridad cuyo criterio cambia en silencio según la fecha no es un gate.

## Opciones

### A. Excepciones documentadas + pin de versión (elegida)

- `.gitleaks.toml` en la raíz: extiende las reglas por defecto (`[extend] useDefault = true`) y añade **dos** allowlists globales acotadas a rutas exactas, cada una con justificación y referencia a la decisión.
- Pin de `GITLEAKS_VERSION: 8.30.1` en el workflow (la versión con la que falló CI; la acción respeta `GITLEAKS_VERSION` según su código fuente).
- Ventajas: el gate queda reproducible; las excepciones son explícitas, mínimas, acotadas por ruta y revisadas.
- Desventajas: la allowlist hay que mantenerla si cambian las rutas de tests (mitigado: acotada a rutas exactas y documentada en el propio fichero).

### B. Ignorar hallazgos por hash de commit

El mecanismo de ignore de gitleaks queda ligado a hashes de commit: inútil en branches, rebases o commits nuevos que toquen el mismo fichero, y menos legible que una config revisada. Descartada.

### C. Eliminar el gate

Descartada: la CA de T-19 exige escaneo de secrets en CI; es una invariante de seguridad del repo.

### D. Cambiar los valores de test para que no coincidan con la regla

Descartada como medida única: el vector del RFC 4648 es el ejemplo estándar de reproducibilidad (público por definición) y los fixtures PulseLive seguirían necesitando excepción. Se conservan los valores (reproducibilidad de tests) + la allowlist documentada y acotada.

## Decisión

**A.** Un `.gitleaks.toml` documentado en la raíz + pin de versión de gitleaks en CI.

## Justificación y consecuencias

- **`.gitleaks.toml`** (raíz del repo):
  - `[extend] useDefault = true` — se conservan **todas** las reglas por defecto de gitleaks (el escaneo no se relaja; solo se eximen las rutas documentadas).
  - `[[allowlists]]` nº 1: `test/fixtures/pulselive/*.json` — fixtures de test anonimizados (ADR-0019; `testing.md` §3: sin PII ni datos reales de usuarios).
  - `[[allowlists]]` nº 2: los tres archivos de test TOTP — vectores públicos RFC 4648/4226 + contraseña de test (ADR-0039). Fuera de esas rutas, la regla `generic-api-key` sigue aplicando con normalidad.
- **`.github/workflows/ci.yml`**: `GITLEAKS_VERSION: 8.30.1`. **Regla para subir la versión:** revisar antes las reglas nuevas/cambiadas y, si procede, actualizar `.gitleaks.toml` (toda excepción nueva exige justificación documentada, como en el gate de `npm audit` de ADR-0038).
- **Verificación:** réplica local con gitleaks **8.30.1** (la misma que usaba CI) en el modo exacto de la acción (`detect --log-opts=--no-merges --first-parent 7f89d31^..c1bc607`): **16 hallazgos** sin la config → **0 hallazgos** con ella; control positivo: un secret inyectado fuera de las rutas exentas sigue siendo detectado (la regla no está desactivada).
- **Precedente:** mismo patrón que ADR-0038 (gate con excepciones documentadas): la excepción es la excepción — siempre acotada, justificada y referenciada a una decisión.
