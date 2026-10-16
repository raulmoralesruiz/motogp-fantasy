/**
 * Router de administración (T-08, mínimo): la base de autorización del
 * panel global. Todos sus procedimientos pasan por `adminProcedure`
 * (solo `global_admin`; 403 FORBIDDEN en caso contrario).
 *
 * `admin.me` devuelve el actor y sus roles: hace testeable el CA "un
 * `user` no accede al panel de admin (403)". El panel completo
 * (temporadas, mercado, precios, resultados, ligas) se construye en las
 * épicas posteriores sobre esta base.
 */
import { toPublicUser } from "@/modules/identity";

import { adminProcedure, router } from "../trpc";

export const adminRouter = router({
  /** Admin activo y sus roles (prueba de acceso al panel). */
  me: adminProcedure.query(({ ctx }) => toPublicUser(ctx.user)),
});
