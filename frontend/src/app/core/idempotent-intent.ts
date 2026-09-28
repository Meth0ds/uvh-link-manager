import { ApiRequestError } from "./services/api.service";

/**
 * Clave de idempotencia por intención para las mutaciones del panel, con la
 * misma convención que las acciones masivas y la importación CSV: la clave
 * identifica la INTENCIÓN, no la petición.
 *
 * - Se reutiliza mientras el desenlace del intento anterior sea ambiguo (sin
 *   respuesta, `5xx` o el `409` de relevo): el reintento debe reproducir la
 *   respuesta original, nunca aplicar el efecto dos veces.
 * - Una respuesta definitiva del servidor la descarta con la intención: el
 *   siguiente intento es una intención nueva y recibe clave nueva.
 * - El éxito la sella (el servidor conserva la respuesta 24 h) y la olvida.
 *
 * El hueco es por firma, no único: `add()` y las acciones por fila corren en
 * slots de operación distintos y no deben perderse la clave la una a la otra.
 */
export class IdempotentIntent {
  private readonly pending = new Map<string, string>();

  async run<T>(signature: string, send: (key: string) => Promise<T>): Promise<T> {
    const key = this.pending.get(signature) ?? crypto.randomUUID();
    this.pending.set(signature, key);
    try {
      const result = await send(key);
      this.pending.delete(signature);
      return result;
    } catch (err) {
      // Una respuesta definitiva (cualquier 1xx-4xx que no sea el 409 de
      // relevo) cierra la intención. Sin respuesta (status 0) o con un 5xx la
      // clave se conserva para que el siguiente intento reproduzca.
      const status = err instanceof ApiRequestError ? err.status : 0;
      if (status > 0 && status < 500 && status !== 409) {
        this.pending.delete(signature);
      }
      throw err;
    }
  }
}
