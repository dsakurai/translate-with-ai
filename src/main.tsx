import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { parse, stringify } from "@std/toml";

type Paragraph = { id: string; original: string; translated: string };
type SaveStatus = "loading" | "saved" | "saving" | "error";

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
  return stringify({
    paragraph: paragraphs.map(({ original, translated }) => ({
      original,
      translated,
    })),
  });
}

function ParagraphEditor() {
  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
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
      setParagraphs(parseParagraphs(contents));
      setTomlMalformed(false);
      setError("");
      return true;
    } catch (cause) {
      setParagraphs([]);
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

  function updateParagraphs(next: Paragraph[]) {
    version.current += 1;
    setParagraphs(next);
    setText(serializeParagraphs(next));
    setError("");
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

        <div className="paragraph-editor" aria-label="Paragraph entries">
          {tomlMalformed
            ? (
              <p className="toml-invalid">
                The document is preserved until you explicitly replace it.
              </p>
            )
            : (
              <>
                <div className="paragraph-columns" aria-hidden="true">
                  <span>ORIGINAL</span>
                  <span>TRANSLATED</span>
                </div>
                {paragraphs.map((paragraph, index) => (
                  <article
                    className="paragraph-row"
                    key={paragraph.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      const from = Number(
                        event.dataTransfer.getData("text/plain"),
                      );
                      moveParagraph(from, index);
                    }}
                  >
                    <div className="paragraph-controls">
                      <button
                        type="button"
                        className="drag-handle"
                        draggable
                        aria-label={`Drag paragraph ${index + 1} to reorder`}
                        title="Drag to reorder"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData(
                            "text/plain",
                            String(index),
                          );
                        }}
                      >
                        ⠿
                      </button>
                      <span>#{String(index + 1).padStart(2, "0")}</span>
                      <button
                        type="button"
                        className="remove-paragraph"
                        aria-label={`Remove paragraph ${index + 1}`}
                        onClick={() =>
                          updateParagraphs(
                            paragraphs.filter((item) =>
                              item.id !== paragraph.id
                            ),
                          )}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="paragraph-fields">
                      <textarea
                        aria-label={`Original paragraph ${index + 1}`}
                        disabled={!loaded}
                        value={paragraph.original}
                        onChange={(event) =>
                          updateParagraphs(
                            paragraphs.map((item) =>
                              item.id === paragraph.id
                                ? {
                                  ...item,
                                  original: event.currentTarget.value,
                                }
                                : item
                            ),
                          )}
                      />
                      <textarea
                        aria-label={`Translated paragraph ${index + 1}`}
                        disabled={!loaded}
                        value={paragraph.translated}
                        onChange={(event) =>
                          updateParagraphs(
                            paragraphs.map((item) =>
                              item.id === paragraph.id
                                ? {
                                  ...item,
                                  translated: event.currentTarget.value,
                                }
                                : item
                            ),
                          )}
                      />
                    </div>
                  </article>
                ))}
                <button
                  type="button"
                  className="add-paragraph"
                  disabled={!loaded}
                  onClick={() =>
                    updateParagraphs([
                      ...paragraphs,
                      { id: crypto.randomUUID(), original: "", translated: "" },
                    ])}
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
