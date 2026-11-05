import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import { parse } from "@std/toml";

type Paragraph = { id: string; original: string; translated: string };
type ParagraphPointerDrag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
};
type History = { entries: Paragraph[][]; index: number };
type SaveStatus = "loading" | "saved" | "saving" | "error";
const HISTORY_LIMIT = 100;

function MarkdownField(
  { label, value, disabled, onChange }: {
    label: string;
    value: string;
    disabled: boolean;
    onChange: (value: string) => void;
  },
) {
  const [viewing, setViewing] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value, viewing]);

  return (
    <div className="paragraph-field">
      <div className="paragraph-field-toolbar">
        <span>{label}</span>
      </div>
      <div className="paragraph-field-content">
        {viewing
          ? (
            <div className="markdown-viewer">
              <ReactMarkdown>{value.replace(/[\r\n]+$/, "")}</ReactMarkdown>
            </div>
          )
          : (
            <textarea
              ref={textareaRef}
              aria-label={label}
              disabled={disabled}
              rows={1}
              value={value}
              onChange={(event) => onChange(event.currentTarget.value)}
            />
          )}
        <button
          type="button"
          className="field-mode-toggle"
          aria-label={`Toggle edit mode for ${label}`}
          aria-pressed={!viewing}
          disabled={disabled}
          onClick={() => setViewing(!viewing)}
        >
          <span aria-hidden="true">
            ✎
          </span>
        </button>
      </div>
    </div>
  );
}

function parseParagraphs(contents: string): Paragraph[] {
  if (!contents.trim()) return [];
  const document: unknown = parse(contents);
  if (
    typeof document !== "object" || document === null ||
    !("paragraph" in document) ||
    Object.keys(document).some((key) => key !== "paragraph")
  ) {
    throw new Error("TOML must contain only an array of paragraph entries.");
  }
  const entries = (document as { paragraph?: unknown }).paragraph;
  if (!Array.isArray(entries)) {
    throw new Error("TOML must contain an array of paragraph entries.");
  }
  return entries.map((entry, index) => {
    if (
      typeof entry !== "object" || entry === null ||
      !("original" in entry) || !("translated" in entry) ||
      Object.keys(entry).some((key) =>
        key !== "original" && key !== "translated"
      )
    ) {
      throw new Error(
        `Paragraph ${
          index + 1
        } must contain only original and translated strings.`,
      );
    }
    const paragraph = entry as { original: unknown; translated: unknown };
    if (
      typeof paragraph.original !== "string" ||
      typeof paragraph.translated !== "string"
    ) {
      throw new Error(
        `Paragraph ${
          index + 1
        } original and translated values must be strings.`,
      );
    }
    return {
      id: crypto.randomUUID(),
      original: paragraph.original,
      translated: paragraph.translated,
    };
  });
}

function serializeParagraphs(paragraphs: Paragraph[]): string {
  function multilineString(value: string): string {
    let escaped = "";
    for (const character of value) {
      const codePoint = character.codePointAt(0)!;
      switch (character) {
        case "\\":
          escaped += "\\\\";
          break;
        case '"':
          escaped += '\\"';
          break;
        case "\b":
          escaped += "\\b";
          break;
        case "\t":
          escaped += "\\t";
          break;
        case "\n":
          escaped += escaped.length === 0 ? "\\n" : "\n";
          break;
        case "\f":
          escaped += "\\f";
          break;
        case "\r":
          escaped += "\\r";
          break;
        default:
          if (
            codePoint < 0x20 && character !== "\n" ||
            codePoint === 0x7f
          ) {
            escaped += codePoint <= 0xffff
              ? `\\u${codePoint.toString(16).padStart(4, "0")}`
              : `\\U${codePoint.toString(16).padStart(8, "0")}`;
          } else {
            escaped += character;
          }
      }
    }
    return `"""${escaped}"""`;
  }

  return paragraphs.map(({ original, translated }) =>
    `[[paragraph]]\noriginal = ${multilineString(original)}\ntranslated = ${
      multilineString(translated)
    }`
  ).join("\n\n") + (paragraphs.length ? "\n" : "");
}

