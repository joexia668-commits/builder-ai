import { retryWithBackoff } from "@/lib/engineer-circuit";

jest.useFakeTimers();

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
