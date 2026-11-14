import { test, expect } from '@playwright/test';

// Vitrina aprobada con al menos un producto disponible con precio.
const TIENDA = process.env.TEST_STORE ?? '';
// Vitrina recién creada que todavía no fue aprobada.
const TIENDA_PENDIENTE = process.env.TEST_PENDING_STORE ?? '';

test.describe('REQ-003 Catálogo público por vendedora', () => {
  test.skip(!TIENDA, 'Define TEST_STORE con el enlace de una vitrina aprobada');

  test('CP-004 El cliente ve la vitrina sin cuenta @REQ-003', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA}`);
    await expect(page.getByRole('searchbox', { name: 'Buscar producto' })).toBeVisible();
    await expect(page.locator('#grid .card').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Arrastra aquí todas las fotos' })).toBeHidden();
  });

  test('CP-005 Precio en dólares y soles @REQ-003', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA}`);
    const etiqueta = page.locator('#grid .card .price').filter({ hasText: '$' }).first();
    await expect(etiqueta).toContainText('$');
    await expect(etiqueta).toContainText('S/');
  });
});

test.describe('REQ-004 Pedido por WhatsApp', () => {
  test.skip(!TIENDA, 'Define TEST_STORE');

  test('CP-006 Armar pedido y generar mensaje @REQ-004', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA}`);
    const primera = page.locator('#grid .card').filter({ has: page.getByRole('button', { name: '+ Agregar al pedido' }) }).first();
    const nombre = (await primera.locator('.name').innerText()).trim();
    await primera.getByRole('button', { name: '+ Agregar al pedido' }).click();
    await page.locator('#cartbar').click();
    const dialogo = page.getByRole('dialog', { name: 'Mi pedido' });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.locator('.preview')).toContainText(nombre);
    await expect(dialogo.locator('.preview')).toContainText('Total:');
    const enlace = dialogo.getByRole('link', { name: 'Enviar pedido por WhatsApp' });
    await expect(enlace).toHaveAttribute('href', /^https:\/\/wa\.me\/\d+\?text=/);
  });
});

test.describe('REQ-006 Aprobación de vitrinas', () => {
  test.skip(!TIENDA_PENDIENTE, 'Define TEST_PENDING_STORE con una vitrina pendiente');

  test('CP-008 Una vitrina pendiente no muestra productos @REQ-006', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA_PENDIENTE}`);
    await expect(page.getByRole('heading', { name: 'Esta vitrina abrirá pronto' })).toBeVisible();
    await expect(page.locator('#grid .card')).toHaveCount(0);
  });
});

test.describe('REQ-010 Marca y cantidad por producto', () => {
  test.skip(!TIENDA, 'Define TEST_STORE');

  test('CP-019 Un producto agotado no se puede agregar al pedido @REQ-010', async ({ page }) => {
    await page.goto(`/?tienda=${TIENDA}`);
    const agotados = page.locator('#grid .card.agotado');
    test.skip((await agotados.count()) === 0, 'La vitrina de prueba no tiene productos con cantidad 0');
    await expect(agotados.first().getByRole('button', { name: 'Agotado' })).toBeDisabled();
  });
});
