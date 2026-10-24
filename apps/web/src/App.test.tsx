import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SIMULATION_ID } from './testing/fixtures';
import { renderApp } from './testing/render';

describe('App routes', () => {
  it('opens the simulation form at /', async () => {
    renderApp();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Simule seu empréstimo consignado' }),
    ).toBeInTheDocument();
  });

  it('answers an unknown path with a not-found page', () => {
    renderApp({ route: '/admin' });

    expect(screen.getByRole('heading', { name: 'Página não encontrada' })).toBeInTheDocument();
  });

  it('leaves the focus alone on the first load', async () => {
    renderApp();

    await screen.findByRole('heading', { level: 1, name: 'Simule seu empréstimo consignado' });
    expect(document.body).toHaveFocus();
  });

  it("moves the focus to the new page's h1 after a route change", async () => {
    const { user } = renderApp({ route: `/simulacoes/${SIMULATION_ID}` });

    await user.click(await screen.findByRole('link', { name: 'Simular novamente' }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Simule seu empréstimo consignado' }),
    ).toHaveFocus();
  });
});
