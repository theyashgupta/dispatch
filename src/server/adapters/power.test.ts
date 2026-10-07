import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPowerHolder } from "./power.js";

type ChildProcess = ReturnType<
  NonNullable<Parameters<typeof createPowerHolder>[0]>
>;

function fakeSpawner() {
  const spawned: { cmd: string; args: string[]; killed: boolean }[] = [];
  const spawner = (cmd: string, args: string[]) => {
    const entry = { cmd, args, killed: false };
    spawned.push(entry);
    const child = Object.assign(new EventEmitter(), {
      pid: 1000 + spawned.length,
      kill: () => {
        entry.killed = true;
        return true;
      },
    });
    return child as unknown as ChildProcess;
  };
  return { spawned, spawner };
}

void test("one caffeinate child is held across many wanted calls and ended when not wanted", () => {
  const { spawned, spawner } = fakeSpawner();
  const holder = createPowerHolder(spawner);
  assert.equal(holder.pid(), null);
  holder.set(true);
  holder.set(true);
  holder.set(true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, "caffeinate");
  assert.deepEqual(spawned[0].args, ["-is", "-w", String(process.pid)]);
  assert.equal(holder.pid(), 1001);
  holder.set(false);
  assert.equal(spawned[0].killed, true);
  assert.equal(holder.pid(), null);
  holder.set(false);
  assert.equal(spawned.length, 1);
});

void test("a child that exits on its own is replaced at the next wanted call", () => {
  const children: EventEmitter[] = [];
  const { spawner } = fakeSpawner();
  const holder = createPowerHolder((cmd, args) => {
    const child = spawner(cmd, args);
    children.push(child);
    return child;
  });
  holder.set(true);
  children[0].emit("exit", 0);
  assert.equal(holder.pid(), null);
  holder.set(true);
  assert.equal(children.length, 2);
  assert.equal(holder.pid(), 1002);
});

void test("a holder never asked to hold spawns nothing", () => {
  const { spawned, spawner } = fakeSpawner();
  const holder = createPowerHolder(spawner);
  holder.set(false);
  assert.equal(spawned.length, 0);
  assert.equal(holder.pid(), null);
});
