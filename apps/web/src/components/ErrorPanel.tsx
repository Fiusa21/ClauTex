import { errorMessage } from "../api/client.ts";

export function ErrorPanel({ error }: { error: unknown }) {
  return (
    <div className="panel error" role="alert">
      {errorMessage(error)}
    </div>
  );
}
