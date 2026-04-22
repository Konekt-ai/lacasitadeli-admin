import { test, expect } from '@playwright/test';

test('Dashboard renders with key components', async ({ page }) => {
  await page.goto('http://localhost:3001');

  // Verify main logo text (part of sidebar)
  await expect(page.getByRole('heading', { name: 'La Casita Deli' })).toBeVisible();

  // Verify main heading
  await expect(page.getByRole('heading', { name: 'DASHBOARD' })).toBeVisible();

  // Verify summary cards (labels)
  await expect(page.getByText('Ventas Hoy', { exact: true })).toBeVisible();
  await expect(page.getByText('Ingresos', { exact: true })).toBeVisible();
  await expect(page.getByText('Productos', { exact: true })).toBeVisible();

  // Verify sidebar navigation items
  await expect(page.getByRole('button', { name: 'dashboard Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'inventory_2 Inventario' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'point_of_sale Ventas' })).toBeVisible();
});

test('POS view is functional', async ({ page }) => {
  await page.goto('http://localhost:3001');
  await page.getByRole('button', { name: 'point_of_sale Ventas' }).click();

  // Verify POS components
  await expect(page.getByPlaceholder('Search products...')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Carrito' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Finalizar Venta' })).toBeVisible();
});
