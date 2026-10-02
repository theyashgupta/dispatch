import type { BoardRepository } from "../store/board-repository.js";

/**
 * Build a `BoardRepository` for a unit test from the members the test fakes.
 *
 * @remarks
 * Every repository member is a method, so an unfaked member reads as a function that throws
 * `fakeBoardRepository: <name> is not faked` when called. Symbol keys and `then` read as
 * undefined, so inspecting or awaiting the fake does not throw.
 */
export function fakeBoardRepository(
  overrides: Partial<BoardRepository>,
): BoardRepository {
  return new Proxy(overrides as BoardRepository, {
    get(target, prop) {
      if (prop in target || typeof prop === "symbol" || prop === "then") {
        return Reflect.get(target, prop) as unknown;
      }
      return () => {
        throw new Error(`fakeBoardRepository: ${prop} is not faked`);
      };
    },
  });
}
