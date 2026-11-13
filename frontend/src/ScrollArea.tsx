import type { ComponentProps } from "react";

/** Native scrolling retains keyboard, wheel and touch support. */
export function ScrollArea({
  className = "",
  tabIndex = 0,
  role = "region",
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      role={role}
      tabIndex={tabIndex}
      className={`app-scroll-area ${className}`}
    />
  );
}
