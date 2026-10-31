# Fixtures grabadas de PulseLive (resultados)

Payloads reales del endpoint `/results/session/{id}/classification` grabados **en vivo** el **2026-10-21** (verificación de US-17, ADR-0019) para los tests de contrato del adapter de resultados.

| Fichero | Sesión | Notas |
| --- | --- | --- |
| `q2-indonesia-2026.json` | `Q` (clasificación 2) del GP de Indonesia 2026 | 12 entradas; sin `points`/`time` (formato Q: `position` de parrilla, `best_lap`, `top_speed`); `records[]` incluye `fastestLap` (vuelta rápida de la sesión) — sin `poleLap`. |
| `spr-indonesia-2026.json` | `SPR` (sprint) del GP de Indonesia 2026 | 22 entradas; `points` presente; `records[]` incluye `poleLap` (vuelta de pole) — sin `fastestLap`. |
| `rac-indonesia-2026.json` | `RAC` (carrera) del GP de Indonesia 2026 | 21 entradas; `points` presente; `records[]` incluye `fastestLap` (vuelta rápida de la carrera → bono `fastest-lap`, ADR-0019); `bestLap` es el lap de referencia histórico (con `year`). |

- **Fuente:** `https://api.motogp.pulselive.com/motogp/v1/results/session/<id de la sesión>/classification?categoryUuid=<categoría MotoGP>` (GET, sin auth). Indonesia es el último GP terminado de la temporada 2026; cubre casos variados: `INSTND` (terminó), `OUTSTND`/`NOTFINISHFIRST` (DNF) y `NOTONRESTARTGRID` (ausente).
- **Uso:** tests de contrato de `PulseLiveResultsSource` (normalización pura: estados, bonos, `riderRef` = `rider.riders_id`, `rawPoints`, errores fail-closed). No son golden files de reglas (no pertenecen a `economy`/`scoring`): son datos de fuente, con la misma naturaleza que las fixtures de temporada real del calendario (ADR-0012).
- **No contienen PII ni secrets:** datos públicos de carrera de una API pública.
