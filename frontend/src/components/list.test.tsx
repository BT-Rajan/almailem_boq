// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../testing';
import { ProjectsPage } from '../pages/projects/ProjectsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project = (i: number) => ({
  id: `p${i}`,
  code: `P-${i}`,
  name: `Project ${i}`,
  status: 'active',
  ownerName: 'Ada',
  startDate: null,
  endDate: null,
});

describe('shared list pattern (Projects page)', () => {
  it('sorts on the server: first click ascending, second descending, back to page 1', async () => {
    const calls = mockApi({
      'GET /api/projects': () => ({
        data: { items: [project(1)], total: 120, page: 1, pageSize: 50 },
      }),
    });
    render(<ProjectsPage />);
    await screen.findByText('Project 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.at(-1)?.url).toContain('page=2'));

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/projects?sort=name&dir=asc&page=1'));
    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'ascending',
    );
    fireEvent.click(screen.getByRole('button', { name: /Name/ }));
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/projects?sort=name&dir=desc&page=1'));
  });

  it('pages from the total the server reports', async () => {
    mockApi({
      'GET /api/projects': () => ({
        data: { items: [project(1)], total: 120, page: 1, pageSize: 50 },
      }),
    });
    render(<ProjectsPage />);
    expect(await screen.findByText('Page 1 of 3')).toBeTruthy();
    expect(screen.getByText('120 projects')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('waits for typing to pause before searching, then starts again at page 1', async () => {
    const calls = mockApi({
      'GET /api/projects': () => ({ data: { items: [], total: 0, page: 1, pageSize: 50 } }),
    });
    render(<ProjectsPage />);
    await screen.findByText('No projects found');
    const before = calls.length;
    const box = screen.getByLabelText('Search projects');
    for (const text of ['t', 'to', 'tow']) fireEvent.change(box, { target: { value: text } });
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/projects?q=tow&page=1'));
    expect(calls.length - before).toBe(1);
  });
});
