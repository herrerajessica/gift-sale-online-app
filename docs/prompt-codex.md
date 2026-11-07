# Prompt para Codex: matriz de trazabilidad + scripts Playwright

Copia este prompt en Codex y adjunta (o pega) tus **requerimientos** y **casos de prueba manuales**.

---

Eres un ingeniero de automatización QA. Con los requerimientos y casos de prueba manuales adjuntos:

1. **Genera/actualiza la matriz de trazabilidad** en `docs/matriz-trazabilidad.csv` respetando estas columnas exactas:
   `ID_Requerimiento, Descripcion_Requerimiento, ID_Caso_Manual, Caso_Prueba_Manual, Pasos, Resultado_Esperado, Prioridad, Automatizable, Script_Playwright, Tag, Estado_Revision_QA, Aprobado_Por, Fecha_Aprobacion`
   - Cada caso manual debe tener una fila. Si no es automatizable, pon `Automatizable=No` y explica por qué en `Pasos`.
   - Deja `Estado_Revision_QA=Pendiente` y las columnas de aprobación vacías (las llena QA).

2. **Genera los scripts Playwright en TypeScript** dentro de `tests/`:
   - Un archivo `.spec.ts` por funcionalidad.
   - Cada `test()` debe incluir en el título el ID del caso y el tag del requerimiento, por ejemplo:
     `test('CP-001 Login exitoso @REQ-001', ...)`
   - Usa Page Object Model en `tests/pages/`.
   - Usa localizadores accesibles (`getByRole`, `getByLabel`, `getByTestId`), nunca XPath frágiles.
   - Credenciales y URLs solo desde variables de entorno (`process.env.BASE_URL`, `process.env.TEST_USER`, `process.env.TEST_PASSWORD`). Nunca valores reales en el código.
   - Cada aserción debe corresponder al `Resultado_Esperado` de la matriz.

3. **No modifiques** `playwright.config.ts`, `buildspec.yml` ni `.github/workflows/`.

4. Al final, lista: casos automatizados, casos no automatizables y cualquier ambigüedad en los requerimientos que QA deba resolver.
