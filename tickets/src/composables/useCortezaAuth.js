import { createCortezaAuth } from '@/lib/auth'

let auth

export function useCortezaAuth() {
  if (!auth) {
    // Corteza injects these URLs through /tickets/config.js. Use same-origin
    // paths, including the Vite proxy during local frontend development.
    const authBase = new URL(
      window.CortezaAuth || '/auth',
      window.location.origin,
    ).pathname
    auth = createCortezaAuth({
      browser: window,
      authBase,
      appBase: import.meta.env.BASE_URL,
    })
  }
  return auth
}
