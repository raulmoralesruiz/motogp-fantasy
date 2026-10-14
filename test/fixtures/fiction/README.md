# Dataset ficticio canónico (economy.md §7)

Todos los datos de este directorio son **ficticios** (T-22): sin PII ni datos
reales de usuarios. Es el dataset canónico de `docs/product/economy.md` §7:
mercado de 11 pilotos / 4 constructores / 4 equipos, 6 GPs, 6 jugadores con
lineups fijos y presupuesto base 100.

## Archivos

| Archivo                          | Contenido                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `market.json`                    | Mercado §7.1: pilotos A–K (P0 + serie de precios GP1→GP6, literal), constructores X–W y equipos (precios constantes). |
| `season.json`                    | Temporada ficticia: 6 GPs (nombres, circuitos, fechas).                                                               |
| `players.json`                   | Jugadores §7.2 (P1–P6) con lineups fijos. Oro = los 2 pilotos más caros a precios GP1.                                |
| `results.json`                   | Resultados anonimizados por GP, coherentes con la narrativa (lesión de B en GP3–GP4; ascenso de J).                   |
| `index.ts`                       | Loader tipado + validación de coherencia del fixture (falla claro si el fixture se rompe).                            |
| `simulate.ts`                    | Núcleo PURO de simulación (opciones B/E) sobre el dataset.                                                            |
| `loader.ts`                      | Seeder para BD real (tests de integración): `seedFictionalSeason(prisma)`.                                            |
| `__tests__/trajectories.test.ts` | Golden de trayectorias de presupuesto exactas (§7.3/§7.4).                                                            |

## Notas

- **Precios exógenos:** la serie de precios es la literal de §7.1; no se
  aplica la fórmula de precios al dataset ficticio (la narrativa la da
  directamente, p. ej. la lesión de B lleva su precio a 8, no a P0/2=11).
- **Totales de puntos:** los totales de §7.3/§7.4 (798.0, 778.5, 634.5,
  324.0, 631.5, 696.0) se dan como referencia narrativa del documento y **no
  se reproducen exactamente** con resultados coherentes; el golden cubre las
  trayectorias de presupuesto (que sí son exactas) y la propiedad «puntos
  idénticos en B y E» (§7.5).
- **Estado de carrera en BD:** el modelo `Result` no tiene columna de estado
  de carrera; `position` es la posición de meta (NULL si ABSENT/DNF) y el
  estado FINISHED/DNF/ABSENT se conserva en `raw` (payload original de la
  fuente), según `data-model.md` y AGENTS.md §6.

## Uso

```bash
npm run simulate:fiction   # CLI: imprime las trayectorias B y E
npm run test               # incluye el golden de trayectorias
```

Para explorar el dataset en la BD local (Prisma Studio/psql):

```bash
npx prisma migrate reset --force   # BD limpia (si tiene datos previos)
npm run seed:fiction               # siembra la temporada ficticia completa
npx prisma studio                  # explora en el navegador (:5555)
```

En tests de integración: `seedFictionalSeason(prisma)` siembra la temporada
completa (temporada, GPs, mercado, afiliaciones, precios, usuarios, lineups
fijos y resultados provisionales) y devuelve los ids de BD mapeados.
