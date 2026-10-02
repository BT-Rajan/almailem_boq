import type { SearchResults } from '@boq/shared';
import { api, queryString } from './client';

export const globalSearch = (q: string) =>
  api<SearchResults>('GET', `/api/search${queryString({ q })}`);
