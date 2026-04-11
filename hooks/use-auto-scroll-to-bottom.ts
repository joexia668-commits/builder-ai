import { useEffect, useRef } from "react";

/**
 * Auto-scrolls a container to the bottom whenever `deps` change, unless
 * the user has manually scrolled up. Resumes auto-scroll when the user
 * scrolls back to within 20px of the bottom.
 */
export function useAutoScrollToBottom<T extends HTMLElement>(
  ref: React.RefObject<T>,
  deps: readonly unknown[]
): void {
  const userScrolledUp = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const onScroll = (): void => {
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      userScrolledUp.current = distanceFromBottom > 20;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (el === null || userScrolledUp.current) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
