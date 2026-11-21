import type { ReactNode } from "react";

type Props = {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
};

const shapes: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  box: <><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></>,
  sparkles: <><path d="m12 3 1.9 5.9L20 11l-6.1 2.1L12 19l-1.9-5.9L4 11l6.1-2.1L12 3Z"/><path d="m19 18 .6 1.4L21 20l-1.4.6L19 22l-.6-1.4L17 20l1.4-.6L19 18ZM5 2l.5 1.5L7 4l-1.5.5L5 6l-.5-1.5L3 4l1.5-.5L5 2Z"/></>,
  upload: <><path d="M12 16V3m0 0-5 5m5-5 5 5"/><path d="M20 16v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3"/></>,
  chart: <><path d="M3 3v18h18"/><path d="m7 15 4-4 3 2 5-7"/></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
  settings: <><path d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.9 1.1l-.4 1.9h-2.8l-.4-1.9a8 8 0 0 1-1.9-1.1l-1.8.6-1.4-2.4L8.5 15a8 8 0 0 1 0-2l-1.4-1.2 1.4-2.4 1.8.7a8 8 0 0 1 1.9-1.1l.4-1.9h2.8l.4 1.9a8 8 0 0 1 1.9 1.1l1.8-.7 1.4 2.4-1.4 1.2a8 8 0 0 1 0 2Z" transform="translate(-2 -2)"/></>,
  chevronLeft: <path d="m15 18-6-6 6-6"/>,
  chevronRight: <path d="m9 18 6-6-6-6"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16"/></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  ellipsis: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  close: <path d="M18 6 6 18M6 6l12 12"/>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.6 6"/><path d="M20 4v7h-7"/></>,
  arrowRight: <><path d="M4 12h16m-7-7 7 7-7 7"/></>,
  arrowUpRight: <><path d="M7 17 17 7M8 7h9v9"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  checkCircle: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  alert: <><path d="m10 4-8 14a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L14 4a2 2 0 0 0-4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7"/></>,
  edit: <><path d="m15 5 4 4M4 20l4.4-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/></>,
  filter: <><path d="M4 7h16M7 12h10M10 17h4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></>,
  external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></>,
  empty: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/></>,
  trendUp: <><path d="m3 17 7-7 4 4 7-7"/><path d="M15 7h6v6"/></>,
  trendDown: <><path d="m3 7 7 7 4-4 7 7"/><path d="M15 17h6v-6"/></>,
  lightning: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>,
};

export default function Icon({ name, size = 20, strokeWidth = 1.8, className }: Props) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] ?? shapes.box}</svg>;
}
