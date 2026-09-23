import { ApiRequestError } from "./services/api.service";

/**
 * The sentence a failure is shown with.
 *
 * The API explains its own refusals, so its message is preferred; when the
 * failure carries none (a network cut, a timeout, a crash in the response
 * pipeline) the caller's text is what the operator reads.
 */
export function apiMessage(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

/**
 * The same sentence, read the way the admin console has to read it.
 *
 * A 403 there is not the API rejecting the request but the session: the admin
 * window closed and the screen has to say that instead of repeating a generic
 * sentence. One mapper, so every queue of the console answers the same thing.
 */
export function adminMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError && error.status === 403) {
    return "La consola requiere una sesión de administrador con MFA completado en este navegador.";
  }
  return apiMessage(error, fallback);
}
