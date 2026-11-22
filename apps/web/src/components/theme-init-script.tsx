/**
 * ThemeInitScript — applies the saved theme before first paint so the page
 * never flashes the wrong colours. Render once in the root layout's <head>
 * (and put `suppressHydrationWarning` on <html>). Server component, no props.
 * Pairs with ThemeToggle (same `tbook-theme` key).
 */
const SCRIPT = `try{var t=localStorage.getItem("tbook-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
