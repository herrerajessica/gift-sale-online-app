import { test, expect, Page } from '@playwright/test';
import { A, entrar, enVistaPrevia } from './support/app';

// Micrófono simulado: el test "habla" mandando lo que devolvería el navegador (incluidas sus fallas).
async function microfonoFalso(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__srs = [];
    class SRFalso {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1; grammars: unknown = null;
      onresult: any = null; onend: any = null; onerror: any = null; activo = false;
      constructor() { w.__srs.push(this); }
      start() { this.activo = true; }
      stop() { this.activo = false; setTimeout(() => this.onend && this.onend(), 0); }
    }
    w.SpeechRecognition = SRFalso; w.webkitSpeechRecognition = SRFalso;
    // resultados: [[texto, alternativa2…], final?]
    // Como Chrome: cada resultado nuevo va en el índice siguiente de la misma sesión
    w.__hablar = (resultados: [string[], boolean][]) => {
      const sr = w.__srs[w.__srs.length - 1];
      sr.res = sr.res || [];
      const desde = sr.res.length;
      resultados.forEach(([alts, fin]) => sr.res.push(Object.assign(alts.map((transcript) => ({ transcript })), { isFinal: fin })));
      sr.onresult && sr.onresult({ resultIndex: desde, results: sr.res });
    };
    // Falla de Android: vuelve a mandar el mismo resultado (mismo índice)
    w.__repetir = () => { const sr = w.__srs[w.__srs.length - 1]; sr.onresult && sr.onresult({ resultIndex: sr.res.length - 1, results: sr.res }); };
    // El celular corta la escucha solo (silencio)
    w.__cortar = () => { const sr = w.__srs[w.__srs.length - 1]; sr.activo = false; sr.onend && sr.onend(); };
  });
}

test.describe('REQ-037 Voz reforzada: pausa, reanudación y vocabulario', () => {
  test.skip(!enVistaPrevia && (!A.user || !A.pass), 'Define TEST_USER y TEST_PASSWORD');

  test('CP-109 El dictado corrige marcas, no repite frases y sigue tras un silencio @REQ-037', async ({ page }) => {
    await microfonoFalso(page);
    await entrar(page, A.user, A.pass);
    await page.locator('#dictBtn').click();
    const dlg = page.getByRole('dialog', { name: 'Dictar productos' });
    await dlg.getByRole('button', { name: 'Empezar a dictar' }).click();
    await expect(dlg.getByText('Te escucho')).toBeVisible();

    // Marca mal entendida por el navegador → se corrige con el vocabulario
    await page.evaluate(() => (window as any).__hablar([[['cartera maicol cors negra 85 soles siguiente'], true]]));
    await expect(dlg.locator('.dict-item textarea').first()).toHaveValue(/Michael Kors/);

    // Android repite el mismo resultado: no se duplica
    await page.evaluate(() => (window as any).__repetir());
    await page.evaluate(() => (window as any).__hablar([[['cartera maicol cors negra 85 soles siguiente'], true]]));   // y en otro índice
    await expect(dlg.locator('.dict-item')).toHaveCount(1);

    // Elige la opción con palabras conocidas (la 2.ª alternativa trae la marca bien)
    await page.evaluate(() => (window as any).__hablar([[['polo de tommy hill figure 45 soles', 'polo tommy hilfiger 45 soles'], true]]));
    await expect(dlg.locator('#dictBuffer')).toContainText('Tommy Hilfiger');

    // Silencio: el navegador se corta y la app vuelve a escuchar sola, sin perder el producto en curso
    const antes = await page.evaluate(() => (window as any).__srs.length);
    await page.evaluate(() => (window as any).__cortar());
    await expect.poll(() => page.evaluate(() => (window as any).__srs.length)).toBeGreaterThan(antes);
    await page.evaluate(() => (window as any).__hablar([[['talla M siguiente'], true]]));
    await expect(dlg.locator('.dict-item')).toHaveCount(2);
    await expect(dlg.locator('.dict-item textarea').nth(1)).toHaveValue(/Tommy Hilfiger.*talla M/);

    // Pausar y seguir donde se quedó
    await dlg.getByRole('button', { name: 'Pausar el dictado' }).click();
    await expect(dlg.getByRole('button', { name: 'Seguir dictando' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Seguir dictando' }).click();
    await expect(dlg.getByText('Te escucho')).toBeVisible();
  });
});
