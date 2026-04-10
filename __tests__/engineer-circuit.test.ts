import { retryWithBackoff, runLayerWithFallback } from "@/lib/engineer-circuit";
import type { ScaffoldFile } from "@/lib/types";

jest.useFakeTimers();

const FILE_A: ScaffoldFile = { path: "/A.js", description: "A", exports: ["A"], deps: [], hints: "" };
const FILE_B: ScaffoldFile = { path: "/B.js", description: "B", exports: ["B"], deps: ["/A.js"], hints: "" };
const FILE_C: ScaffoldFile = { path: "/C.js", description: "C", exports: ["C"], deps: [], hints: "" };

describe("retryWithBackoff", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-01: succeeds on first attempt — fn called once
  it("EC-01: 首次成功不重试", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, 3, 100);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-02: fails once, succeeds on attempt 2
  it("EC-02: 第一次失败后重试成功", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const promise = retryWithBackoff(fn, 3, 100);
    await jest.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // EC-03: fails all attempts — throws last error
  it("EC-03: 耗尽重试次数后抛出最后错误", async () => {
    const err = new Error("always fails");
    const fn = jest.fn().mockRejectedValue(err);

    const promise = retryWithBackoff(fn, 3, 100);
    // Bind rejects handler BEFORE advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow("always fails");
    await jest.advanceTimersByTimeAsync(100);
    await jest.advanceTimersByTimeAsync(200);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  // EC-04: aborted before retry — throws Aborted
  it("EC-04: abort 信号触发后不重试", async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockRejectedValue(new Error("fail"));

    const promise = retryWithBackoff(fn, 3, 100, controller.signal);
    // Bind rejects handler BEFORE aborting/advancing timers to avoid unhandled rejection
    const assertion = expect(promise).rejects.toThrow();
    controller.abort();
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-05: exponential backoff — delays double each attempt
  it("EC-05: 退避延迟指数增长（100ms → 200ms）", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("1"))
      .mockRejectedValueOnce(new Error("2"))
      .mockResolvedValueOnce("ok");

    const promise = retryWithBackoff(fn, 3, 100);
    expect(fn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(99);
    expect(fn).toHaveBeenCalledTimes(1); // not yet
    await jest.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2); // after 100ms
    await jest.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(2); // not yet
    await jest.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3); // after 200ms
    await expect(promise).resolves.toBe("ok");
  });
});

describe("runLayerWithFallback", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-10: full-layer request succeeds — returns files, no fallback
  it("EC-10: 整层请求成功，直接返回文件", async () => {
    const requestFn = jest.fn().mockResolvedValue({ "/A.js": "code-a", "/B.js": "code-b" });
    const result = await runLayerWithFallback([FILE_A, FILE_B], requestFn);
    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(requestFn).toHaveBeenCalledTimes(1);
  });

  // EC-11: layer fails 3×, fallback per-file both succeed
  it("EC-11: 整层失败后降级为逐文件请求", async () => {
    const fn = jest
      .fn()
      // 3 full-layer failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file: A succeeds
      .mockResolvedValueOnce({ "/A.js": "code-a" })
      // per-file: B succeeds
      .mockResolvedValueOnce({ "/B.js": "code-b" });

    const promise = runLayerWithFallback([FILE_A, FILE_B], fn);
    // advance through 3 layer retries: 100ms + 200ms
    await jest.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
  });

  // EC-12: fallback per-file: A fails, B succeeds — A in failed[]
  it("EC-12: 逐文件降级时部分文件失败", async () => {
    const fn = jest
      .fn()
      // 3 full-layer failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file A: 3 failures
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      // per-file B: success
      .mockResolvedValueOnce({ "/B.js": "code-b" });

    const promise = runLayerWithFallback([FILE_A, FILE_B], fn);
    await jest.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(result.failed).toContain("/A.js");
    expect(result.files["/B.js"]).toBe("code-b");
  });

  // EC-13: circuit breaker — 3 consecutive per-file failures → 4th file skipped
  it("EC-13: 断路器触发后剩余文件直接标记失败", async () => {
    const FILE_D: ScaffoldFile = { path: "/D.js", description: "D", exports: ["D"], deps: [], hints: "" };
    const fn = jest.fn().mockRejectedValue(new Error("API down"));

    const promise = runLayerWithFallback([FILE_A, FILE_B, FILE_C, FILE_D], fn);
    await jest.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result.failed).toContain("/A.js");
    expect(result.failed).toContain("/B.js");
    expect(result.failed).toContain("/C.js");
    expect(result.failed).toContain("/D.js");
    // D was never attempted (circuit was open after A, B, C consecutive failures)
    const dCalls = fn.mock.calls.filter(([files]) => files.length === 1 && files[0].path === "/D.js");
    expect(dCalls).toHaveLength(0);
  });
});
