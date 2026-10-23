import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
