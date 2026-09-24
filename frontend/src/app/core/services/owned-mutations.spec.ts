import { OwnedMutations } from "./owned-mutations";

describe("OwnedMutations", () => {
  it("keeps the in-flight value visible for the template", () => {
    const mutations = new OwnedMutations();
    expect(mutations.value()).toBeNull();
    expect(mutations.busy()).toBeFalse();

    const operation = mutations.begin(7);
    expect(mutations.value()).toBe(7);
    expect(mutations.busy()).toBeTrue();

    mutations.settle(operation);
    expect(mutations.value()).toBeNull();
    expect(mutations.busy()).toBeFalse();
  });

  it("refuses to let a stale operation free a newer one on the same row", () => {
    // El caso ABA: A -> B -> A, la misma fila, dos operaciones. La primera no
    // puede reabrir las filas de la segunda por terminar tarde.
    const mutations = new OwnedMutations();
    const first = mutations.begin(7);
    mutations.reset();
    const second = mutations.begin(7);

    mutations.settle(first);

    expect(mutations.isCurrent(first)).toBeFalse();
    expect(mutations.isCurrent(second)).toBeTrue();
    expect(mutations.value()).toBe(7);

    mutations.settle(second);
    expect(mutations.value()).toBeNull();
  });

  it("hands out a new identity for each operation, even on the same row", () => {
    const mutations = new OwnedMutations();
    const first = mutations.begin(3);
    const second = mutations.begin(3);

    expect(second.operation).not.toBe(first.operation);
    expect(mutations.isCurrent(first)).toBeFalse();
    expect(mutations.isCurrent(second)).toBeTrue();

    // Y la vieja tampoco puede liberar: sólo la dueña.
    mutations.settle(first);
    expect(mutations.value()).toBe(3);
  });

  it("clears the slot on a context switch so the next view is not blocked", () => {
    const mutations = new OwnedMutations();
    const operation = mutations.begin(11);

    mutations.reset();

    expect(mutations.value()).toBeNull();
    expect(mutations.isCurrent(operation)).toBeFalse();
    // Y una operación que llegue tarde después del reset tampoco reabre nada.
    mutations.settle(operation);
    expect(mutations.value()).toBeNull();
  });

  it("treats 0 as a value, not as absence", () => {
    // Una acción sin fila propia (enviar una prueba, por ejemplo) usa 0; el
    // hueco sigue ocupado y las filas siguen bloqueadas.
    const mutations = new OwnedMutations();
    const operation = mutations.begin(0);

    expect(mutations.value()).toBe(0);
    expect(mutations.busy()).toBeTrue();

    mutations.settle(operation);
    expect(mutations.value()).toBeNull();
  });
});
