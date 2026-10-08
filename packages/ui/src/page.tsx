import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}

export function PageHeader({ title, description, actions, breadcrumb }: PageHeaderProps) {
  return (
    <header className="tbook-page-head">
      {breadcrumb ? <div className="tbook-breadcrumb">{breadcrumb}</div> : null}
      <div className="tbook-page-head-row">
        <div>
          <h1 className="tbook-page-title">{title}</h1>
          {description ? <p className="tbook-page-description">{description}</p> : null}
        </div>
        {actions ? <div className="tbook-page-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Inline, dismissible-free notice. `tone` matches Badge's semantics. */
export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "danger"; children: ReactNode }) {
  return (
    <p className={`tbook-notice tbook-notice-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function DescriptionList({ items }: { items: Array<{ label: ReactNode; value: ReactNode }> }) {
  return (
    <dl className="tbook-dl">
      {items.map((item, index) => (
        <div className="tbook-dl-row" key={index}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
