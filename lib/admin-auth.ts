export const ADMIN_SESSION_COOKIE = "genio_admin_session";

export function getAdminUsername() {
  return process.env.ADMIN_USERNAME || "admin";
}

export function getAdminPassword() {
  return process.env.ADMIN_PASSWORD || "Bonfiglioli@123";
}

export function getAdminSecret() {
  return process.env.ADMIN_AUTH_SECRET || "genio-admin-secret";
}

export function buildSessionToken() {
  return `${getAdminUsername()}::${getAdminPassword()}::${getAdminSecret()}`;
}

export function isValidSessionToken(token: string | undefined | null) {
  if (!token) return false;
  return token === buildSessionToken();
}

export function validateAdminCredentials(username: string, password: string) {
  const expectedUser = getAdminUsername();
  const expectedPass = getAdminPassword();
  const userOk = username === expectedUser;
  const passOk = password === expectedPass;
  return userOk && passOk;
}
