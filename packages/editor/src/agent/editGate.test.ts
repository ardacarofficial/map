import { describe, expect, it, vi } from "vitest";
import type { AgentSignal } from "@smap/agent";
import { createEditGate } from "./editGate";

const signal: AgentSignal = { aborted: false, throwIfAborted() {}, onAbort: () => () => {} };
describe("editor write admission", () => {
  it("blocks new writers immediately and drains a save admitted before async preparation", async () => {
    const gate = createEditGate(() => "world");
    const save = gate.admitSave("world");
    const edit = gate.acquireEdit("world");
    expect(() => gate.admitSave("world")).toThrow(/pending/i);
    const drained = vi.fn();
    const waiting = edit.waitForWrites(signal, Date.now() + 1000).then(drained);
    await Promise.resolve();
    expect(drained).not.toHaveBeenCalled();
    // An admitted save may finish preparation and enqueue after begin was requested.
    expect(() => save.assertAllowed()).not.toThrow();
    save.release();
    await waiting;
    edit.release("cancelled");
    expect(() => gate.admitSave("world").release()).not.toThrow();
  });
  it("rejects stale world admissions and cannot release a newer edit", async () => {
    let world = "one";
    const gate = createEditGate(() => world);
    const old = gate.acquireEdit(world);
    old.release("cancelled");
    const next = gate.acquireEdit(world);
    old.release("cancelled");
    expect(gate.blocked).toBe(true);
    next.release("approved");
    const save = gate.admitSave(world);
    world = "two";
    expect(() => save.assertAllowed()).toThrow(/world/i);
    save.release();
    expect(() => gate.acquireEdit("one")).toThrow(/world/i);
  });
  it("a failing UI observer cannot strand a newly acquired edit admission",()=>{
    const gate=createEditGate(()=>"world");
    gate.subscribe(()=>{throw Error("Observer failed");});
    const edit=gate.acquireEdit("world");expect(gate.blocked).toBe(true);edit.release("cancelled");expect(gate.blocked).toBe(false);
  });
  it("aborted drains release their subscriptions and do not begin late", async () => {
    const gate = createEditGate(() => "world");
    const save = gate.admitSave("world");
    const edit = gate.acquireEdit("world");
    let abort = () => {};
    const waiting = edit.waitForWrites({ ...signal, onAbort(cb) { abort = cb; return () => {}; } }, Date.now() + 1000);
    abort();
    await expect(waiting).rejects.toThrow();
    edit.release("failed");
    save.release();
    expect(gate.blocked).toBe(false);
  });
});
