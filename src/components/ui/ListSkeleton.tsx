type ListSkeletonProps = {
  rows?: number;
};

export function ListSkeleton({ rows = 5 }: ListSkeletonProps) {
  return (
    <div className="divide-y divide-line">
      {Array.from({ length: rows }, (_, index) => (
        <div className="flex h-12 w-full rounded-xl p-2" key={index}>
          <div className="w-full rounded-xl bg-paper" />
        </div>
      ))}
    </div>
  );
}
