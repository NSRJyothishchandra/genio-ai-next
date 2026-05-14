"use client";

import { useState, useCallback } from "react";
import { useVoiceCommand } from "@/app/hooks/useVoiceCommand";

interface CadReport {
  fileName: string;
  fileType: string;
  generatedAt: string;
  mesh: {
    vertexCount: number;
    faceCount: number;
    edgeCount: number;
  };
  dimensions: {
    width: number;
    depth: number;
    height: number;
    diagonal: number;
    centerText: string;
    boundsText: string;
  };
  analysis: {
    units: string;
    topAnglesText: string;
    frontAnglesText: string;
    sideAnglesText: string;
    radiiText: string;
  };
  views: {
    front: string;
    top: string;
    side: string;
    pdf: string;
  };
}

function num(value: number) {
  return value.toFixed(3);
}

export default function CadPage() {
  const [cadFile, setCadFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CadReport | null>(null);

  useVoiceCommand(useCallback((action) => {
    switch (action.action) {
      case "analyze":
        if (cadFile) document.querySelector<HTMLFormElement>("[data-cad-form]")?.requestSubmit();
        break;
      case "clear":
        setCadFile(null);
        setReport(null);
        setError(null);
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cadFile]));

  async function submitAnalyze(event: React.FormEvent) {
    event.preventDefault();
    if (!cadFile) {
      setError("Please upload a CAD file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setReport(null);

    const formData = new FormData();
    formData.append("cadFile", cadFile);

    try {
      const response = await fetch("/api/cad/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Unable to generate the CAD drawing report.");
      }
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate the CAD drawing report.");
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
          <div className="topbar-title">CAD Drawing Generator</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{today}</div>
        </div>
        <div className="topbar-right">
          <span className="badge badge-blue">OBJ / STL / STEP / PRT drawing report</span>
        </div>
      </div>

      <div className="page-content">
        {error ? <div className="alert alert-danger">{error}</div> : null}

        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Upload CAD File</div>
                <div className="card-subtitle">
                  Generate front, top, side views and a downloadable drawing PDF with extracted values
                </div>
              </div>
            </div>
            <div className="card-body">
              <form onSubmit={submitAnalyze} style={{ display: "grid", gap: 16 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Mesh file</label>
                  <input
                    className="form-input"
                    type="file"
                    onChange={(event) => setCadFile(event.target.files?.[0] ?? null)}
                    accept=".obj,.stl,.mtl,.step,.stp,.prt"
                    required
                  />
                </div>

                <div className="alert alert-info" style={{ marginBottom: 0 }}>
                  OBJ and STL are native mesh inputs. STEP and STP are now converted into drawing geometry automatically. PRT is accepted too, and will use NX-side conversion when available on this machine.
                </div>

                <button className="btn btn-primary" type="submit" disabled={busy}>
                  {busy ? "Generating drawing report..." : "Generate Drawing PDF"}
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">Current Report</div>
                <div className="card-subtitle">Downloadable engineering snapshot after processing</div>
              </div>
            </div>
            <div className="card-body" style={{ display: "grid", gap: 12 }}>
              <div className="flex-between">
                <span>File</span>
                <strong>{report?.fileName ?? cadFile?.name ?? "Not selected"}</strong>
              </div>
              <div className="flex-between">
                <span>Type</span>
                <strong>{report?.fileType ?? "Waiting"}</strong>
              </div>
              <div className="flex-between">
                <span>Generated</span>
                <strong>{report ? new Date(report.generatedAt).toLocaleString("en-IN") : "Waiting"}</strong>
              </div>
              <div className="flex-between">
                <span>PDF</span>
                {report ? (
                  <a className="btn btn-outline btn-sm" href={report.views.pdf} download>
                    Download PDF
                  </a>
                ) : (
                  <span className="badge badge-gray">Not ready</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {report ? (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Width</div>
                <div className="stat-value">{num(report.dimensions.width)}</div>
                <div className="stat-sub">{report.analysis.units}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Depth</div>
                <div className="stat-value">{num(report.dimensions.depth)}</div>
                <div className="stat-sub">{report.analysis.units}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Height</div>
                <div className="stat-value">{num(report.dimensions.height)}</div>
                <div className="stat-sub">{report.analysis.units}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Diagonal</div>
                <div className="stat-value">{num(report.dimensions.diagonal)}</div>
                <div className="stat-sub">{report.analysis.units}</div>
              </div>
            </div>

            <div className="grid-2" style={{ marginBottom: 24 }}>
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Geometry Summary</div>
                    <div className="card-subtitle">Core measured values from the uploaded mesh</div>
                  </div>
                </div>
                <div className="card-body" style={{ display: "grid", gap: 10 }}>
                  <div className="flex-between"><span>Vertices</span><strong>{report.mesh.vertexCount}</strong></div>
                  <div className="flex-between"><span>Edges</span><strong>{report.mesh.edgeCount}</strong></div>
                  <div className="flex-between"><span>Faces</span><strong>{report.mesh.faceCount}</strong></div>
                  <div className="flex-between"><span>Detected radii</span><strong>{report.analysis.radiiText}</strong></div>
                  <div className="flex-between"><span>Top angles</span><strong>{report.analysis.topAnglesText}</strong></div>
                  <div className="flex-between"><span>Front angles</span><strong>{report.analysis.frontAnglesText}</strong></div>
                  <div className="flex-between"><span>Side angles</span><strong>{report.analysis.sideAnglesText}</strong></div>
                  <div className="flex-between"><span>Center</span><strong>{report.dimensions.centerText}</strong></div>
                  <div className="flex-between"><span>Bounds</span><strong>{report.dimensions.boundsText}</strong></div>
                </div>
              </div>

              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="card-title">Drawing Views</div>
                    <div className="card-subtitle">Orthographic engineering-style previews from the uploaded part</div>
                  </div>
                </div>
                <div className="card-body" style={{ display: "grid", gap: 16 }}>
                  <div className="cad-view-grid">
                    <div className="cad-view-card">
                      <img src={report.views.front} alt="Front view" className="cad-view-image" />
                      <div className="cad-view-label">Front view</div>
                    </div>
                    <div className="cad-view-card">
                      <img src={report.views.top} alt="Top view" className="cad-view-image" />
                      <div className="cad-view-label">Top view</div>
                    </div>
                    <div className="cad-view-card">
                      <img src={report.views.side} alt="Side view" className="cad-view-image" />
                      <div className="cad-view-label">Side view</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
