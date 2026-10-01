// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App shell', () => {
  it('renders the brand', () => {
    render(<App />);
    expect(screen.getByText('Almailem BoQ Manager')).toBeTruthy();
  });
});
