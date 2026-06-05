"use client";

import { useMemo, useState, useCallback } from "react";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface DiffPart {
  text: string;
  type: string;
}

interface DiffEntry {
  kind: string;
  leftLineNumber: number | null;
  rightLineNumber: number | null;
  leftParts: DiffPart[];
  rightParts: DiffPart[];
}

interface DiffSummary {
  leftLineCount: number;
  rightLineCount: number;
  equalLines: number;
  changedLines: number;
  replacedLines: number;
  insertedLines: number;
  deletedLines: number;
}

interface CompareResult {
  jobId: string;
  leftFileName: string;
  rightFileName: string;
  generatedAt: string;
  summary: DiffSummary;
  entries: DiffEntry[];
  pdfUrl: string;
  previewImages: string[];
  pdfPageCount: number;
  previewPageCount: number;
}

function DiffText({ parts }: { parts: DiffPart[] }) {
  if (!parts.length) return <span className="diff-empty">—</span>;
  return (
    <>
      {parts.map((part, index) => (
        <span
          key={`${part.type}-${index}`}
          className={
            part.type === "insert"
              ? "diff-token diff-token-insert"
              : part.type === "delete"
                ? "diff-token diff-token-delete"
                : "diff-token"
          }
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

export default function DocumentsPage() {
  const [leftFile, setLeftFile] = useState<File | null>(null);
  const [rightFile, setRightFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [showChangedOnly, setShowChangedOnly] = useState(true);

  useVoiceCommand(useCallback((action) => {
    switch (action.action) {
      case "toggle_changed_only":
        setShowChangedOnly(v => !v);
        break;
      case "clear":
        setLeftFile(null);
        setRightFile(null);
        setResult(null);
        setError(null);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const visibleEntries = useMemo(() => {
    const entries = result?.entries ?? [];
    const filtered = showChangedOnly ? entries.filter((entry) => entry.kind !== "equal") : entries;
    return filtered.slice(0, 300);
  }, [result, showChangedOnly]);

  async function submitCompare(event: React.FormEvent) {
    event.preventDefault();
    if (!leftFile || !rightFile) {
      setError("Please upload both files before running the comparison.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("leftFile", leftFile);
    formData.append("rightFile", rightFile);

    try {
      const response = await fetch("/api/documents/compare", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to compare the selected files.");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to compare the selected files.");
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div className="topbar">
        <div>
          <div className="topbar-title">Document Difference Engine</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{today}</div>
        </div>
        <div className="topbar-right">
          <span className="badge badge-blue">Precise compare + PDF export</span>
        </div>
      </div>

      <div className="page-content">
        {error ? <div className="alert alert-danger">{error}</div> : null}

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Upload Two Files</div>
                <div className="card-subtitle">
                  Compare DOCX and text-based files with precise line and word highlighting
                </div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={submitCompare} style={{ display: "grid", gap: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Original file</label>
                  <input
                    className="form-input"
                    type="file"
                    onChange={(event) => setLeftFile(event.target.files?.[0] ?? null)}
                    accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.js,.jsx,.ts,.tsx,.py,.java,.cs,.html,.htm,.css,.scss,.xml,.yml,.yaml,.sql,.log,.ini,.cfg"
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Updated file</label>
                  <input
                    className="form-input"
                    type="file"
                    onChange={(event) => setRightFile(event.target.files?.[0] ?? null)}
                    accept=".pdf,.docx,.txt,.md,.csv,.tsv,.json,.js,.jsx,.ts,.tsx,.py,.java,.cs,.html,.htm,.css,.scss,.xml,.yml,.yaml,.sql,.log,.ini,.cfg"
                    required
                  />
                </div>

                <div className="alert alert-info" style={{ marginBottom: 0 }}>
                  Supports PDF, DOCX, and text-based files. The app compares the original and updated files, marks the detected differences directly inside the updated file, and lets you review or download that highlighted PDF immediately.
                </div>

                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Comparing and generating PDF..." : "Compare Files"}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Current Comparison</div>
                <div className="card-subtitle">
                  Summary and export after the compare engine finishes
                </div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              <div className="flex-between">
                <span>Original</span>
                <strong>{result?.leftFileName ?? leftFile?.name ?? "Not selected"}</strong>
              </div>
              <div className="flex-between">
                <span>Updated</span>
                <strong>{result?.rightFileName ?? rightFile?.name ?? "Not selected"}</strong>
              </div>
              <div className="flex-between">
                <span>Generated</span>
                <strong>{result ? new Date(result.generatedAt).toLocaleString("en-IN") : "Waiting"}</strong>
              </div>
              <div className="flex-between">
                <span>Highlighted updated file</span>
                {result ? (
                  <a className="btn btn-outline btn-sm" href={result.pdfUrl} download>
                    Download PDF
                  </a>
                ) : (
                  <span className="badge badge-gray">Not ready</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {result ? (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Changed Lines</div>
                <div className="stat-value">{result.summary.changedLines}</div>
                <div className="stat-sub">Total non-equal line rows detected</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Inserted</div>
                <div className="stat-value">{result.summary.insertedLines}</div>
                <div className="stat-sub">New content in updated file</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Deleted</div>
                <div className="stat-value">{result.summary.deletedLines}</div>
                <div className="stat-sub">Content removed from original</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Replaced</div>
                <div className="stat-value">{result.summary.replacedLines}</div>
                <div className="stat-sub">Lines changed with intraline highlights</div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Highlighted Updated File</div>
                  <div className="card-subtitle">
                    Review the updated file with detected differences marked directly on it, then download it for final checking.
                  </div>
                </div>
                <a className="btn btn-outline btn-sm" href={result.pdfUrl} download>
                  Download highlighted PDF
                </a>
              </div>
              <div className="card-body">
                <div className="pdf-preview-wrap">
                  {result.previewImages.length ? (
                    <div className="pdf-page-preview-stack">
                      {result.previewImages.map((imageUrl, index) => (
                        <div key={imageUrl} className="pdf-page-preview-card">
                          <div className="pdf-page-preview-meta">
                            <span>Page {index + 1}</span>
                            {result.pdfPageCount > result.previewPageCount && index === result.previewImages.length - 1 ? (
                              <span>
                                Showing {result.previewPageCount} of {result.pdfPageCount} pages
                              </span>
                            ) : null}
                          </div>
                          <img
                            src={imageUrl}
                            alt={`Highlighted updated file page ${index + 1}`}
                            className="pdf-page-preview-image"
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <iframe
                      key={result.pdfUrl}
                      src={result.pdfUrl}
                      title="Highlighted updated file preview"
                      className="pdf-preview-frame"
                    />
                  )}
                </div>
                <div className="form-hint" style={{ marginTop: 12 }}>
                  This preview shows the generated updated PDF with highlights directly inside the application. Use the download button if you want to review it in your desktop PDF viewer.
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Detailed Difference Preview</div>
                  <div className="card-subtitle">
                    Red shows removed content from the original file. Green shows inserted or changed content in the updated file.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className={`btn btn-sm ${showChangedOnly ? "btn-primary" : "btn-outline"}`}
                    type="button"
                    onClick={() => setShowChangedOnly(true)}
                  >
                    Changed only
                  </button>
                  <button
                    className={`btn btn-sm ${!showChangedOnly ? "btn-primary" : "btn-outline"}`}
                    type="button"
                    onClick={() => setShowChangedOnly(false)}
                  >
                    Show all
                  </button>
                </div>
              </div>
              <div className="card-body">
                <div className="diff-table-wrap">
                  <table className="diff-table">
                    <thead>
                      <tr>
                        <th style={{ width: 70 }}>L#</th>
                        <th>Original</th>
                        <th style={{ width: 70 }}>R#</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((entry, index) => (
                        <tr key={`${entry.kind}-${index}`} className={`diff-row diff-row-${entry.kind}`}>
                          <td className="diff-line-number">{entry.leftLineNumber ?? "—"}</td>
                          <td className="diff-code-cell">
                            <code className="diff-code"><DiffText parts={entry.leftParts} /></code>
                          </td>
                          <td className="diff-line-number">{entry.rightLineNumber ?? "—"}</td>
                          <td className="diff-code-cell">
                            <code className="diff-code"><DiffText parts={entry.rightParts} /></code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {((showChangedOnly ? result.entries.filter((entry) => entry.kind !== "equal") : result.entries).length > visibleEntries.length) ? (
                  <div className="form-hint" style={{ marginTop: 12 }}>
                    Showing the first {visibleEntries.length} rows in the browser preview. The PDF contains the highlighted report output.
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
