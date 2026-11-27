import { test, expect, Page } from '@playwright/test';
import { A, entrar, enVistaPrevia } from './support/app';

// Órdenes rápidas: se entienden sin IA. Estas pruebas solo miran la propuesta y tocan "Descartar":
// no cambian nada en la tienda de prueba.
async function decir(page: Page, texto: string) {
  if (!(await page.locator('#asis').isVisible())) await page.locator('#asisBtn').click();
  await page.locator('#asisInput').fill(texto);
  await page.keyboard.press('Enter');
  return page.locator('.burbuja.assistant').last();
}
const codigoDe = async (page: Page, n = 0) => {
  const card = page.locator('#grid .card').filter({ has: page.locator('.cod-tag') }).nth(n);
  return { cod: await card.locator('.cod-tag').innerText(), nombre: await card.locator('.name').innerText() };
};

test.describe('REQ-028 Órdenes rápidas por voz o texto', () => {
  test.skip(!enVistaPrevia && (!A.user || !A.pass), 'Define TEST_USER y TEST_PASSWORD');
  test.beforeEach(async ({ page }) => {
    await entrar(page, A.user, A.pass);
    await expect(page.locator('#grid .card .cod-tag').first()).toBeVisible({ timeout: 30_000 });
  });

  test('CP-082 "<código> precio N y stock N" arma la propuesta al instante @REQ-028', async ({ page }) => {
    const { cod } = await codigoDe(page);
    const [pre, num] = cod.split('-');
    const resp = await decir(page, `${pre.toLowerCase()} ${Number(num)} precio 777 y stock 7`);
    await expect(resp).toContainText(`Entendí: ${cod}`);
    const tarjeta = page.locator('.propuesta').last();
    await expect(tarjeta).toContainText('Precio');
    await expect(tarjeta).toContainText('777');
    await expect(tarjeta).toContainText('Cantidad');
    await tarjeta.getByRole('button', { name: 'Descartar' }).click();
    await expect(tarjeta).toContainText('Descartado');
  });

  test('CP-083 Un código que no existe lo dice y no cambia nada @REQ-028', async ({ page }) => {
    const { cod } = await codigoDe(page);
    const r2 = await decir(page, `${cod.split('-')[0]}-998 precio 10`);
    await expect(r2).toContainText('No encontré el código');
    await expect(page.locator('.propuesta:not(.descartada):not(.hecha)')).toHaveCount(0);
  });

  test('CP-084 Quitar y cambiar palabras del nombre @REQ-028', async ({ page }) => {
    const { cod, nombre } = await codigoDe(page);
    const palabra = nombre.split(' ').slice(-1)[0];
    const resp = await decir(page, `${cod} quita la palabra ${palabra}`);
    await expect(resp).toContainText(`quitar «${palabra}» del nombre`);
    const tarjeta = page.locator('.propuesta').last();
    await expect(tarjeta).toContainText('Nombre');
    await expect(tarjeta.locator('.despues')).not.toContainText(palabra);
    await tarjeta.getByRole('button', { name: 'Descartar' }).click();
  });

  test('CP-085 "categoría X 15 % de descuento hoy" propone una oferta con fecha @REQ-029', async ({ page }) => {
    const card = page.locator('#grid .card').filter({ has: page.locator('.price:not(.none)') }).first();
    const cat = (await card.locator('.meta span').first().innerText()).split(' · ')[0];
    const resp = await decir(page, `categoría ${cat} 15 % de descuento hoy`);
    await expect(resp).toContainText('oferta -15 % hoy');
    const tarjeta = page.locator('.propuesta').last();
    await expect(tarjeta).toContainText('Precio de oferta');
    await expect(tarjeta).toContainText('Oferta hasta');
    await tarjeta.getByRole('button', { name: 'Descartar' }).click();
  });

  test('CP-086 "Órdenes rápidas" muestra la ayuda con ejemplos @REQ-028', async ({ page }) => {
    const resp = await decir(page, 'Órdenes rápidas');
    await expect(resp.locator('table')).toBeVisible();
    await expect(resp).toContainText('CAR-002 precio 120');
  });
});

test.describe('REQ-030 Grupo de WhatsApp de ventas', () => {
  test.skip(!enVistaPrevia && (!A.user || !A.pass), 'Define TEST_USER y TEST_PASSWORD');

  test('CP-087 El mensaje para el grupo lleva códigos, precios y el enlace de la tienda @REQ-030', async ({ page }) => {
    await entrar(page, A.user, A.pass);
    await expect(page.locator('#grid .card .cod-tag').first()).toBeVisible({ timeout: 30_000 });
    // Un producto a la venta (sin "Vendido", "Oculto" ni "Apartado")
    const card = page.locator('#grid .card.disponible').filter({ has: page.locator('.cod-tag') }).first();
    const cod = await card.locator('.cod-tag').innerText();
    await page.locator('#selectBtn').click();
    await page.locator('#grid .card').filter({ hasText: cod }).locator('button.open').click();
    await expect(page.locator('#bulkCount')).toContainText('1');
    // El botón está dentro de la sección "📣 Compartir y mensajes" (cerrada al empezar)
    const grupo = page.locator('#bulkGrupo');
    if (!(await grupo.isVisible())) await page.locator('details').filter({ has: grupo }).locator('summary').click();
    await grupo.click();
    const dlg = page.getByRole('dialog', { name: 'Mensaje para tu grupo' });
    await expect(dlg).toBeVisible();
    const texto = dlg.locator('#grupoTexto');
    await expect(texto).toHaveValue(new RegExp(cod));
    await expect(texto).toHaveValue(/\?tienda=|showroomcito\.com\/[a-z0-9-]+/);   // enlace largo o corto
    await dlg.getByRole('button', { name: /Preventa/ }).click();
    await expect(texto).toHaveValue(/PREVENTA/);
    await expect(dlg.getByRole('link', { name: 'Enviar por WhatsApp' })).toBeVisible();
  });

  test('CP-088 El enlace del grupo solo acepta chat.whatsapp.com @REQ-030', async ({ page }) => {
    await entrar(page, A.user, A.pass);
    await page.getByRole('tab', { name: /Datos de la tienda/ }).click();
    const campo = page.getByLabel('Grupo de WhatsApp de ventas (enlace)');
    const antes = await campo.inputValue();
    await campo.fill('https://ejemplo.com/grupo');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('chat.whatsapp.com');
    await campo.fill(antes);   // no se guarda nada
  });
});
