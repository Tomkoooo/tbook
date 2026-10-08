import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Panel with an optional header row. The console's one container primitive. */
export function Card({ title, actions, children, className }: CardProps) {
  return (
    <section className={["tbook-card", className].filter(Boolean).join(" ")}>
      {(title || actions) && (
        <header className="tbook-card-head">
          {title ? <h2 className="tbook-card-title">{title}</h2> : <span />}
          {actions ? <div className="tbook-card-actions">{actions}</div> : null}
        </header>
      )}
      <div className="tbook-card-body">{children}</div>
    </section>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

/** Single KPI readout, used in a row across the dashboard and list headers. */
export function Stat({ label, value, hint }: StatProps) {
  return (
    <div className="tbook-stat">
      <span className="tbook-stat-label">{label}</span>
      <strong className="tbook-stat-value">{value}</strong>
      {hint ? <span className="tbook-stat-hint">{hint}</span> : null}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="tbook-stat-row">{children}</div>;
}
