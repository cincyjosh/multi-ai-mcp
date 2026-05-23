import { describe, it, expect } from "vitest";
import { runCli } from "../../src/utils/run_cli.js";

describe("runCli", () => {
  it("returns stdout from a successful command", async () => {
    const result = await runCli("echo", ["hello world"]);
    expect(result.trim()).toBe("hello world");
  });

  it("accepts stdin and passes it to the process", async () => {
    const result = await runCli("cat", [], { stdin: "hello from stdin" });
    expect(result.trim()).toBe("hello from stdin");
  });

  it("throws with stderr when command exits non-zero", async () => {
    await expect(
      runCli("bash", ["-c", "echo 'oops' >&2; exit 1"])
    ).rejects.toThrow("oops");
  });

  it("throws when the binary does not exist", async () => {
    await expect(runCli("this-binary-does-not-exist", [])).rejects.toThrow();
  });

  it("throws a timeout error when the process exceeds the timeout", async () => {
    await expect(
      runCli("sleep", ["10"], { timeoutMs: 100 })
    ).rejects.toThrow("timed out");
  });

  it("includes signal in error when process is killed by signal", async () => {
    await expect(
      runCli("bash", ["-c", "kill -9 $$"])
    ).rejects.toThrow();
  });

});
