import { Link } from "react-router";

export function AppHeader() {
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        TexCollab
      </Link>
      <Link to="/settings" className="muted header-link">
        Settings
      </Link>
    </header>
  );
}
