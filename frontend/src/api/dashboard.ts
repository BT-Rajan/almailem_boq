import type { Dashboard } from '@boq/shared';
import { api } from './client';

export const getDashboard = () => api<Dashboard>('GET', '/api/dashboard');