function ParagraphEditor() {
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [history, setHistory] = useState<History>({
    entries: [[]],
    index: 0,
  });
  const [draggedParagraphId, setDraggedParagraphId] = useState<string | null>(
    null,
  );
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const pointerDrag = useRef<ParagraphPointerDrag | null>(null);
  const previousRowPositions = useRef<Map<string, DOMRect> | null>(null);
  const [tomlMalformed, setTomlMalformed] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [externalText, setExternalText] = useState<string | null>(null);
  const [saveEpoch, setSaveEpoch] = useState(0);
  const version = useRef(0);
  const lastSavedText = useRef("");
  const pendingExternal = useRef<string | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  function applyParagraphDocument(contents: string): boolean {
    try {
      const entries = parseParagraphs(contents);
      setParagraphs(entries);
      setHistory({ entries: [entries], index: 0 });
      setTomlMalformed(false);
      setError("");
      return true;
    } catch (cause) {
      setParagraphs([]);
      setHistory({ entries: [[]], index: 0 });
      setTomlMalformed(true);
      setError(
        cause instanceof Error
          ? `Invalid TOML: ${cause.message}`
          : "Invalid TOML.",
      );
      return false;
    }
  }

  useEffect(() => {
    let active = true;

    async function loadFile() {
      try {
        const configResponse = await fetch("/config", { cache: "no-store" });
        if (!configResponse.ok) {
          throw new Error("Could not load editor settings.");
        }
        const config: { filename: string } = await configResponse.json();
        const response = await fetch("/document", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(
            `Could not load ${config.filename} (HTTP ${response.status}).`,
          );
        }
        const contents = await response.text();
        if (!active) return;

        setFilename(config.filename);
        setStatus(applyParagraphDocument(contents) ? "saved" : "error");
        setText(contents);
        lastSavedText.current = contents;
        setLoaded(true);
      } catch (cause) {
        if (!active) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load the document.",
        );
        setStatus("error");
      }
    }

    void loadFile();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let active = true;
    let timeout: ReturnType<typeof setTimeout>;

    async function checkForExternalChanges() {
      try {
        const response = await fetch("/document", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(
            `Could not check ${filename} for external changes (HTTP ${response.status}).`,
          );
        }
        const contents = await response.text();
        if (active && contents !== lastSavedText.current) {
          pendingExternal.current = contents;
          setExternalText(contents);
        }
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not check for external changes.",
          );
          setStatus("error");
        }
      } finally {
        if (active) timeout = setTimeout(checkForExternalChanges, 3000);
      }
    }

    timeout = setTimeout(checkForExternalChanges, 3000);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [filename, loaded]);

  useEffect(() => {
    if (
      !loaded || externalText !== null ||
      tomlMalformed || text === lastSavedText.current
    ) return;

    const snapshot = text;
    const savedVersion = version.current;
    const timeout = setTimeout(() => {
      setStatus("saving");
      setError("");
      saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
        const response = await fetch("/document", {
          method: "PUT",
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: snapshot,
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(
            `Could not save ${filename} (HTTP ${response.status}).`,
          );
        }
        lastSavedText.current = snapshot;
      }).then(() => {
        if (savedVersion === version.current) setStatus("saved");
      }).catch((cause: unknown) => {
        if (savedVersion === version.current) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not save the document.",
          );
          setStatus("error");
        }
      });
    }, 500);
    return () => clearTimeout(timeout);
  }, [externalText, filename, loaded, saveEpoch, text, tomlMalformed]);

  function commitParagraphs(next: Paragraph[]) {
    version.current += 1;
    setParagraphs(next);
    setText(serializeParagraphs(next));
    setError("");
  }

  function updateParagraphs(next: Paragraph[]) {
    setHistory((current) => {
      const entries = current.entries.slice(0, current.index + 1);
      entries.push(next);
      if (entries.length > HISTORY_LIMIT) entries.shift();
      return { entries, index: entries.length - 1 };
    });
    commitParagraphs(next);
  }

  function undo() {
    if (history.index === 0) return;
    const index = history.index - 1;
    setHistory({ ...history, index });
    commitParagraphs(history.entries[index]);
  }

  function redo() {
    if (history.index >= history.entries.length - 1) return;
    const index = history.index + 1;
    setHistory({ ...history, index });
    commitParagraphs(history.entries[index]);
  }

  function reloadExternal() {
    if (pendingExternal.current === null) return;
    version.current += 1;
    const contents = pendingExternal.current;
    setStatus(applyParagraphDocument(contents) ? "saved" : "error");
    setText(contents);
    lastSavedText.current = contents;
    pendingExternal.current = null;
    setExternalText(null);
  }

  function keepEditorVersion() {
    if (pendingExternal.current === null) return;
    lastSavedText.current = pendingExternal.current;
    pendingExternal.current = null;
    setExternalText(null);
    setSaveEpoch((epoch) => epoch + 1);
  }

  function repairToml() {
    version.current += 1;
    setParagraphs([]);
    setHistory({ entries: [[]], index: 0 });
    setTomlMalformed(false);
    setText(serializeParagraphs([]));
    setError("");
    setStatus("saving");
  }

  function retrySave() {
    if (!loaded || tomlMalformed) return;
    setStatus("saving");
    setError("");
    const snapshot = text;
    const savedVersion = version.current;
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const response = await fetch("/document", {
        method: "PUT",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: snapshot,
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(
          `Could not save ${filename} (HTTP ${response.status}).`,
        );
      }
      lastSavedText.current = snapshot;
    }).then(() => {
      if (savedVersion === version.current) setStatus("saved");
    }).catch((cause: unknown) => {
      if (savedVersion === version.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save the document.",
        );
        setStatus("error");
      }
    });
  }

  function moveParagraph(from: number, to: number) {
    if (to < 0 || to >= paragraphs.length || from === to) return;
    const next = [...paragraphs];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    updateParagraphs(next);
  }

  function insertParagraph(index: number) {
    const next = [...paragraphs];
    next.splice(index, 0, {
      id: crypto.randomUUID(),
      original: "",
      translated: "",
    });
    updateParagraphs(next);
  }

  function setDropPosition(index: number | null) {
    if (dropIndexRef.current === index) return;
    const positions = new Map<string, DOMRect>();
    document.querySelectorAll<HTMLElement>(
      ".paragraph-row[data-paragraph-id]",
    ).forEach((row) => {
      const id = row.dataset.paragraphId;
      if (id) positions.set(id, row.getBoundingClientRect());
    });
    previousRowPositions.current = positions;
    dropIndexRef.current = index;
    setDropIndex(index);
  }

  const displayedParagraphs = (() => {
    if (draggedParagraphId === null || dropIndex === null) return paragraphs;
    const from = paragraphs.findIndex((item) => item.id === draggedParagraphId);
    if (from < 0) return paragraphs;
    const next = [...paragraphs];
    const [dragged] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, dropIndex)), 0, dragged);
    return next;
  })();

  function updateDropPositionFromPointer(
    clientX: number,
    clientY: number,
    draggedId: string,
  ) {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".paragraph-row[data-paragraph-id]",
      ),
    );
    const target = document.elementFromPoint(clientX, clientY)?.closest<
      HTMLElement
    >(".paragraph-row[data-paragraph-id]");
    if (!target?.dataset.paragraphId) return;
    const index = rows.indexOf(target);
    if (index < 0) return;

    const bounds = target.getBoundingClientRect();
    const after = clientY > bounds.top + bounds.height / 2;
    const boundary = index + (after ? 1 : 0);
    const draggedIndex = rows.findIndex((row) =>
      row.dataset.paragraphId === draggedId
    );
    setDropPosition(
      Math.max(
        0,
        Math.min(
          paragraphs.length - 1,
          boundary > draggedIndex ? boundary - 1 : boundary,
        ),
      ),
    );
  }

  function finishPointerDrag(
    event: { pointerId: number; clientX: number; clientY: number },
    cancelled = false,
  ) {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDrag.current = null;
    if (drag.active && !cancelled) {
      updateDropPositionFromPointer(event.clientX, event.clientY, drag.id);
      const from = paragraphs.findIndex((item) => item.id === drag.id);
      const destination = dropIndexRef.current;
      if (from >= 0 && destination !== null) {
        moveParagraph(from, destination);
      }
    }
    setDraggedParagraphId(null);
    setDropPosition(null);
  }

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) =>
      finishPointerDrag(event);
    const handlePointerCancel = (event: PointerEvent) =>
      finishPointerDrag(event, true);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [paragraphs]);

  useLayoutEffect(() => {
    const previousPositions = previousRowPositions.current;
    if (!previousPositions) return;
    previousRowPositions.current = null;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    document.querySelectorAll<HTMLElement>(
      ".paragraph-row[data-paragraph-id]",
    ).forEach((row) => {
      const id = row.dataset.paragraphId;
      const previous = id ? previousPositions.get(id) : undefined;
      if (!previous) return;
      const current = row.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      row.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    });
  }, [displayedParagraphs]);

  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, [contenteditable='true']"))
      ) return;

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      } else if (key === "z") {
        event.preventDefault();
        undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  });

  const statusLabel = {
    loading: "Opening document…",
    saving: "Saving…",
    saved: "All changes saved",
    error: "Save needs attention",
  }[status];

  return (
    <main className="workspace">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Editor home">
          <span className="wordmark-icon" aria-hidden="true">n.</span>
          <span>paragraphs</span>
        </a>
        <div
          className={`save-status save-status--${status}`}
          aria-live="polite"
        >
          <span className="status-dot" aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </header>

      <section
        className="editor-shell editor-shell--toml"
        aria-label="Paragraph editor"
      >
        <div className="document-heading">
          <div className="eyebrow">
            YOUR SPACE <span>/</span> DOCUMENT
          </div>
          <h1>{filename || "Opening document"}</h1>
          <p>Edit and arrange your original and translated paragraphs.</p>
        </div>

        {error && (
          <div className="error-message" role="alert">
            <span>{error}</span>
            {tomlMalformed
              ? (
                <button
                  type="button"
                  className="retry-button"
                  onClick={repairToml}
                >
                  Replace with empty list
                </button>
              )
              : (
                <button
                  type="button"
                  className="retry-button"
                  onClick={loaded ? retrySave : () => window.location.reload()}
                >
                  {loaded ? "Retry save" : "Retry loading"}
                </button>
              )}
          </div>
        )}

        {externalText !== null && (
          <div className="external-change" role="alert">
            <span>This file changed outside the editor.</span>
            <div className="external-change-actions">
              <button type="button" onClick={reloadExternal}>
                Load external version
              </button>
              <button type="button" onClick={keepEditorVersion}>
                Keep my edits
              </button>
            </div>
          </div>
        )}

        <div className="paragraph-history" aria-label="Paragraph edit history">
          <button
            type="button"
            disabled={!loaded || history.index === 0}
            onClick={undo}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={!loaded || history.index >= history.entries.length - 1}
            onClick={redo}
          >
            Redo
          </button>
        </div>

        <div className="paragraph-editor" aria-label="Paragraph entries">
          {tomlMalformed
            ? (
              <p className="toml-invalid">
                The document is preserved until you explicitly replace it.
              </p>
            )
            : (
              <>
                {displayedParagraphs.length > 0 && (
                  <button
                    type="button"
                    className="insert-paragraph insert-paragraph--first"
                    aria-label="Add paragraph at the beginning"
                    disabled={!loaded}
                    onClick={() => insertParagraph(0)}
                  >
                    + Add here
                  </button>
                )}
                {displayedParagraphs.map((paragraph, index) => (
                  <article
                    className={`paragraph-row${
                      draggedParagraphId === paragraph.id
                        ? " paragraph-row--dragging"
                        : ""
                    }${
                      draggedParagraphId === paragraph.id
                        ? " paragraph-row--drag-preview"
                        : ""
                    }${
                      dropIndex !== null &&
                        index === Math.min(dropIndex + 1, paragraphs.length - 1)
                        ? " paragraph-row--drop-target"
                        : ""
                    }`}
                    key={paragraph.id}
                    data-paragraph-id={paragraph.id}
                  >
                    <div className="paragraph-row-content">
                      <button
                        type="button"
                        className="drag-handle"
                        aria-label={`Drag paragraph ${index + 1} to reorder`}
                        title="Drag to reorder"
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          pointerDrag.current = {
                            id: paragraph.id,
                            pointerId: event.pointerId,
                            startX: event.clientX,
                            startY: event.clientY,
                            active: false,
                          };
                        }}
                        onPointerMove={(event) => {
                          const drag = pointerDrag.current;
                          if (!drag || drag.pointerId !== event.pointerId) {
                            return;
                          }
                          if (!drag.active) {
                            if (
                              Math.hypot(
                                event.clientX - drag.startX,
                                event.clientY - drag.startY,
                              ) < 5
                            ) return;
                            drag.active = true;
                            setDraggedParagraphId(drag.id);
                          }
                          updateDropPositionFromPointer(
                            event.clientX,
                            event.clientY,
                            drag.id,
                          );
                        }}
                        onPointerUp={(event) => finishPointerDrag(event)}
                        onPointerCancel={(event) =>
                          finishPointerDrag(event, true)}
                      >
                        ⠿
                      </button>
                      <div className="paragraph-fields">
                        <div className="original-paragraph">
                          <MarkdownField
                            key={`${paragraph.id}-original`}
                            label={`Original paragraph ${index + 1}`}
                            disabled={!loaded}
                            value={paragraph.original}
                            onChange={(value) =>
                              updateParagraphs(
                                paragraphs.map((item) =>
                                  item.id === paragraph.id
                                    ? {
                                      ...item,
                                      original: value,
                                    }
                                    : item
                                ),
                              )}
                          />
                        </div>
                        <MarkdownField
                          key={`${paragraph.id}-translated`}
                          label={`Translated paragraph ${index + 1}`}
                          disabled={!loaded}
                          value={paragraph.translated}
                          onChange={(value) =>
                            updateParagraphs(
                              paragraphs.map((item) =>
                                item.id === paragraph.id
                                  ? {
                                    ...item,
                                    translated: value,
                                  }
                                  : item
                              ),
                            )}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="remove-paragraph"
                      aria-label={`Remove paragraph ${index + 1}`}
                      title={`Remove paragraph ${index + 1}`}
                      onClick={() =>
                        updateParagraphs(
                          paragraphs.filter((_, itemIndex) =>
                            itemIndex !== index
                          ),
                        )}
                    >
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 6 12 12" />
                        <path d="M18 6 6 18" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="insert-paragraph"
                      aria-label={`Add paragraph after paragraph ${index + 1}`}
                      disabled={!loaded}
                      onClick={() => insertParagraph(index + 1)}
                    >
                      + Add here
                    </button>
                  </article>
                ))}
                <button
                  type="button"
                  className="add-paragraph"
                  disabled={!loaded}
                  onClick={() => insertParagraph(paragraphs.length)}
                >
                  + Add paragraph
                </button>
              </>
            )}
          <footer className="editor-footer">
            <span>TOML PARAGRAPHS</span>
            <span>{paragraphs.length} ENTRIES</span>
          </footer>
        </div>
      </section>

      <p className="footnote">Your words stay in your WebDAV space.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ParagraphEditor />);
