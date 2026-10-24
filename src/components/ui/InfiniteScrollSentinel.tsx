import { useEffect, useRef } from "react";
import { ListSkeleton } from "@/components/ui/ListSkeleton";

type InfiniteScrollSentinelProps = {
  onLoadMore: () => unknown;
  rows?: number;
  rootMargin?: string;
};

export function InfiniteScrollSentinel({
  onLoadMore,
  rows = 2,
  rootMargin = "300px",
}: InfiniteScrollSentinelProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = ref.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, rootMargin]);

  return (
    <div ref={ref}>
      <ListSkeleton rows={rows} />
    </div>
  );
}
