import type { ReactNode, ButtonHTMLAttributes } from "react";
import Icon from "./Icon";

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading animate-enter"><div><div className="eyebrow">{eyebrow ?? "WORKSPACE"}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-actions">{action}</div>}</div>;
}

export function EmptyState({ icon = "empty", title, detail, action }: { icon?: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={24}/></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Button({ children, icon, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string; variant?: "primary" | "outline" | "ghost" | "danger" }) {
  return <button {...props} className={`btn btn-${variant} ${className}`.trim()}>{icon && <Icon name={icon} size={17}/>}<span>{children}</span></button>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "blue" | "green" | "red" | "amber" }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot"/>{children}</span>;
}

export function LoadingState() {
  return <div className="loading-state"><div className="spinner"/><span>正在載入資料...</span></div>;
}
