import type { en } from "./strings";
export function Skeleton({
  label,
  width = "5rem",
}: {
  label: string;
  width?: string;
}) {
  return (
    <span
      className="skeleton"
      role="status"
      aria-label={label}
      aria-busy="true"
      style={{ width }}
    />
  );
}
export function AccountSkeleton({
  t,
  actions,
}: {
  t: Record<keyof typeof en, string>;
  actions: number;
}) {
  return (
    <div aria-busy="true" aria-label={t.loading}>
      <div className="account-board">
        <div className="account-cell">
          <div className="account-identity">
            <Skeleton label={t.loading} width="18px" />
            <div>
              <strong>
                <Skeleton label={t.loading} width="7rem" />
              </strong>
              <span className="account-kind">
                <Skeleton label={t.loading} width="5rem" />
              </span>
            </div>
          </div>
          <div className="account-address">
            <Skeleton label={t.loading} width="6rem" />
          </div>
        </div>
        <dl className="account-metrics">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <dt>
                <Skeleton label={t.loading} width="70%" />
              </dt>
              <dd>
                <Skeleton label={t.loading} width="65%" /> <small>USDC</small>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="entry-actions">
        {Array.from({ length: actions }, (_, i) => (
          <div className="action-skeleton" key={i}>
            <Skeleton label={t.loading} width="2rem" />
            <Skeleton label={t.loading} width="3rem" />
          </div>
        ))}
      </div>
    </div>
  );
}
