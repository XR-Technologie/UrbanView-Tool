import crypto from 'node:crypto';
import { settings } from './db.js';

/* Connexion OAuth 2.0 (PKCE) au compte Google + appels à l'API Street View Publish. */

const SCOPE = 'https://www.googleapis.com/auth/streetviewpublish';
const API = 'https://streetviewpublish.googleapis.com/v1/';
const K = { id: 'google.clientId', secret: 'google.clientSecret', refresh: 'google.refreshToken' };

const pending = new Map<string, { verifier: string; redirectUri: string; returnTo: string; t: number }>();
let access: { token: string; exp: number } | null = null;

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface TokenResponse { access_token: string; expires_in: number; refresh_token?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j = await r.json() as TokenResponse & { error?: string; error_description?: string };
  if (!r.ok) throw new Error(j.error_description || j.error || 'Échec de la connexion Google');
  return j;
}

export const google = {
  status() {
    return {
      clientId: settings.get(K.id) ?? '',
      configured: !!settings.get(K.id) && !!settings.get(K.secret),
      connected: !!settings.get(K.refresh),
    };
  },

  setConfig(clientId: string, clientSecret: string) {
    const changed = clientId !== settings.get(K.id);
    settings.set(K.id, clientId.trim());
    if (clientSecret) settings.set(K.secret, clientSecret.trim());
    if (changed) { settings.del(K.refresh); access = null; }
  },

  authUrl(redirectUri: string, returnTo: string) {
    const clientId = settings.get(K.id);
    if (!clientId) throw new Error('Identifiants Google non configurés');
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    for (const [k, v] of pending) if (Date.now() - v.t > 15 * 60_000) pending.delete(k);
    pending.set(state, { verifier, redirectUri, returnTo, t: Date.now() });
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },

  async callback(code: string, state: string) {
    const p = pending.get(state);
    if (!p) throw new Error('Session de connexion expirée, réessayez.');
    pending.delete(state);
    const r = await tokenRequest({
      code,
      client_id: settings.get(K.id) ?? '',
      client_secret: settings.get(K.secret) ?? '',
      redirect_uri: p.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: p.verifier,
    });
    if (!r.refresh_token) throw new Error('Google n’a pas renvoyé de jeton durable. Retirez l’accès de l’application dans votre compte Google puis reconnectez-vous.');
    settings.set(K.refresh, r.refresh_token);
    access = { token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
    return p.returnTo;
  },

  logout() {
    settings.del(K.refresh);
    access = null;
  },

  async token() {
    if (access && access.exp > Date.now()) return access.token;
    const refresh = settings.get(K.refresh);
    if (!refresh) throw new Error('Compte Google non connecté');
    const r = await tokenRequest({
      refresh_token: refresh,
      client_id: settings.get(K.id) ?? '',
      client_secret: settings.get(K.secret) ?? '',
      grant_type: 'refresh_token',
    });
    access = { token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
    return access.token;
  },

  async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await google.token();
    const r = await fetch(path.startsWith('http') ? path : API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let j: { error?: { message?: string } } = {};
    try { j = text ? JSON.parse(text) : {}; } catch { /* réponse non JSON */ }
    if (!r.ok) throw new Error(j.error?.message || `Google a répondu ${r.status}`);
    return j as T;
  },
};
