import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <main className="page">
      <div className="panel">
        <h1>Page not found</h1>
        <Link to="/">Go to your projects</Link>
      </div>
    </main>
  );
}
