import { computed, signal } from "@angular/core";

/**
 * Un dueño único para "hay una mutación en vuelo, y sólo ella libera su hueco".
 *
 * El patrón anterior repartía esa responsabilidad entre cada componente: un
 * signal con el id de la fila, una guarda `if (accion() !== null) return`, y un
 * `finally` que limpiaba el signal. Comparar por identidad de *contexto* —"el
 * workspace sigue siendo el mismo"— no basta, porque el mismo workspace puede
 * volver a ser el actual:
 *
 *   workspace A -> empieza A1 -> cambio a B -> vuelvo a A -> empieza A2 -> A1
 *   termina tarde -> `isCurrent()` vuelve a ser cierto y `actionId` sigue
 *   siendo el mismo id -> A1 borra el hueco de A2
 *
 * Lo que falta no es identidad de workspace sino identidad de **operación**, y
 * esta clase la posee: un contador monotónico que nunca se reutiliza. `settle()`
 * sólo libera cuando la operación que llama sigue siendo la dueña, así que una
 * operación vieja que llega tarde no puede reabrir las filas de una nueva.
 *
 * El valor visible (`value`) es lo que la plantilla necesita para deshabilitar
 * las filas de esa fila concreta. Se expone de sólo lectura a propósito: toda
 * escritura pasa por `begin()`/`settle()`/`reset()`, que es lo que lleva la
 * cuenta de la operación. Una acción sin fila propia usa `0` como valor, igual
 * que hacía el id centinela que ya existía.
 */
export class OwnedMutations {
  private sequence = 0;
  private active: { operation: number; value: number } | null = null;
  private readonly activeValue = signal<number | null>(null);

  /** Valor de la operación en vuelo (id de fila), o `null` si no hay ninguna. */
  readonly value = this.activeValue.asReadonly();

  /** Cierto mientras haya una mutación sin terminar. */
  readonly busy = computed(() => this.activeValue() !== null);

  /**
   * Registra el comienzo de una operación sobre `value`.
   *
   * Devolver un testigo en vez de sólo fijar el signal es lo que permite saber
   * después quién es el dueño: dos operaciones sobre la misma fila tienen
   * valores iguales y operaciones distintas.
   */
  begin(value: number): { operation: number; value: number } {
    this.sequence += 1;
    const operation = { operation: this.sequence, value };
    this.active = operation;
    this.activeValue.set(value);

    return operation;
  }

  /** ¿Esta operación sigue siendo la dueña del hueco? */
  isCurrent(operation: { operation: number }): boolean {
    return this.active?.operation === operation.operation;
  }

  /** Libera el hueco, sólo si quien llama sigue siendo el dueño. */
  settle(operation: { operation: number }): void {
    if (!this.isCurrent(operation)) return;
    this.active = null;
    this.activeValue.set(null);
  }

  /**
   * El contexto que se va: ninguna operación en vuelo sigue siendo dueña aquí.
   *
   * Lo llama el `effect` que reacciona al cambio de contexto (workspace, webhook
   * o rol), y es la mitad que faltaba: sin esto, una operación cuyo `finally`
   * decide no limpiar deja el hueco ocupado para siempre y la vista queda muerta
   * hasta remontar la ruta.
   */
  reset(): void {
    this.active = null;
    this.activeValue.set(null);
  }
}
