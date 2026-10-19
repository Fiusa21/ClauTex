import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { errorMessage } from "../api/client.ts";
import {
  contentUrl,
  useCreateFile,
  useDeleteFile,
  useMoveFile,
  useSetMainFile,
  useUploadFile,
  type FileEntry,
} from "../api/files.ts";
import {
  ancestors,
  baseName,
  buildTree,
  folderOf,
  join,
  type TreeNode,
} from "./tree.ts";

type Editing =
  | { mode: "new-doc" | "new-folder"; folder: string }
  | { mode: "rename"; node: TreeNode };

interface Props {
  projectId: string;
  files: FileEntry[];
  mainFile: string;
  selectedId: string | undefined;
  canEdit: boolean;
  onSelect: (file: FileEntry) => void;
}

const DRAG_TYPE = "application/x-texcollab-file";

export function FileTree({
  projectId,
  files,
  mainFile,
  selectedId,
  canEdit,
  onSelect,
}: Props) {
  const tree = buildTree(files);
  const selected = files.find((f) => f.id === selectedId);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selected ? ancestors(selected.path) : []),
  );
  const [focusFolder, setFocusFolder] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState<{
    kind: "error" | "notice";
    text: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const create = useCreateFile(projectId);
  const upload = useUploadFile(projectId);
  const move = useMoveFile(projectId);
  const remove = useDeleteFile(projectId);
  const setMain = useSetMainFile(projectId);

  // New files go into the folder that is focused, or the folder of the selected file.
  const targetFolder = focusFolder ?? folderOf(selected?.path, false);

  const fail = (err: unknown) => {
    setMessage({ kind: "error", text: errorMessage(err) });
  };
  const expand = (path: string) => {
    setExpanded((prev) => new Set([...prev, path, ...ancestors(path)]));
  };

  function submitEdit(name: string) {
    if (!editing) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setEditing(null);
      return;
    }
    setMessage(null);
    if (editing.mode === "rename") {
      const node = editing.node;
      const target = join(folderOf(node.path, false), trimmed);
      if (target === node.path || !node.entry) {
        setEditing(null);
        return;
      }
      move.mutate(
        { id: node.entry.id, path: target },
        {
          onSuccess: () => {
            setEditing(null);
          },
          onError: fail,
        },
      );
      return;
    }
    const path = join(editing.folder, trimmed);
    create.mutate(
      { path, kind: editing.mode === "new-doc" ? "doc" : "folder" },
      {
        onSuccess: (file) => {
          setEditing(null);
          expand(editing.folder);
          if (file.kind === "doc") onSelect(file);
        },
        onError: fail,
      },
    );
  }

  async function uploadFiles(list: FileList | File[], folder: string) {
    setMessage(null);
    for (const file of Array.from(list)) {
      try {
        const result = await upload.mutateAsync({
          file,
          path: join(folder, file.name),
        });
        if (result.notice)
          setMessage({
            kind: "notice",
            text: `${file.name}: ${result.notice}`,
          });
      } catch (err) {
        fail(err);
        return;
      }
    }
    if (folder) expand(folder);
  }

  function moveInto(fileId: string, folder: string) {
    const file = files.find((f) => f.id === fileId);
    if (!file) return;
    const target = join(folder, baseName(file.path));
    if (
      target === file.path ||
      folder === file.path ||
      folder.startsWith(`${file.path}/`)
    )
      return;
    setMessage(null);
    move.mutate(
      { id: fileId, path: target },
      {
        onError: fail,
        onSuccess: () => {
          expand(folder);
        },
      },
    );
  }

  function deleteNode(node: TreeNode) {
    if (!node.entry) return;
    const what = node.isFolder
      ? `the folder “${node.path}” and everything in it`
      : `“${node.path}”`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    setMessage(null);
    remove.mutate(node.entry.id, { onError: fail });
  }

  function onDrop(e: DragEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (!canEdit) return;
    const fileId = e.dataTransfer.getData(DRAG_TYPE);
    if (fileId) {
      moveInto(fileId, folder);
    } else if (e.dataTransfer.files.length > 0) {
      void uploadFiles(e.dataTransfer.files, folder);
    }
  }

  const dropProps = (folder: string) =>
    canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(folder);
          },
          onDragLeave: () => {
            setDropTarget((t) => (t === folder ? null : t));
          },
          onDrop: (e: DragEvent) => {
            onDrop(e, folder);
          },
        }
      : {};

  function renderNode(node: TreeNode, depth: number) {
    const isOpen = expanded.has(node.path);
    const isSelected = node.entry?.id === selectedId;
    const isMain = node.path === mainFile;
    const renaming =
      editing?.mode === "rename" && editing.node.path === node.path;

    const onActivate = () => {
      if (node.isFolder) {
        setFocusFolder(node.path);
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(node.path)) next.delete(node.path);
          else next.add(node.path);
          return next;
        });
      } else if (node.entry) {
        setFocusFolder(undefined);
        onSelect(node.entry);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!canEdit) return;
      if (e.key === "F2") {
        e.preventDefault();
        setEditing({ mode: "rename", node });
      } else if (e.key === "Delete") {
        e.preventDefault();
        deleteNode(node);
      }
    };

    return (
      <li key={node.path} role="none">
        <div
          className={`tree-row${isSelected ? " selected" : ""}${dropTarget === node.path ? " drop" : ""}`}
          style={{ paddingLeft: `${String(0.5 + depth * 0.9)}rem` }}
          draggable={canEdit && !renaming}
          onDragStart={(e) => {
            if (node.entry) e.dataTransfer.setData(DRAG_TYPE, node.entry.id);
          }}
          {...(node.isFolder ? dropProps(node.path) : {})}
        >
          {renaming ? (
            <NameInput
              label={`New name for ${node.name}`}
              initial={node.name}
              onSubmit={submitEdit}
              onCancel={() => {
                setEditing(null);
              }}
            />
          ) : (
            <button
              type="button"
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={node.isFolder ? isOpen : undefined}
              className="tree-item"
              onClick={onActivate}
              onKeyDown={onKeyDown}
            >
              <span className="tree-icon" aria-hidden="true">
                {node.isFolder
                  ? isOpen
                    ? "▾"
                    : "▸"
                  : node.entry?.kind === "binary"
                    ? "◇"
                    : "·"}
              </span>
              <span className="tree-name">{node.name}</span>
              {isMain && <span className="badge main-badge">main</span>}
            </button>
          )}
          {!renaming && (
            <span className="tree-actions">
              {node.entry?.kind === "binary" && (
                <a
                  className="icon-button"
                  href={contentUrl(projectId, node.entry.id, true)}
                  aria-label={`Download ${node.name}`}
                  title="Download"
                >
                  ↓
                </a>
              )}
              {canEdit &&
                node.entry?.kind === "doc" &&
                !isMain &&
                node.path.endsWith(".tex") && (
                  <button
                    type="button"
                    className="icon-button"
                    title="Set as main file"
                    aria-label={`Set ${node.name} as main file`}
                    onClick={() => {
                      setMessage(null);
                      setMain.mutate(node.path, { onError: fail });
                    }}
                  >
                    ★
                  </button>
                )}
              {canEdit && (
                <>
                  <button
                    type="button"
                    className="icon-button"
                    title="Rename (F2)"
                    aria-label={`Rename ${node.name}`}
                    onClick={() => {
                      setEditing({ mode: "rename", node });
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Delete"
                    aria-label={`Delete ${node.name}`}
                    onClick={() => {
                      deleteNode(node);
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </span>
          )}
        </div>
        {node.isFolder && isOpen && (
          <ul role="group">
            {editing &&
              editing.mode !== "rename" &&
              editing.folder === node.path && (
                <NewItemRow
                  editing={editing}
                  depth={depth + 1}
                  onSubmit={submitEdit}
                  onCancel={() => {
                    setEditing(null);
                  }}
                />
              )}
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <nav className="file-tree" aria-label="Project files">
      {canEdit && (
        <div className="tree-toolbar">
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              if (targetFolder) expand(targetFolder);
              setEditing({ mode: "new-doc", folder: targetFolder });
            }}
          >
            New file
          </button>
          <button
            type="button"
            className="button ghost small"
            onClick={() => {
              if (targetFolder) expand(targetFolder);
              setEditing({ mode: "new-folder", folder: targetFolder });
            }}
          >
            New folder
          </button>
          <button
            type="button"
            className="button ghost small"
            disabled={upload.isPending}
            onClick={() => uploadInput.current?.click()}
          >
            {upload.isPending ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={uploadInput}
            type="file"
            multiple
            hidden
            data-testid="upload-input"
            onChange={(e) => {
              if (e.target.files)
                void uploadFiles(e.target.files, targetFolder);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {message && (
        <p
          className={
            message.kind === "error"
              ? "form-error tree-message"
              : "tree-message notice"
          }
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <ul
        className={`tree-root${dropTarget === "" ? " drop" : ""}`}
        role="tree"
        aria-label="Files"
        {...dropProps("")}
        onClick={(e) => {
          if (e.target === e.currentTarget) setFocusFolder("");
        }}
      >
        {editing && editing.mode !== "rename" && editing.folder === "" && (
          <NewItemRow
            editing={editing}
            depth={0}
            onSubmit={submitEdit}
            onCancel={() => {
              setEditing(null);
            }}
          />
        )}
        {tree.map((node) => renderNode(node, 0))}
      </ul>
    </nav>
  );
}

function NewItemRow(props: {
  editing: Extract<Editing, { mode: "new-doc" | "new-folder" }>;
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <li role="none">
      <div
        className="tree-row"
        style={{ paddingLeft: `${String(0.5 + props.depth * 0.9)}rem` }}
      >
        <NameInput
          label={
            props.editing.mode === "new-doc"
              ? "New file name"
              : "New folder name"
          }
          initial=""
          placeholder={
            props.editing.mode === "new-doc" ? "chapter.tex" : "folder"
          }
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
        />
      </div>
    </li>
  );
}

function NameInput(props: {
  label: string;
  initial: string;
  placeholder?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  return (
    <form
      className="name-input"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit(value);
      }}
    >
      <input
        aria-label={props.label}
        autoFocus
        value={value}
        placeholder={props.placeholder}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
        }}
        onBlur={props.onCancel}
      />
    </form>
  );
}
