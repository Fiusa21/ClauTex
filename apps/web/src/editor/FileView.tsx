import { contentUrl, type FileEntry } from "../api/files.ts";
import { formatSize } from "./format.ts";
import { baseName } from "./tree.ts";

/** Non-text files: images are previewed, everything else offers a download. */
export function BinaryView({
  projectId,
  file,
}: {
  projectId: string;
  file: FileEntry;
}) {
  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.path);
  return (
    <div className="binary-view">
      {isImage ? (
        <img src={contentUrl(projectId, file.id)} alt={file.path} />
      ) : (
        <p className="muted">This file can’t be shown here.</p>
      )}
      <p>
        <a
          href={contentUrl(projectId, file.id, true)}
          download={baseName(file.path)}
        >
          Download {baseName(file.path)}
        </a>
        {file.size !== null && (
          <span className="muted"> ({formatSize(file.size)})</span>
        )}
      </p>
    </div>
  );
}
