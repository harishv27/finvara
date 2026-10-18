import { Skeleton } from "./ui";

export function StatRowSkeleton({ n = 4 }: { n?: number }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: n }, (_, i) => <div key={i} className="rounded-2xl border border-line bg-surface p-4"><Skeleton className="h-3 w-20" /><Skeleton className="mt-3 h-7 w-28" /><Skeleton className="mt-2 h-3 w-36" /></div>)}</div>;
}
export function CardSkeleton({ h = "h-56", title = true }: { h?: string; title?: boolean }) {
  return <div className="rounded-2xl border border-line bg-surface p-5">{title && <Skeleton className="mb-4 h-4 w-32" />}<Skeleton className={`${h} w-full`} /></div>;
}
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return <div className="rounded-2xl border border-line bg-surface p-4" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex items-center gap-4 border-b border-line py-3 last:border-0"><Skeleton className="h-4 w-1/3" /><Skeleton className="ml-auto h-4 w-16" /><Skeleton className="h-4 w-16" /><Skeleton className="h-4 w-12" /></div>)}</div>;
}
export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div><Skeleton className="h-8 w-64" /><Skeleton className="mt-2 h-4 w-96 max-w-full" /></div>
      <StatRowSkeleton />
      <div className="grid gap-6 lg:grid-cols-5"><div className="lg:col-span-3"><CardSkeleton /></div><div className="lg:col-span-2"><CardSkeleton /></div></div>
    </div>
  );
}
