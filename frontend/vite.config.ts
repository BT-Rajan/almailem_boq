/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Where /api goes. The installer sets BOQ_API_URL for `vite preview` under pm2 (installer.sh).
const api = process.env['BOQ_API_URL'] ?? 'http://127.0.0.1:3000';
// Host names the preview server answers to (IP addresses and localhost always work).
const publicHost = process.env['BOQ_PUBLIC_HOST'];
// The app's own policy: the production build has no inline scripts or styles (HARDENING.md S3).
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
};
// xfwd: pass the browser's address on, so login rate limits apply per person (TRUST_PROXY=loopback).
const proxy = { '/api': { target: api, xfwd: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: {
    proxy,
    headers: SECURITY_HEADERS,
    ...(publicHost && publicHost !== 'localhost' && { allowedHosts: [publicHost] }),
  },
  test: { environment: 'jsdom', globals: false, include: ['src/**/*.test.{ts,tsx}'] },
});
