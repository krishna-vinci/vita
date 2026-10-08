import { describe, expect, it } from "vitest";
import { FileLocks } from "./lock.js";

describe("FileLocks", () => {
  it("serialises acquirers on the same file in FIFO order", async () => {
    const locks = new FileLocks();
    const order: string[] = [];
    const first = await locks.acquire("outline.md", "first");
    expect(locks.isHeld("outline.md")).toBe(true);
    const second = locks.acquire("outline.md", "second").then((release) => {
      order.push("second");
      return release;
    });
    const third = locks.acquire("outline.md", "third").then((release) => {
      order.push("third");
      return release;
    });
    await Promise.resolve();
    expect(order).toEqual([]);
    first();
    const releaseSecond = await second;
    expect(order).toEqual(["second"]);
    expect(locks.isHeld("outline.md")).toBe(true);
    releaseSecond();
    const releaseThird = await third;
    expect(order).toEqual(["second", "third"]);
    releaseThird();
    expect(locks.isHeld("outline.md")).toBe(false);
  });

  it("allows different files concurrently and treats release as idempotent", async () => {
    const locks = new FileLocks();
    expect(locks.isHeld("outline.md")).toBe(false);
    const first = await locks.acquire("outline.md", "writer");
    const other = await locks.acquire("projects.md", "researcher");
    expect(locks.isHeld("projects.md")).toBe(true);
    first();
    const next = await locks.acquire("outline.md", "user");
    first();
    expect(locks.isHeld("outline.md")).toBe(true);
    next();
    other();
    expect(locks.isHeld("outline.md")).toBe(false);
    expect(locks.isHeld("projects.md")).toBe(false);
  });
});
