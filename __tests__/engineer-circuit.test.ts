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

describe("runLayerWithFallback (subset-aware)", () => {
  beforeEach(() => jest.clearAllTimers());

  // EC-10: all files succeed in attempt 1
  it("EC-10: 首次全部成功，一次调用完成", async () => {
    const requestFn = jest.fn().mockResolvedValue({
      files: { "/A.js": "code-a", "/B.js": "code-b" },
      failed: [],
    });
    const result = await runLayerWithFallback([FILE_A, FILE_B], requestFn);
    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(requestFn).toHaveBeenCalledTimes(1);
    expect(requestFn.mock.calls[0][0]).toHaveLength(2);
    expect(requestFn.mock.calls[0][1]).toEqual({ attempt: 1, priorFailed: [] });
  });

  // EC-11: attempt 1 partial, attempt 2 only re-requests failed subset
  it("EC-11: 首次部分失败，第二次仅重试失败子集", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][0]).toHaveLength(1);
    expect(fn.mock.calls[1][0][0].path).toBe("/B.js");
    expect(fn.mock.calls[1][1]).toEqual({ attempt: 2, priorFailed: ["/B.js"] });
  });

  // EC-12: both layer attempts fail → per-file fallback (2 tries per file)
  it("EC-12: 两轮整层失败后降级为逐文件，每文件最多 2 次", async () => {
    const fn = jest.fn();
    fn.mockResolvedValueOnce({ files: {}, failed: ["/A.js", "/B.js"] });
    fn.mockResolvedValueOnce({ files: {}, failed: ["/A.js", "/B.js"] });
    fn.mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: [] });
    fn.mockResolvedValueOnce({ files: {}, failed: ["/B.js"] });
    fn.mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(result.failed).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(5);
  });

  // EC-13: circuit breaker — 3 consecutive per-file failures abort remaining
  it("EC-13: 断路器触发后剩余文件直接标记失败", async () => {
    const FILE_D: ScaffoldFile = { path: "/D.js", description: "D", exports: ["D"], deps: [], hints: "" };
    const fn = jest.fn().mockImplementation(async (files: readonly ScaffoldFile[]) => ({
      files: {},
      failed: files.map((f) => f.path),
    }));

    const result = await runLayerWithFallback([FILE_A, FILE_B, FILE_C, FILE_D], fn);

    expect(result.failed.sort()).toEqual(["/A.js", "/B.js", "/C.js", "/D.js"].sort());
    const dSingleCalls = fn.mock.calls.filter(
      ([files]) => files.length === 1 && files[0].path === "/D.js"
    );
    expect(dSingleCalls).toHaveLength(0);
  });

  // EC-20: onAttempt callback fires with correct metadata
  it("EC-20: onAttempt 在每次尝试前被调用", async () => {
    const events: Array<{ attempt: number; reason: string; phase: string; failedSubset: string[] }> = [];
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: { "/B.js": "code-b" }, failed: [] });

    await runLayerWithFallback(
      [FILE_A, FILE_B],
      fn,
      undefined,
      (info) => {
        events.push({
          attempt: info.attempt,
          reason: info.reason,
          phase: info.phase,
          failedSubset: [...info.failedSubset],
        });
      }
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      attempt: 1,
      reason: "initial",
      phase: "layer",
      failedSubset: ["/A.js", "/B.js"],
    });
    expect(events[1]).toEqual({
      attempt: 2,
      reason: "parse_failed",
      phase: "layer",
      failedSubset: ["/B.js"],
    });
  });

  // EC-21: onAttempt reports per_file_fallback phase
  it("EC-21: onAttempt 在降级阶段 phase=per_file", async () => {
    const events: Array<{ phase: string; reason: string }> = [];
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: {}, failed: ["/A.js"] })
      .mockResolvedValueOnce({ files: {}, failed: ["/A.js"] })
      .mockResolvedValueOnce({ files: { "/A.js": "code-a" }, failed: [] });

    await runLayerWithFallback(
      [FILE_A],
      fn,
      undefined,
      (info) => { events.push({ phase: info.phase, reason: info.reason }); }
    );

    expect(events.map((e) => e.phase)).toEqual(["layer", "layer", "per_file"]);
    expect(events[2].reason).toBe("per_file_fallback");
  });

  // EC-22: requestFn throwing is treated as "all files failed this attempt"
  it("EC-22: requestFn 抛异常等价于全部文件失败", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error("HTTP 500"))
      .mockResolvedValueOnce({ files: { "/A.js": "code-a", "/B.js": "code-b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B], fn);

    expect(result.files).toEqual({ "/A.js": "code-a", "/B.js": "code-b" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[1][1]).toEqual({ attempt: 2, priorFailed: ["/A.js", "/B.js"] });
  });

  // EC-23: abort signal mid-retry halts further attempts
  it("EC-23: abort 信号触发后停止重试", async () => {
    const controller = new AbortController();
    const fn = jest.fn().mockImplementation(async () => {
      controller.abort();
      return { files: {}, failed: ["/A.js"] };
    });

    await expect(
      runLayerWithFallback([FILE_A], fn, controller.signal)
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // EC-24: accumulated files persist across attempts
  it("EC-24: 跨 attempt 累积已成功文件", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ files: { "/A.js": "a", "/C.js": "c" }, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: {}, failed: ["/B.js"] })
      .mockResolvedValueOnce({ files: { "/B.js": "b" }, failed: [] });

    const result = await runLayerWithFallback([FILE_A, FILE_B, FILE_C], fn);

    expect(result.files).toEqual({ "/A.js": "a", "/B.js": "b", "/C.js": "c" });
    expect(result.failed).toEqual([]);
  });
});
