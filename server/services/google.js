/**
 * Entrar com o Google (OAuth 2.0, sem SDK).
 *
 * O botão só aparece se GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET estiverem
 * definidos. A troca do código pelo token acontece servidor a servidor, e o
 * perfil é lido do endpoint oficial de userinfo.
 */
import { config } from '../config.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const googleEnabled = () => Boolean(config.google.clientId && config.google.clientSecret);

/** Descobre o endereço de retorno a partir do pedido (funciona atrás de proxy). */
export function callbackUrl(req) {
  if (config.google.redirectUri) return config.google.redirectUri;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwardedProto || (config.isProd ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

export function authorizeUrl({ state, redirect }) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode({ code, redirect }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google recusou a troca do código (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json();
}

export async function fetchProfile(accessToken) {
  const response = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Não consegui ler o perfil no Google (${response.status}).`);
  const profile = await response.json();
  if (!profile.sub) throw new Error('O Google devolveu um perfil sem identificador.');
  if (!profile.email) throw new Error('Essa conta do Google não expõe um e-mail.');
  if (profile.email_verified === false) throw new Error('O e-mail dessa conta do Google não está verificado.');
  return {
    sub: String(profile.sub),
    email: String(profile.email).toLowerCase(),
    name: String(profile.name || profile.given_name || profile.email.split('@')[0]),
  };
}
