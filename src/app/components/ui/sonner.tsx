import { Toaster as Sonner, ToasterProps } from "sonner";

// The generated version of this wrapper read the active theme from
// `next-themes`, but no ThemeProvider was ever mounted (see main.tsx), so the
// hook always fell through to its "system" default. Naming that default here
// keeps the rendered output identical and drops the dependency.
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
